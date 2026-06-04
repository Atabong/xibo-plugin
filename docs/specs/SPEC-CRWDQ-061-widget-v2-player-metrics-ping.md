---
spec_id: SPEC-CRWDQ-061
title: Widget v2 player-side metrics ping
status: impl-ready
owner: player-runtime/widget-v2/observability/journal-sync
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-014]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-061 — Widget v2 player-side metrics ping

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S13 — Journal access + metrics |
| Plane epic | CRWDQ-14 |
| Decisions referenced | D-GRH-29, D-GRH-43, D-GRH-52, D-GRH-60, D-GRH-73, D-GRH-75 |
| Source files | `modules/widget-v2/src/transport/WsClient.ts`, `Dispatcher.ts` (consumed); every template (journal emitters) |
| New files | `modules/widget-v2/src/observability/JournalStore.ts`, `modules/widget-v2/src/observability/JournalSyncClient.ts`, `modules/widget-v2/src/observability/JournalBatcher.ts`, `modules/widget-v2/src/observability/types.ts`, `modules/widget-v2/tests/observability/*.test.ts` |

> **Backend authority note:** The `player_journal` table this player's
> journal entries ultimately land in is created by the authoritative
> backend spec `crowdaq-backend/docs/specs/SPEC-CRWDQ-059` (journal read
> API). The journal *delivery* transport is the WS `JournalSync` frame,
> accepted by the GameDeliveryService WS server
> (`crowdaq-backend` `src/delivery/server.ts:504-509`). Every claim below
> about the `event_type` enum, the row shape, and the `JournalSync` frame
> envelope is cross-checked against the `crowdaq-backend` source
> (`src/db/schema/player-journal.ts`, `src/wire/types.ts`). The backend
> code is the source of truth.

## Module

`player-runtime :: widget-v2 :: observability/journal-sync` — player-side metrics emission per the D-GRH-29 journal scope. Collects per-`PlannedState` render counts, dwell timing (actual vs target), transition errors, template fallback reasons. Batches the entries and sends them to the backend over the WebSocket as a `JournalSync` frame at the cadence configured in `ConfigPush.intervals.journal_sync_ms` (the `intervals` block locked by D-GRH-75).

> **Transport — RESOLVED via backend code cross-check.** The backend
> already defines the journal-delivery transport: the GameDeliveryService
> WS server accepts a `JournalSync` frame from a registered player
> (`crowdaq-backend` `src/delivery/server.ts:504-509`). The wire envelope
> `JournalSyncPayload` (`src/wire/types.ts:110-116`) is
> `{ bar_id, display_id, from_ts, to_ts, entries[] }`. There is NO HTTP
> journal-ingest endpoint: the backend's only HTTP `/journal` route is
> `GET` (read API, SPEC-CRWDQ-059) and it explicitly returns `405` for
> POST. The earlier draft of this spec invented a `POST /journal/sync`
> HTTP endpoint — that endpoint does not exist and shall not be used. The
> player shall send the journal over the WS `JournalSync` frame on the
> existing `WsClient` connection (SPEC-CRWDQ-022). This is a behaviour
> change from the previous draft (HTTP → WS).

## Backend wire-contract facts (SPEC-CRWDQ-059 cross-check)

- The backend `player_journal` table (SPEC-CRWDQ-059 `src/db/schema/player-journal.ts`) is the destination of every ingested row. Its columns: `journal_id` (server-assigned PK), `ts` (timestamptz), `bar_id` (uuid, NOT NULL), `display_id` (uuid, NOT NULL), `event_type` (varchar(64), NOT NULL), `payload` (jsonb, NOT NULL), `seq` (bigint, nullable, "monotonic per (bar, display)"), `ingested_at` (server default).
- **`event_type` is the closed six-member enum `PLAYER_JOURNAL_EVENT_TYPES`** (SPEC-CRWDQ-059): `planned_state_render`, `dwell_timing`, `transition_error`, `template_fallback`, `config_apply`, `heartbeat_ack`. The enum is enforced at the application layer — SPEC-CRWDQ-059's read-API validation rejects any `event_type` outside it with `400 unknown_event_type`, and the ingest path (this spec) MUST apply the same validation. The enum is "extensible without a schema migration" but extending it requires a coordinated SPEC-CRWDQ-059 + SPEC-CRWDQ-061 change.
- An ingested row carries `bar_id` AND `display_id` (both NOT NULL) — the `JournalSync` frame must supply both (the `JournalSyncPayload` envelope carries both at the top level).
- The journal delivery transport is the WS `JournalSync` frame, accepted by the GameDeliveryService WS server from a registered player (`crowdaq-backend` `src/delivery/server.ts:504-509`). The frame envelope is `JournalSyncPayload = { bar_id, display_id, from_ts, to_ts, entries[] }` (`src/wire/types.ts:110-116`), where `entries[]` is `Array<Record<string, unknown>>`.

> **RESOLVED — journal transport is the WS `JournalSync` frame (backend
> code cross-check).** Verified against the `crowdaq-backend` source: the
> delivery server's registered-conn message router has a `JournalSync`
> case (`src/delivery/server.ts:504-509`); the wire envelope is
> `JournalSyncPayload` (`src/wire/types.ts:110-116`). There is no HTTP
> ingest endpoint — `journalApp` mounts only `GET /journal` and returns
> `405` for POST/PUT/PATCH/DELETE, with an inline comment that POST ingest
> is "SPEC-CRWDQ-061's cross-repo path". The player-side delivery contract
> is therefore fully defined: the player shall send journal batches as WS
> `JournalSync` frames over the existing `WsClient` connection. The
> invented `POST /journal/sync` HTTP endpoint is dropped.
>
> **Server-side persistence is unbuilt backend work — not a player
> blocker.** The delivery server currently only *logs* a received
> `JournalSync` frame (`server.ts:505-508` emits a `journal_sync_received`
> log line with an entry count) — it does NOT yet write the `entries[]`
> into the `player_journal` table. The `player_journal` table exists
> (SPEC-CRWDQ-059) and the `GET /journal` read API can query it, but no
> code path inserts rows. Persisting the `JournalSync` frame into
> `player_journal` is a backend task tracked against `crowdaq-backend`; it
> does not block this player spec, because the player-side responsibility
> (build and send the frame) is fully specified and the frame is already
> accepted by the server. Implementations of this spec shall send the
> frame; end-to-end journal visibility depends on the separate backend
> persistence task landing.

> **RESOLVED — player journal taxonomy buckets into the six-member
> `event_type` enum (backend code cross-check).** The backend
> `PLAYER_JOURNAL_EVENT_TYPES` enum is verified against the source as
> exactly six members — `{planned_state_render, dwell_timing,
> transition_error, template_fallback, config_apply, heartbeat_ack}`
> (`crowdaq-backend` `src/db/schema/player-journal.ts:33-40`). The
> SPEC-CRWDQ-014..053 player specs emit dozens of fine-grained journal
> events (`planned_state_activated`, `dwell_boundary_reached`,
> `multi_game_reconciled`, …) — that taxonomy is disjoint from the
> six-member enum. The player therefore shall set the wire `event_type`
> to one of the six backend buckets and carry the fine-grained internal
> event name inside `payload.event` (a string); `emit()` maps each
> internal event to its bucket via the fixed bucket table below. The
> bucketing approach is the adopted resolution; extending the backend
> enum to the full player taxonomy is explicitly not pursued.

## Current shape

- No journal / metrics emission in v1. The widget has a `console.log` debug surface gated by a `debug` URL query parameter, but nothing aggregated, nothing transmitted to the backend.
- The journal is delivered over the existing WebSocket as a `JournalSync` frame (backend `src/delivery/server.ts:504-509`). The player batches entries and sends one `JournalSync` frame per sync tick on the `WsClient` connection (SPEC-CRWDQ-022).
- D-GRH-43 specifies network-layer auth via the tailnet; the WS connection is already authenticated at registration (SPEC-CRWDQ-022) — the `JournalSync` frame carries no separate token.

## Proposed deep interface

```ts
// modules/widget-v2/src/observability/types.ts

/** The closed six-member wire event_type enum — mirrors SPEC-CRWDQ-059's
 *  PLAYER_JOURNAL_EVENT_TYPES. The wire/table only accepts these. */
export type JournalEventType =
  | 'planned_state_render'
  | 'dwell_timing'
  | 'transition_error'
  | 'template_fallback'
  | 'config_apply'
  | 'heartbeat_ack';

export interface JournalEntry {
  seq: number;                                 // monotonic per (bar, display), persisted across reloads
  ts: string;                                  // ISO 8601 UTC
  bar_id: string;                              // UUID — required by the player_journal table (SPEC-CRWDQ-059)
  display_id: string;                          // UUID — required by the player_journal table
  event_type: JournalEventType;                // one of the six backend buckets
  payload: Record<string, unknown>;            // event-specific; payload.event carries the fine-grained internal name
}

export interface JournalConfig {
  syncIntervalMs: number;                      // from ConfigPush.intervals.journal_sync_ms (D-GRH-75); default 60000
  maxBatchSize: number;                        // default 500 entries per JournalSync frame
  maxBatchBytes: number;                       // default 256 KiB — soft cap on the serialized entries[] size
  retainAckedMaxRows: number;                  // default 10000 (7-day / 250 MB ceiling per D-GRH-29; rough proxy)
  retainAckedMaxAgeMs: number;                 // default 7 * 24 * 60 * 60 * 1000
}
```

### Internal-event → `event_type` bucket mapping

`emit()` maps each fine-grained internal journal-event name to one of the six wire `event_type` buckets and stores the original name in `payload.event`:

| Internal event(s) | Wire `event_type` |
|---|---|
| `planned_state_activated`, `ad_slot_rendered`, `multi_game_reconciled`, `fixtures_reconciled`, `live_tile_reconciled`, `override_resolved`, `ambient_creative_advanced` | `planned_state_render` |
| `dwell_boundary_reached` | `dwell_timing` |
| `transition_catalog_miss`, `override_ttl_timeout`, `asset_content_hash_mismatch` | `transition_error` |
| `template_render_fallback`, `template_input_invalid`, `template_buffer_timeout`, `schema_violation_received`, `fixture_cache_miss`, `ad_asset_cache_miss`, `recap_no_gamestate` | `template_fallback` |
| `config_push_received`, `asset_manifest_applied`, `template_locale_refresh` | `config_apply` |
| heartbeat-liveness events (`heartbeat_outstanding`, reconnect-on-ack-timeout) | `heartbeat_ack` |

Any internal event not in the table maps to the nearest bucket by category; the bucket table is the single source of truth and is unit-tested. The fine-grained name is always preserved in `payload.event`.

```ts
// modules/widget-v2/src/observability/JournalStore.ts
export interface JournalStore {
  /** Append-only. Assigns the next seq, persists, returns the assigned seq. */
  append(entryWithoutSeq: Omit<JournalEntry, 'seq'>): Promise<number>;

  /** Returns the next batch of unsynced entries up to the byte/row caps. */
  unsynced(opts: { maxRows: number; maxBytes: number }): JournalEntry[];

  /**
   * Mark a contiguous seq range as sent. The WS `JournalSync` frame is
   * fire-and-forget — the backend sends no ACK frame (it only logs the
   * received frame, `server.ts:505-508`) — so a range is marked sent once
   * the frame has been successfully handed to an OPEN `WsClient`. There
   * is no server-confirmed seq range to honor.
   */
  markSent(seqMin: number, seqMax: number): Promise<void>;

  /** Apply retention rules to the sent prefix. */
  prune(retainMaxRows: number, retainMaxAgeMs: number): Promise<{ pruned: number }>;
}
```

```ts
// modules/widget-v2/src/observability/JournalBatcher.ts
import type { JournalSyncPayload } from '../transport/wire-types';  // SPEC-CRWDQ-022 wire types

export interface JournalBatcher {
  /**
   * Build the next JournalSync frame payload from the unsynced backlog,
   * capped by maxBatchSize / maxBatchBytes. Returns null if there are no
   * unsynced entries. `from_ts` / `to_ts` are the ts of the first / last
   * entry in the batch; `entries[]` is the per-entry JournalEntry list.
   */
  next(): Promise<{ seqMin: number; seqMax: number; payload: JournalSyncPayload; rowCount: number } | null>;
}
```

```ts
// modules/widget-v2/src/observability/JournalSyncClient.ts
export interface JournalSyncClient {
  /**
   * Start the periodic sync loop. Reads syncIntervalMs from JournalConfig
   * (sourced from ConfigPush updates). Fires immediately if there is an
   * unsynced backlog crossing a soft threshold.
   */
  start(): void;
  stop(): void;

  /** Force a sync now; resolves with the send outcome. */
  syncNow(): Promise<SyncOutcome>;

  /** Update the interval at runtime when a new ConfigPush arrives. */
  updateInterval(syncIntervalMs: number): void;
}

export type SyncOutcome =
  | { kind: 'noop'; reason: 'no_unsynced' }
  | { kind: 'sent'; seqMin: number; seqMax: number; rowCount: number }
  | { kind: 'deferred'; reason: 'ws_not_open'; retryInMs: number }
  | { kind: 'failed'; reason: 'ws_send_error'; retryInMs: number };
```

### Journal entry emission

Every spec in the SPEC-CRWDQ-014..053 set names its fine-grained journal events inline. This spec defines the shared `emit(...)` adapter they call; `emit` does the bucket mapping and the `JournalStore.append(...)`:

```ts
// modules/widget-v2/src/observability/index.ts
export function emit(internalEvent: string, payload: Record<string, unknown>): void;
// internally: bucket = bucketFor(internalEvent); JournalStore.append({
//   ts: new Date().toISOString(), bar_id, display_id, event_type: bucket,
//   payload: { ...payload, event: internalEvent } })
```

`emit` never throws — emission is best-effort.

### Wire format

The journal batch is sent as a single WS `JournalSync` frame on the `WsClient` connection. The frame payload is the backend's `JournalSyncPayload` (`crowdaq-backend` `src/wire/types.ts:110-116`):

```ts
// JournalSyncPayload — owned by the wire protocol; consumed verbatim
interface JournalSyncPayload {
  bar_id: string;
  display_id: string;
  from_ts: string;                  // ISO 8601 UTC — ts of the first entry in the batch
  to_ts: string;                    // ISO 8601 UTC — ts of the last entry in the batch
  entries: Array<Record<string, unknown>>;   // one JournalEntry per element
}
```

Each element of `entries[]` is a `JournalEntry` carrying `seq`, `ts`, `bar_id`, `display_id`, the six-bucket `event_type`, and `payload` (with the fine-grained `payload.event`):

```
{"seq":1042,"ts":"...","bar_id":"...","display_id":"...","event_type":"planned_state_render","payload":{"event":"planned_state_activated", ...}}
{"seq":1043,"ts":"...","bar_id":"...","display_id":"...","event_type":"dwell_timing","payload":{"event":"dwell_boundary_reached", ...}}
```

The frame is marshalled and sent through the shared `WsClient` send path (SPEC-CRWDQ-022) — there is no gzip step, no HTTP headers, no separate endpoint. The WS connection is already authenticated at registration (D-GRH-43); the frame carries `bar_id` + `display_id` at the top level for server identification.

Delivery outcome — the WS `JournalSync` frame is fire-and-forget; the backend sends no ACK frame (the delivery server only logs the received frame, `server.ts:505-508`):

- `WsClient` is OPEN and the frame is sent → `SyncOutcome { kind: 'sent' }`; the player calls `JournalStore.markSent(seqMin, seqMax)`. "Sent" means handed to an open socket, not server-confirmed.
- `WsClient` is NOT open (connecting / reconnecting) → `SyncOutcome { kind: 'deferred', ws_not_open }`; entries stay unsynced and are retried on the next tick or on the `WsClient.reconnect` trigger.
- The WS send throws → `SyncOutcome { kind: 'failed', ws_send_error }`; entries stay unsynced; exponential backoff with full jitter, capped at `60 s × 2^min(attempts, 5)`.

### Persistence

`JournalStore` persists entries to IndexedDB (`crowdaq.widgetV2.journal` object store). IndexedDB is chosen over LocalStorage because the entry volume (hundreds per minute under high engagement) exceeds LocalStorage's reasonable size and synchronous-API tail-latency budget.

The `seq` counter persists across widget reloads. Bootstrap reads the highest stored `seq` and continues from there. Per SPEC-CRWDQ-059 the `player_journal` table treats `seq` as monotonic per `(bar_id, display_id)`; since a display belongs to exactly one bar, the player's per-display counter satisfies that. (The backend persistence path that would write `seq` into the table is unbuilt backend work — see the RESOLVED note above — but the player assigns and sends `seq` so it is correct once persistence lands.)

### Retention

Per D-GRH-29: 7-day / 250 MB for sent rows; unsynced uncapped. The `retainAckedMaxRows` + `retainAckedMaxAgeMs` knobs encode this as approximate proxies (the byte budget is hard to enforce precisely from JS without serializing every row; a conservative row count + age is close enough at typical event sizes). Pruning happens after each successful sync. Because the `JournalSync` frame is fire-and-forget, "sent" rows are pruned on the player's own send confirmation, not on a server ACK.

### Cadence

- **Periodic.** Every `syncIntervalMs` (default 60 000; configurable via `ConfigPush.intervals.journal_sync_ms`, D-GRH-75).
- **Backlog-triggered.** If `JournalStore.unsynced({maxRows: maxBatchSize})` returns the full `maxBatchSize`, a sync fires immediately rather than waiting for the interval. This prevents under-provisioning the journal under burst load.
- **Connectivity-triggered.** On `WsClient.on('reconnect')` after a connectivity loss, a sync fires once shortly after — backend visibility into the gap matters, and the `JournalSync` frame can only be sent while the WS is OPEN, so a reconnect is the natural drain point for any backlog accumulated while the socket was down.

### Interaction with `ConfigPush.intervals.journal_sync_ms`

D-GRH-75 locked an `intervals` block on `ConfigPush` carrying `journal_sync_ms`, `heartbeat_ms`, and `manifest_recheck_ms` (amending D-GRH-73). This spec reads `intervals.journal_sync_ms`. `intervals` is a sibling of `preferences` on the `ConfigPush` frame — NOT nested inside `preferences` — and is persisted by SPEC-CRWDQ-014's `PreferenceStore` as part of the full `ConfigPushPayload` (SPEC-CRWDQ-014 owns the player-side `ConfigPushPayload` shape). Conservative bootstrap: if `intervals` or `intervals.journal_sync_ms` is absent (a pre-D-GRH-75 frame), the default `60 000 ms` is used. On every `ConfigPush` the current value flows through `JournalSyncClient.updateInterval(...)`.

### Out of scope

- Reading the journal from the player (no UI to display events; the journal is server-bound — the `GET /journal` read API is SPEC-CRWDQ-059, backend-side).
- Filtering / aggregation client-side — per D-GRH-29 "backend filters and aggregates".
- Heartbeat (covered by SPEC-CRWDQ-022 — a separate WS concern).
- Server-side persistence of the `JournalSync` frame into `player_journal` — unbuilt backend work tracked against `crowdaq-backend` (the delivery server currently only logs the frame); not a player-spec deliverable.
- The `player_journal` table DDL and the `GET /journal` read API — backend-side, SPEC-CRWDQ-059.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| IndexedDB | 1 in-process | jsdom's `fake-indexeddb` or equivalent; real round-trip. |
| `WsClient` send + lifecycle | 2 local-substitutable | `FakeWsClient` records each marshalled `JournalSync` frame, exposes an `open`/`closed` state, and drives `reconnect` events; reused from / aligned with the SPEC-CRWDQ-022 test double. |
| Clock | system boundary | Fake timers; advance to fire intervals. |
| `ConfigPush` source | 2 local-substitutable | Test driver dispatches frames into `ConfigPushHandler`; `JournalSyncClient.updateInterval` is observed. |

Test cases:

- Append + seq monotonicity: 5 `emit(...)` calls → the store has seq 1..5 in order; persisted to IndexedDB; each row carries `bar_id`, `display_id`, a six-bucket `event_type`, and `payload.event`.
- Bucket mapping: `emit('dwell_boundary_reached', ...)` → stored row has `event_type: 'dwell_timing'`, `payload.event: 'dwell_boundary_reached'`; `emit('transition_catalog_miss', ...)` → `event_type: 'transition_error'`. The bucket table is exhaustively asserted.
- Periodic sync happy path: fake clock advance 60 s with 3 unsynced entries, `WsClient` OPEN → one `JournalSync` frame sent through `WsClient`; the frame payload is a valid `JournalSyncPayload` with `bar_id`, `display_id`, `from_ts`/`to_ts`, and an `entries[]` of 3, every entry a valid `JournalEntry` with a six-member `event_type`; outcome `{ kind: 'sent' }`; entries marked sent via `markSent`.
- No unsynced: the timer fires, the store is empty → `SyncOutcome { kind: 'noop' }`; no frame sent.
- Batch byte cap: emit 1000 entries; the first frame's `entries[]` is ≤ `maxBatchBytes` and ≤ `maxBatchSize`; subsequent frames drain the rest.
- Backlog trigger: emit `maxBatchSize` entries instantly → sync fires without waiting for the interval; the remaining backlog drains on the timer.
- Connectivity-triggered: dispatch a `WsClient.reconnect` lifecycle event → sync fires once shortly after; any backlog accumulated while the socket was down drains in the post-reconnect frame.
- WS not open: the timer fires with unsynced entries but `WsClient` is connecting/reconnecting → `SyncOutcome { kind: 'deferred', ws_not_open }`; no frame sent; entries remain unsynced and drain on the next tick or on `reconnect`.
- WS send error: `WsClient.send` throws → `SyncOutcome { kind: 'failed', ws_send_error, retryInMs ≈ 60s }` (first-attempt jitter range); entries remain unsynced; the next attempt picks them up with exponential backoff.
- ConfigPush interval update: dispatch a `ConfigPush` with `intervals.journal_sync_ms: 30000` → `updateInterval(30000)` fires; the next interval tick is 30 s.
- Retention prune: after a successful send, with `retainAckedMaxRows: 5`, the store has 10 sent rows → the 5 oldest are pruned; `prune` returns `{ pruned: 5 }`; journal `journal_retention_pruned`.
- Bootstrap from reload: pre-seed IndexedDB with seq 1..100 (50 sent, 50 unsynced) → `JournalStore` resumes; the next emit assigns seq 101; the next sync sends seq 51..100.

## Vocabulary

- `seq` — a monotonic per-`(bar, display)` journal counter (SPEC-CRWDQ-059; D-GRH-29).
- "JournalSync" — the WS frame carrying a batch of journal entries (`JournalSyncPayload`, `crowdaq-backend` `src/wire/types.ts:110-116`); accepted by the delivery server from a registered player (`src/delivery/server.ts:504-509`). Fire-and-forget — no ACK frame.
- `event_type` — the closed six-member wire enum `{planned_state_render, dwell_timing, transition_error, template_fallback, config_apply, heartbeat_ack}` (SPEC-CRWDQ-059 `PLAYER_JOURNAL_EVENT_TYPES`, verified `src/db/schema/player-journal.ts:33-40`).
- "sent prefix" — the contiguous seq range whose `JournalSync` frame has been handed to an OPEN `WsClient`. There is no server-confirmed prefix (the frame is fire-and-forget).
- "bucket mapping" — the fixed table mapping each fine-grained internal journal-event name to one of the six wire `event_type` buckets; the internal name is preserved in `payload.event`.

## Acceptance Criteria

- [ ] `JournalStore.append({ts, bar_id, display_id, event_type, payload})` assigns the next monotonic `seq`, persists the entry to IndexedDB under `crowdaq.widgetV2.journal`, and returns the assigned seq; every persisted row carries a non-null `bar_id`, `display_id`, and an `event_type` from the six-member enum.
- [ ] `seq` is monotonic per-display, persists across widget reloads (bootstrap reads the highest stored seq and continues from there).
- [ ] `emit(internalEvent, payload)` from `modules/widget-v2/src/observability/index.ts` maps `internalEvent` to one of the six `event_type` buckets via the fixed bucket table, stores the fine-grained name in `payload.event`, and appends via `JournalStore`; it never throws.
- [ ] Every `entries[]` element in a sent `JournalSync` frame is a `JournalEntry` whose `event_type` is one of the six `PLAYER_JOURNAL_EVENT_TYPES` (SPEC-CRWDQ-059) — the player never sends an `event_type` the backend `player_journal` table would reject.
- [ ] The journal batch is sent as a WS `JournalSync` frame (`JournalSyncPayload` = `{bar_id, display_id, from_ts, to_ts, entries[]}`, `crowdaq-backend` `src/wire/types.ts:110-116`) through the shared `WsClient` send path (SPEC-CRWDQ-022) — not over HTTP. There is no `POST /journal/sync` endpoint and no gzip step.
- [ ] `JournalSyncClient.start()` runs a periodic loop that ticks at `syncIntervalMs` (default 60 000; updated via `updateInterval(...)` on `ConfigPush` arrival when `intervals.journal_sync_ms` is present, per D-GRH-75).
- [ ] When the `WsClient` is OPEN, a tick with unsynced entries sends one `JournalSync` frame and marks the seq range sent via `JournalStore.markSent(...)`; "sent" means handed to an open socket — the frame is fire-and-forget and the backend returns no ACK frame.
- [ ] Backlog trigger: when `JournalStore.unsynced(...)` reaches `maxBatchSize`, a sync fires immediately without waiting for the interval.
- [ ] Connectivity trigger: a `WsClient.reconnect` lifecycle event fires a sync once shortly after, draining any backlog accumulated while the socket was down.
- [ ] Failure handling: when the `WsClient` is not open, the outcome is `SyncOutcome { kind: 'deferred', ws_not_open }` and entries stay unsynced; when the WS send throws, the outcome is `SyncOutcome { kind: 'failed', ws_send_error }` with exponential backoff (full jitter, capped at `60 s × 2^min(attempts, 5)`); entries are never lost — they remain unsynced until a frame is successfully sent.
- [ ] Retention: after each successful send, sent rows older than `retainAckedMaxAgeMs` OR beyond `retainAckedMaxRows` count are pruned; unsynced rows are never pruned.
- [ ] Tests cover all enumerated cases: append+seq, bucket mapping, periodic happy, no-unsynced noop, batch byte cap, backlog trigger, connectivity trigger, WS-not-open deferral, WS send error with backoff, interval update via ConfigPush, retention prune, bootstrap-from-reload.
- [ ] No mocks of `JournalStore`, `JournalBatcher`, or IndexedDB internals (INV-FACTORY-16); only the `WsClient` send + lifecycle and the clock are substituted (INV-FACTORY-17).
