/**
 * @vitest-environment jsdom
 *
 * Single-session coordination (S22) — the fix for Xibo's double-buffer iframe
 * thrash. Two boot()s for the SAME bar must result in exactly ONE open WS; the
 * second boot waits and only connects if the first releases its session.
 *
 * The lock is exercised two ways:
 *   1. directly against the real {@link LeaderElectionSessionLock} fallback with
 *      injected storage + BroadcastChannel + clock (deterministic);
 *   2. end-to-end through `boot()` with a shared fake lock, asserting only one
 *      iframe's WS is created, and that the second takes over on the first's
 *      release.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LeaderElectionSessionLock,
  ImmediateSessionLock,
  createSessionLock,
  type SessionLock,
  type SessionLockHandle,
  type BroadcastChannelLike,
} from '../../src/transport/SessionLock';
import { boot } from '../../src/bootstrap';
import { FakeWebSocket } from './support/FakeWebSocket';

/** In-memory Storage shared across "iframes" in a test. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** A same-origin BroadcastChannel bus shared by all channels of a name. */
class FakeBus {
  private readonly channels = new Map<string, Set<FakeChannel>>();
  make(name: string): FakeChannel {
    const ch = new FakeChannel(this, name);
    let set = this.channels.get(name);
    if (!set) {
      set = new Set();
      this.channels.set(name, set);
    }
    set.add(ch);
    return ch;
  }
  publish(name: string, from: FakeChannel, message: unknown): void {
    for (const ch of this.channels.get(name) ?? []) {
      if (ch !== from) ch.deliver(message);
    }
  }
  remove(name: string, ch: FakeChannel): void {
    this.channels.get(name)?.delete(ch);
  }
}
class FakeChannel implements BroadcastChannelLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    private readonly bus: FakeBus,
    private readonly name: string,
  ) {}
  postMessage(message: unknown): void {
    this.bus.publish(this.name, this, message);
  }
  deliver(message: unknown): void {
    this.onmessage?.({ data: message });
  }
  close(): void {
    this.bus.remove(this.name, this);
  }
}

async function tick(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('LeaderElectionSessionLock (BroadcastChannel + lease fallback)', () => {
  it('grants the lock to exactly one of two contenders', async () => {
    const storage = new MemoryStorage();
    const bus = new FakeBus();
    let now = 1000;
    const env = (selfId: string) => ({
      makeBroadcastChannel: (n: string) => bus.make(n),
      storage,
      now: () => now,
      selfId,
    });

    const a = new LeaderElectionSessionLock('bar-x', env('A'));
    const b = new LeaderElectionSessionLock('bar-x', env('B'));

    let aHeld = false;
    let bHeld = false;
    let aHandle: SessionLockHandle | null = null;
    void a.acquire().then((h) => {
      aHeld = true;
      aHandle = h;
    });
    void b.acquire().then(() => {
      bHeld = true;
    });
    await tick();

    // Exactly one holder.
    expect(aHeld !== bHeld).toBe(true);
    expect(aHeld).toBe(true); // A attempted first ⇒ A wins the empty lease.
    expect(bHeld).toBe(false);

    // A releases ⇒ B takes over (prompt hand-off via the broadcast).
    aHandle!.release();
    await tick();
    expect(bHeld).toBe(true);
  });

  it('lets a waiter claim a STALE lease after the holder vanishes (crash)', async () => {
    const storage = new MemoryStorage();
    let now = 1000;
    // No BroadcastChannel: pure stale-lease recovery (the crash path).
    const holder = new LeaderElectionSessionLock('bar-y', {
      makeBroadcastChannel: null,
      storage,
      now: () => now,
      selfId: 'GONE',
    });
    let holderHeld = false;
    void holder.acquire().then(() => {
      holderHeld = true;
    });
    await tick();
    expect(holderHeld).toBe(true);

    // Holder "crashes" — it stops renewing. A waiter boots after the TTL.
    now += 10_000; // exceed LEASE_TTL_MS
    const waiter = new LeaderElectionSessionLock('bar-y', {
      makeBroadcastChannel: null,
      storage,
      now: () => now,
      selfId: 'NEW',
    });
    let waiterHeld = false;
    void waiter.acquire().then(() => {
      waiterHeld = true;
    });
    await tick();
    expect(waiterHeld).toBe(true);
  });
});

describe('createSessionLock capability gate', () => {
  it('prefers the Web Locks API when present', async () => {
    const requests: string[] = [];
    const fakeLocks = {
      request(name: string, _opts: unknown, cb: () => Promise<unknown>): Promise<unknown> {
        requests.push(name);
        return cb();
      },
    };
    const lock = createSessionLock('bar-z', { locks: fakeLocks });
    const handle = await lock.acquire();
    expect(requests).toEqual(['bar-z']);
    handle.release();
  });

  it('falls back to leader election when no Web Locks API', async () => {
    const lock = createSessionLock('bar-w', {
      locks: null,
      makeBroadcastChannel: null,
      storage: new MemoryStorage(),
    });
    const handle = await lock.acquire();
    expect(handle).toBeTruthy();
    handle.release();
  });
});

describe('boot() single-session coordination (two double-buffer iframes)', () => {
  // A controllable shared lock: the first acquirer holds it; a second acquirer
  // queues and is granted only when the holder releases. Mirrors the real lock.
  class SharedFakeLock {
    private holder: { resolve: (h: SessionLockHandle) => void } | null = null;
    private readonly queue: Array<(h: SessionLockHandle) => void> = [];
    view(): SessionLock {
      return { acquire: () => this.acquire() };
    }
    private acquire(): Promise<SessionLockHandle> {
      return new Promise<SessionLockHandle>((resolve) => {
        const grant = (r: (h: SessionLockHandle) => void): void => {
          const handle: SessionLockHandle = {
            release: () => {
              if (this.holder?.resolve !== r) return;
              this.holder = null;
              const next = this.queue.shift();
              if (next) grant(next);
            },
          };
          this.holder = { resolve: r };
          r(handle);
        };
        if (this.holder === null) grant(resolve);
        else this.queue.push(resolve);
      });
    }
  }

  let sockets: FakeWebSocket[];
  let factory: (url: string, protocol: string) => FakeWebSocket;
  beforeEach(() => {
    sockets = [];
    factory = (url, protocol) => {
      const s = new FakeWebSocket(url, protocol);
      sockets.push(s);
      return s;
    };
  });

  it('opens only ONE WS when two iframes boot the same bar', async () => {
    const lock = new SharedFakeLock();
    const common = {
      displayInfo: { hardwareKey: 'bar-demo', displayName: 'bar-demo' },
      webSocketFactory: factory as never,
      storage: new MemoryStorage(),
      sessionLock: lock.view(),
    } as const;

    const t1 = document.createElement('div');
    const t2 = document.createElement('div');
    const rt1 = await boot(t1, { wsBaseUrl: 'ws://gd', barId: 'bar-demo' }, common);
    const rt2 = await boot(t2, { wsBaseUrl: 'ws://gd', barId: 'bar-demo' }, common);
    await tick();

    // The holder (iframe 1) connected; the waiter (iframe 2) did NOT open a WS.
    expect(sockets.length).toBe(1);

    // Hand-off: iframe 1 destroys (page hidden/unloaded) ⇒ iframe 2 takes over
    // and opens its session.
    await rt1.destroy();
    await tick();
    expect(sockets.length).toBe(2);

    await rt2.destroy();
  });

  it('the waiting iframe never opens a WS while the holder lives', async () => {
    const lock = new SharedFakeLock();
    const common = {
      displayInfo: { hardwareKey: 'bar-demo', displayName: 'bar-demo' },
      webSocketFactory: factory as never,
      storage: new MemoryStorage(),
      sessionLock: lock.view(),
    } as const;

    const rt1 = await boot(document.createElement('div'), { wsBaseUrl: 'ws://gd', barId: 'bar-demo' }, common);
    const rt2 = await boot(document.createElement('div'), { wsBaseUrl: 'ws://gd', barId: 'bar-demo' }, common);
    await tick(20);

    expect(sockets.length).toBe(1); // still one, even after many ticks.
    await rt1.destroy();
    await rt2.destroy();
  });
});
