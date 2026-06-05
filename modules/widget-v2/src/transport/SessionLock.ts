/**
 * Single-session coordination across Xibo's double-buffer iframes (S22).
 *
 * THE BUG THIS FIXES. Xibo runs TWO persistent, same-origin iframes of the
 * Widget v2 (its preload / double-buffer). Each one `boot()`s and opens a WS
 * with the SAME `display_id`. The backend's correct one-session-per-display
 * policy (SPEC-CRWDQ-020, conn-registry.ts) evicts the older session with
 * `close 4006 replaced_by_newer`, so the two iframes thrash: neither holds its
 * session long enough to keep the delivered PlannedState, both decay to
 * `no_recent_state`, and the bar shows the `player_fallback` "Loading…" panel
 * instead of the live `backend_planned` content. The backend is CORRECT and is
 * NOT changed — the fix is here, on the widget: make exactly ONE iframe hold the
 * WS session at a time.
 *
 * THE MECHANISM. A named, cross-iframe exclusive lock. The boot only calls
 * `client.connect()` while it HOLDS the lock; the non-holder iframe waits and
 * takes over only when the holder releases (page hidden/unloaded/crashed). Two
 * implementations, picked by capability at construction:
 *
 *   1. {@link WebLocksSessionLock} (preferred) — `navigator.locks.request` with
 *      `mode:'exclusive'`. The browser holds the lock for as long as our async
 *      callback is pending and releases it automatically when the holding frame
 *      is torn down (no stale-lock recovery needed). This is the durable fix and
 *      is robust to Xibo's visibility quirks (the diagnosis confirmed BOTH
 *      iframes report visible/1920×1080, so visibility alone is insufficient).
 *
 *   2. {@link LeaderElectionSessionLock} (fallback) — a BroadcastChannel +
 *      localStorage leader election with a heartbeat lease, for the rare runtime
 *      without the Web Locks API. A holder renews a `localStorage` lease every
 *      `heartbeatMs`; a waiter claims the lock once the lease goes stale (holder
 *      gone). Same-origin `BroadcastChannel` gives prompt hand-off on a clean
 *      release; the stale-lease timeout covers a crash/unload with no message.
 *
 * Both satisfy the {@link SessionLock} contract: `acquire()` resolves with a
 * `release()` once THIS frame is the sole holder. The composition root awaits
 * the acquire before it connects, and calls release on teardown.
 */

/** A held lock handle. Call {@link release} to give the lock up (idempotent). */
export interface SessionLockHandle {
  release(): void;
}

/**
 * A named, cross-iframe exclusive lock. `acquire` resolves only once THIS caller
 * is the sole holder of `name`; the returned handle releases it. Calling
 * `acquire` again after release re-queues for the lock.
 */
export interface SessionLock {
  /**
   * Wait until this frame holds the lock, then resolve with a release handle.
   * Rejects only if the lock is permanently unavailable (never, in practice).
   */
  acquire(): Promise<SessionLockHandle>;
}

// --- capability-gated factory ------------------------------------------------

/** Minimal structural slice of the Web Locks API we depend on. */
interface LockManagerLike {
  request(
    name: string,
    options: { mode: 'exclusive' | 'shared'; signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
}

/** Minimal structural slice of `BroadcastChannel` we depend on. */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

/** Injected environment seams (defaulted to browser globals in {@link boot}). */
export interface SessionLockEnv {
  locks?: LockManagerLike | null;
  makeBroadcastChannel?: ((name: string) => BroadcastChannelLike) | null;
  storage?: Storage | null;
  now?: () => number;
  /** A process/tab-unique id so a frame never contends with itself. */
  selfId?: string;
}

/**
 * Build the most reliable {@link SessionLock} for `name` available in this
 * runtime: the Web Locks API when present, else the leader-election fallback.
 * `env` is fully injectable so tests drive a deterministic implementation.
 */
export function createSessionLock(name: string, env: SessionLockEnv = {}): SessionLock {
  const locks =
    env.locks !== undefined
      ? env.locks
      : (globalThis.navigator as unknown as { locks?: LockManagerLike } | undefined)?.locks ?? null;
  if (locks) return new WebLocksSessionLock(name, locks);

  const makeBC =
    env.makeBroadcastChannel !== undefined
      ? env.makeBroadcastChannel
      : typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'function'
        ? (n: string) =>
            new (globalThis as unknown as { BroadcastChannel: new (n: string) => BroadcastChannelLike })
              .BroadcastChannel(n)
        : null;
  const storage = env.storage !== undefined ? env.storage : safeLocalStorage();
  return new LeaderElectionSessionLock(name, {
    makeBroadcastChannel: makeBC,
    storage,
    now: env.now ?? (() => Date.now()),
    selfId: env.selfId ?? randomId(),
  });
}

function safeLocalStorage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- 1. Web Locks API implementation (preferred) -----------------------------

/**
 * Web Locks API lock. `navigator.locks.request(name, {exclusive}, cb)` runs `cb`
 * only while THIS frame holds `name`; the lock is held for as long as the promise
 * `cb` returns stays pending, and is released the instant that promise settles OR
 * the holding frame is torn down. So we acquire by handing the browser a promise
 * we resolve ourselves on {@link SessionLockHandle.release}; until then this frame
 * is the sole holder and the other iframe's `request` for the same name blocks.
 */
export class WebLocksSessionLock implements SessionLock {
  constructor(
    private readonly name: string,
    private readonly locks: LockManagerLike,
  ) {}

  acquire(): Promise<SessionLockHandle> {
    return new Promise<SessionLockHandle>((resolveAcquire) => {
      this.locks.request(this.name, { mode: 'exclusive' }, () => {
        // We hold the lock now. Resolve the caller with a release handle whose
        // resolution of THIS held promise relinquishes the lock to the next
        // waiter (the other iframe).
        return new Promise<void>((releaseLock) => {
          let released = false;
          const release = (): void => {
            if (released) return;
            released = true;
            releaseLock();
          };
          resolveAcquire({ release });
        });
      });
    });
  }
}

// --- 2. leader-election fallback (BroadcastChannel + localStorage lease) ------

interface LeaderEnv {
  makeBroadcastChannel: ((name: string) => BroadcastChannelLike) | null;
  storage: Storage | null;
  now: () => number;
  selfId: string;
}

interface LeaseRecord {
  holder: string;
  renewedAt: number;
}

/** Lease heartbeat cadence + staleness window (holder gone ⇒ lease expires). */
const HEARTBEAT_MS = 2_000;
const LEASE_TTL_MS = 6_000; // 3 missed heartbeats ⇒ a waiter may claim.
const CLAIM_POLL_MS = 1_000;

/**
 * BroadcastChannel + localStorage leader election. ONE frame holds the lease,
 * renewing it every {@link HEARTBEAT_MS}; others poll and claim only when the
 * lease is stale (holder unloaded/crashed) or explicitly released. The
 * BroadcastChannel makes a clean release hand off promptly; the stale-lease TTL
 * is the crash-safety net. Best-effort vs the Web Locks primary — there is a
 * narrow claim race two waiters could both pass, resolved by a re-read + last
 * writer check, acceptable because the backend's 4006 eviction is itself the
 * final arbiter if a brief double-connect ever slips through.
 */
export class LeaderElectionSessionLock implements SessionLock {
  private readonly key: string;
  private readonly channel: BroadcastChannelLike | null;

  constructor(
    private readonly name: string,
    private readonly env: LeaderEnv,
  ) {
    this.key = `crowdaq:sessionlock:${name}`;
    this.channel = env.makeBroadcastChannel ? env.makeBroadcastChannel(`crowdaq-lock-${name}`) : null;
  }

  acquire(): Promise<SessionLockHandle> {
    return new Promise<SessionLockHandle>((resolve) => {
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let poll: ReturnType<typeof setInterval> | null = null;
      let held = false;

      const startHolding = (): void => {
        if (held) return;
        held = true;
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        this.writeLease();
        heartbeat = setInterval(() => this.writeLease(), HEARTBEAT_MS);
        if (this.channel) this.channel.postMessage({ type: 'acquired', holder: this.env.selfId });
        resolve({ release: () => doRelease() });
      };

      const tryClaim = (): void => {
        if (held) return;
        const lease = this.readLease();
        const stale = lease === null || this.env.now() - lease.renewedAt > LEASE_TTL_MS;
        if (stale) {
          // Claim, then re-read after a microtask-equivalent to detect a racing
          // claimer; whoever wrote last (matching selfId) wins.
          this.writeLease();
          const after = this.readLease();
          if (after !== null && after.holder === this.env.selfId) startHolding();
        }
      };

      const doRelease = (): void => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        if (held) {
          held = false;
          this.clearLeaseIfOwn();
          if (this.channel) this.channel.postMessage({ type: 'released', holder: this.env.selfId });
        }
        if (this.channel) this.channel.onmessage = null;
      };

      if (this.channel) {
        this.channel.onmessage = (ev): void => {
          const data = ev.data as { type?: string } | null;
          if (data?.type === 'released' && !held) tryClaim();
        };
      }

      // Attempt immediately, then poll for a stale lease (crash hand-off).
      tryClaim();
      if (!held) poll = setInterval(tryClaim, CLAIM_POLL_MS);
    });
  }

  private readLease(): LeaseRecord | null {
    if (!this.env.storage) return null;
    try {
      const raw = this.env.storage.getItem(this.key);
      if (!raw) return null;
      const rec = JSON.parse(raw) as LeaseRecord;
      if (typeof rec.holder === 'string' && typeof rec.renewedAt === 'number') return rec;
      return null;
    } catch {
      return null;
    }
  }

  private writeLease(): void {
    if (!this.env.storage) return;
    try {
      this.env.storage.setItem(
        this.key,
        JSON.stringify({ holder: this.env.selfId, renewedAt: this.env.now() } satisfies LeaseRecord),
      );
    } catch {
      /* storage unavailable — degrade to no-coordination (best effort). */
    }
  }

  private clearLeaseIfOwn(): void {
    const lease = this.readLease();
    if (lease !== null && lease.holder === this.env.selfId && this.env.storage) {
      try {
        this.env.storage.removeItem(this.key);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * An immediately-granting lock (no cross-frame coordination). The default when a
 * test, the CMS preview, or a headless harness wants the legacy single-instance
 * behaviour. Acquire resolves on the next microtask with a no-op release.
 */
export class ImmediateSessionLock implements SessionLock {
  acquire(): Promise<SessionLockHandle> {
    return Promise.resolve({ release: () => {} });
  }
}
