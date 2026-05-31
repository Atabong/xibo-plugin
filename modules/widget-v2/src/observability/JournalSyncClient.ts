/**
 * SPEC-CRWDQ-061 — the player-side journal sync client (AC4–AC9).
 *
 * Drains the {@link JournalStore} backlog into WS `JournalSync` frames over the
 * SPEC-CRWDQ-022 send path. Transport is the WS, NOT HTTP (the spec prose's
 * HTTP/gzip `/journal/sync` was superseded by D-GRH-75 + the issue ACs): a
 * batch is a single `JournalSync` envelope handed to the open socket,
 * fire-and-forget, with no ACK frame — handing it to the socket IS the commit,
 * so the store retires the range immediately (AC7).
 *
 * Three triggers fire a sync:
 *  - periodic — `start()` ticks every `syncIntervalMs` (AC6);
 *  - backlog — `onAppended()` fires immediately once the unsynced count reaches
 *    `maxBatchSize`, without waiting for the interval (AC8);
 *  - connectivity — the WS `open` lifecycle event drains the gap once the
 *    socket is actually OPEN (AC9). We deliberately drain on `open`, NOT on
 *    `reconnect`: the real transport emits `reconnect` while still closed and
 *    only later reopens and emits `open`, so draining on `reconnect` would
 *    always defer as `ws_not_open`.
 *
 * Failure handling (AC9): a closed socket defers (entries stay unsynced); a
 * throwing send fails with exponential backoff (full jitter, capped at
 * 60s × 2^min(attempts,5)) and ARMS a timer to retry after that delay. Entries
 * are NEVER lost — they remain unsynced until a frame is successfully handed to
 * the socket.
 */
import type { JournalStore } from './JournalStore';
import type {
  JournalEntry,
  JournalIdentity,
  JournalSyncConfig,
  JournalSyncWsClient,
  SyncOutcome,
} from './types';
import type { JournalSyncEntryWire, JournalSyncFrame } from '../wire';

/** Backoff ceiling base: 60s × 2^min(attempts,5) (AC9). */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_SHIFT = 5;

export interface JournalSyncClientDeps {
  store: JournalStore;
  ws: JournalSyncWsClient;
  identity: JournalIdentity;
  config: JournalSyncConfig;
  /** Player-local clock in ms (injected; vitest fake timers under test). */
  now: () => number;
  /** Jitter RNG in [0,1); injected so backoff is deterministic under test. */
  random: () => number;
}

export type { JournalSyncWsClient } from './types';

export class JournalSyncClient {
  private readonly store: JournalStore;
  private readonly ws: JournalSyncWsClient;
  private readonly identity: JournalIdentity;
  private readonly now: () => number;
  private readonly random: () => number;

  private syncIntervalMs: number;
  private maxBatchSize: number;
  private readonly retainMaxRows: number;
  private readonly retainMaxAgeMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Pending backoff retry, if a failed send armed one (AC9). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive send failures; resets to 0 on a successful send (AC9). */
  private failureAttempts = 0;
  /** Guards against overlapping syncs (a tick during an in-flight syncNow). */
  private inFlight: Promise<SyncOutcome> | null = null;

  constructor(deps: JournalSyncClientDeps) {
    this.store = deps.store;
    this.ws = deps.ws;
    this.identity = deps.identity;
    this.now = deps.now;
    this.random = deps.random;
    this.syncIntervalMs = deps.config.syncIntervalMs;
    this.maxBatchSize = deps.config.maxBatchSize;
    this.retainMaxRows = deps.config.retainMaxRows;
    this.retainMaxAgeMs = deps.config.retainMaxAgeMs;

    // Connectivity trigger (AC9): drain the gap once the socket is actually
    // OPEN. The real transport emits `reconnect` BEFORE it reopens, so draining
    // there would always hit a closed socket and defer; `open` fires after the
    // socket is OPEN, which is the point a send can succeed.
    this.ws.on('open', () => {
      void this.syncNow();
    });
  }

  /** Begin the periodic loop (AC6). Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.syncIntervalMs);
  }

  /** Stop the periodic loop and cancel any pending backoff retry. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cancelRetry();
  }

  /**
   * Update the cadence at runtime when a new ConfigPush carries
   * `intervals.journal_sync_ms` (AC6, D-GRH-75). Re-arms a running loop so the
   * next tick honors the new interval.
   */
  updateInterval(syncIntervalMs: number): void {
    this.syncIntervalMs = syncIntervalMs;
    if (this.timer !== null) {
      this.stop();
      this.start();
    }
  }

  /**
   * Hook the emit path calls after each append. Fires an immediate sync once
   * the unsynced backlog reaches `maxBatchSize` (AC8) so a burst is not held
   * until the interval. Returns the kicked-off sync (or a resolved promise when
   * the threshold is not met) so a caller that wants to await the drain can;
   * the render path calls it fire-and-forget.
   */
  onAppended(): Promise<SyncOutcome | void> {
    if (this.store.unsyncedCount() >= this.maxBatchSize) {
      return this.syncNow();
    }
    return Promise.resolve();
  }

  /**
   * Force a sync now. Builds one frame from the next `maxBatchSize` unsynced
   * rows, hands it to the open socket, and retires the range. Overlapping
   * calls share the in-flight promise so a trigger during a send does not
   * double-send.
   */
  syncNow(): Promise<SyncOutcome> {
    if (this.inFlight !== null) return this.inFlight;
    // Any trigger that runs a sync supersedes a pending backoff retry — cancel
    // it so a successful drain does not leave a stale timer firing later, and a
    // re-failure re-arms a fresh one rather than stacking timers (AC9).
    this.cancelRetry();
    const run = this.runSync().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async runSync(): Promise<SyncOutcome> {
    const batch = this.store.unsynced({ maxRows: this.maxBatchSize });
    if (batch.length === 0) {
      return { kind: 'noop', reason: 'no_unsynced' };
    }

    // AC9 — a closed socket defers; the entries stay unsynced for a later
    // trigger. No frame is built, nothing is retired.
    if (!this.ws.isOpen()) {
      return { kind: 'deferred', reason: 'ws_not_open' };
    }

    const frame = this.buildFrame(batch);
    const seqMin = batch[0]!.seq;
    const seqMax = batch[batch.length - 1]!.seq;

    try {
      this.ws.send(frame);
    } catch {
      // AC9 — a throwing send fails with capped jittered backoff; entries are
      // NOT retired, so the next trigger picks them up. Never lost. Arm a timer
      // to retry after the jittered delay so the batch drains on its own even
      // with no other trigger.
      this.failureAttempts += 1;
      const retryInMs = this.backoffDelay();
      this.armRetry(retryInMs);
      return { kind: 'failed', reason: 'ws_send_error', retryInMs };
    }

    // AC7 — fire-and-forget: handing the frame to the socket is the commit
    // point. Retire the range and clear the failure counter.
    this.failureAttempts = 0;
    await this.store.markSent(seqMin, seqMax);
    // AC1 — retention runs after each successful send: trim the sent set to the
    // newest `retainMaxRows` and drop anything older than `retainMaxAgeMs`.
    // Unsynced rows are never touched. A prune fault must not corrupt the send
    // outcome (the rows are already durably sent) so it is swallowed here.
    try {
      await this.store.prune({
        maxRows: this.retainMaxRows,
        maxAgeMs: this.retainMaxAgeMs,
        now: this.now(),
      });
    } catch {
      // best-effort retention; the next successful send re-attempts the prune.
    }
    return { kind: 'sent', seqMin, seqMax, rowCount: batch.length };
  }

  /** Assemble the `JournalSync` envelope from the batch (AC4, AC5). */
  private buildFrame(batch: readonly JournalEntry[]): JournalSyncFrame {
    const entries: JournalSyncEntryWire[] = batch.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      bar_id: e.bar_id,
      display_id: e.display_id,
      event_type: e.event_type,
      payload: e.payload,
    }));
    return {
      message_type: 'JournalSync',
      bar_id: this.identity.barId,
      display_id: this.identity.displayId,
      from_ts: entries[0]!.ts,
      to_ts: entries[entries.length - 1]!.ts,
      entries,
    };
  }

  /**
   * Schedule a retry after a failed send. Coalesced: a single pending timer at
   * a time (an earlier one is cancelled by {@link syncNow} / {@link cancelRetry}
   * before this is called), so triggers never stack or tight-loop (AC9).
   */
  private armRetry(delayMs: number): void {
    this.cancelRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Exponential backoff with full jitter, capped at 60s × 2^min(attempts,5)
   * (AC9). The cap is the window; the chosen delay is `random() * cap`.
   */
  private backoffDelay(): number {
    const shift = Math.min(this.failureAttempts, BACKOFF_MAX_SHIFT);
    const cap = BACKOFF_BASE_MS * 2 ** shift;
    return Math.round(this.random() * cap);
  }
}
