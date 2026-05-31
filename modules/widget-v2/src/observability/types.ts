/**
 * SPEC-CRWDQ-061 — widget observability / journal-sync types.
 *
 * The closed `event_type` set is the WIDGET TWIN of the backend
 * `player_journal` ingest enum (crowdaq-backend `src/db/schema/player-journal.ts`).
 * Those six values are the ONLY `event_type`s the backend ingest validates
 * against; emitting anything else would be rejected at the table (AC4). They
 * are owned by SPEC-CRWDQ-059; this constant is the coordinator-authorized
 * widget mirror (same authorization pattern as the SPEC-CRWDQ-014 wire twin).
 * Drift between this twin and the backend enum is a SPEC-CRWDQ-059 concern.
 */
export const PLAYER_JOURNAL_EVENT_TYPES = [
  'planned_state_render',
  'dwell_timing',
  'transition_error',
  'template_fallback',
  'config_apply',
  'heartbeat_ack',
] as const;

/** One of the six closed-set journal event buckets the backend accepts. */
export type PlayerJournalEventType = (typeof PLAYER_JOURNAL_EVENT_TYPES)[number];

/** Runtime membership check against the closed set. */
export function isPlayerJournalEventType(value: unknown): value is PlayerJournalEventType {
  return (
    typeof value === 'string' &&
    (PLAYER_JOURNAL_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A persisted journal row. `seq` is the monotonic per-display counter the
 * store assigns; `bar_id` / `display_id` are stamped from the store's bound
 * identity so every row is self-describing on the wire (AC1). `event_type` is
 * always one of the six closed-set buckets; the fine-grained internal event
 * name (e.g. `planned_state_activated`) lives in `payload.event` (AC3).
 */
export interface JournalEntry {
  seq: number;
  ts: string;
  bar_id: string;
  display_id: string;
  event_type: PlayerJournalEventType;
  payload: Record<string, unknown>;
}

/** What a caller appends — the store assigns `seq`, `bar_id`, `display_id`. */
export interface JournalAppend {
  ts: string;
  event_type: PlayerJournalEventType;
  payload: Record<string, unknown>;
}

/** The store's bound display identity, stamped onto every row. */
export interface JournalIdentity {
  barId: string;
  displayId: string;
}

/**
 * The narrow slice of the SPEC-CRWDQ-022 `WsClient` the sync client consumes:
 * the `send` path, the lifecycle subscription, and `isOpen()` so the client can
 * gate "is the socket open" before attempting a send (AC7/AC9). This mirrors
 * the REAL transport surface — `WsClient.isOpen()` (not a synthetic
 * `readyState` the production client never exposed), and the lifecycle events
 * in their real order (`reconnect` is emitted BEFORE the socket reopens; `open`
 * fires once it is actually OPEN). Declared as its own interface (not the full
 * `WsClient`) so the sync client depends only on what it uses and the test
 * double stays minimal (INV-17).
 */
export interface JournalSyncWsClient {
  isOpen(): boolean;
  send(frame: import('../wire').PlayerToServerFrame): void;
  on(
    event: import('../transport/types').LifecycleEvent,
    listener: import('../transport/types').LifecycleListener,
  ): void;
}

/** Tunable cadence + batch knobs (sourced from ConfigPush at runtime). */
export interface JournalSyncConfig {
  /** From `ConfigPush.intervals.journal_sync_ms`; default 60000. */
  syncIntervalMs: number;
  /** Rows per JournalSync frame; reaching it triggers an immediate sync (AC8). */
  maxBatchSize: number;
  /**
   * Byte ceiling for a single JournalSync frame's serialized entries (AC2 batch
   * byte cap); default 256 KiB. A burst larger than this splits across frames
   * so no one frame exceeds the transport's size budget.
   */
  maxBatchBytes: number;
  /**
   * Retention row cap for SENT rows (AC1). After each successful send the store
   * prunes its sent set down to the newest `retainMaxRows`. Default 10000 — the
   * D-GRH-29 7-day / 250 MB ceiling expressed as a conservative row proxy.
   */
  retainMaxRows: number;
  /**
   * Retention age cap for SENT rows in ms (AC1). Sent rows older than this are
   * pruned after each successful send. Default 7 days per D-GRH-29.
   */
  retainMaxAgeMs: number;
}

/**
 * The outcome of a single sync attempt. `sent` means the frame was handed to
 * an open socket (fire-and-forget, no ACK — AC7). `noop` means nothing to
 * send. `deferred` / `failed` leave the entries unsynced for a later attempt
 * (AC9); `failed` additionally carries the backoff delay before the next try.
 */
export type SyncOutcome =
  | { kind: 'noop'; reason: 'no_unsynced' }
  | { kind: 'sent'; seqMin: number; seqMax: number; rowCount: number }
  | { kind: 'deferred'; reason: 'ws_not_open' }
  | { kind: 'failed'; reason: 'ws_send_error'; retryInMs: number };
