/**
 * Shared collaborators for the SPEC-CRWDQ-061 observability suite.
 *
 * Per INV-FACTORY-16/-17: `JournalStore`, the bucket mapper, and
 * `JournalSyncClient` are REAL instances. Only the system boundaries are
 * substituted — IndexedDB (via `fake-indexeddb`, installed by the test file
 * that needs a fresh database), the clock (vitest fake timers), and the
 * `WsClient` send + `reconnect` lifecycle (the {@link FakeWsClient} double
 * below, exposing only the narrow surface SPEC-CRWDQ-022 gives a consumer).
 */
import type { PlayerToServerFrame } from '../../src/wire';
import type { LifecycleEvent, LifecycleInfo, LifecycleListener } from '../../src/transport/types';
import type { JournalSyncWsClient } from '../../src/observability/types';
import { journalDbName } from '../../src/observability/JournalStore';

/**
 * Drop a display's journal database so each test starts from an empty store.
 * Uses the standard `indexedDB.deleteDatabase` against the `fake-indexeddb`
 * global the test file installs via `import 'fake-indexeddb/auto'`.
 *
 * `onblocked` is treated as a FAILURE, not success: blocked means an open
 * connection is still holding the database, so the delete has NOT happened —
 * resolving there would let the next test see stale rows (a flake). Tests must
 * `close()` every store they open (the suites do, in `afterEach`) so the delete
 * runs unblocked; if it still blocks, surfacing it points at the leak rather
 * than hiding it.
 */
export function resetJournalDb(displayId = 'disp-1'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(journalDbName(displayId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    req.onblocked = () =>
      reject(new Error(`deleteDatabase blocked for ${displayId}: an open connection was not closed`));
  });
}

/**
 * A scriptable stand-in for the SPEC-CRWDQ-022 `WsClient`, mirroring the REAL
 * accessor surface the JournalSyncClient consumes: the `send` path, the
 * `isOpen()` readiness accessor (the real {@link CrowdaqWsClient} exposes this,
 * NOT a synthetic `readyState`), and the lifecycle events in their real order —
 * the real client emits `reconnect` while STILL CLOSED and only later reopens
 * and emits `open`. {@link reconnectThenOpen} reproduces that order so a test
 * exercises the consumer the same way the real transport drives it.
 */
export class FakeWsClient implements JournalSyncWsClient {
  /** Frames handed to the open socket, in send order. */
  readonly sent: PlayerToServerFrame[] = [];
  /** Open-state flag; flip with {@link open}/{@link drop}. */
  private opened = false;
  /** When set, the next `send` throws to simulate a socket write failure. */
  private throwOnSend = false;
  private readonly listeners: Record<LifecycleEvent, Set<LifecycleListener>> = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    reconnect: new Set(),
  };

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
  }

  drop(): void {
    this.opened = false;
  }

  /** Arm a single send to throw, simulating a transient socket write error. */
  failNextSend(): void {
    this.throwOnSend = true;
  }

  send(frame: PlayerToServerFrame): void {
    if (this.throwOnSend) {
      this.throwOnSend = false;
      throw new Error('simulated ws send failure');
    }
    this.sent.push(frame);
  }

  on(event: LifecycleEvent, listener: LifecycleListener): void {
    this.listeners[event].add(listener);
  }

  /** Drive a lifecycle event into the registered listeners (test seam). */
  emit(event: LifecycleEvent, info: LifecycleInfo = {}): void {
    for (const l of this.listeners[event]) l(info);
  }

  /**
   * Reproduce the real reconnect lifecycle ORDER: `reconnect` fires while the
   * socket is still closed, then the socket reopens and `open` fires. A
   * consumer that drains on `reconnect` would still see a closed socket here;
   * one that drains on `open` (the correct seam) sees it OPEN.
   */
  reconnectThenOpen(info: LifecycleInfo = { attempt: 1 }): void {
    this.emit('reconnect', info);
    this.open();
    this.emit('open', {});
  }

  /** JournalSync frames sent so far (filtered for readability). */
  journalFrames(): Array<Extract<PlayerToServerFrame, { message_type: 'JournalSync' }>> {
    return this.sent.filter(
      (f): f is Extract<PlayerToServerFrame, { message_type: 'JournalSync' }> =>
        f.message_type === 'JournalSync',
    );
  }
}
