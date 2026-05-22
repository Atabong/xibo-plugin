---
spec_id: SPEC-CRWDQ-061
title: Widget v2 player-side metrics ping
status: draft
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

> **Backend authority note:** The `player_journal` table this player POSTs
> into is created by the authoritative backend spec
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-059` (journal read API), which
> explicitly scopes the *ingest POST* to THIS spec. Every claim below about
> the `event_type` enum and the row shape is cross-checked against
> SPEC-CRWDQ-059's `player_journal` Drizzle schema. The backend table is
> the source of truth for the ingested row shape.

## Module

`player-runtime :: widget-v2 :: observability/journal-sync` — player-side metrics emission per the D-GRH-29 journal scope. Collects per-`PlannedState` render counts, dwell timing (actual vs target), transition errors, template fallback reasons. Batches into JSONL. POSTs (gzip) to the backend journal-ingest endpoint per D-GRH-52 at the cadence configured in `ConfigPush.intervals.journal_sync_ms` (the `intervals` block locked by D-GRH-75). Transport is HTTP — explicitly NOT the WS — per D-GRH-52's transport separation.

## Backend wire-contract facts (SPEC-CRWDQ-059 cross-check)

- The backend `player_journal` table (SPEC-CRWDQ-059 `src/db/schema/player-journal.ts`) is the destination of every ingested row. Its columns: `journal_id` (server-assigned PK), `ts` (timestamptz), `bar_id` (uuid, NOT NULL), `display_id` (uuid, NOT NULL), `event_type` (varchar(64), NOT NULL), `payload` (jsonb, NOT NULL), `seq` (bigint, nullable, "monotonic per (bar, display)"), `ingested_at` (server default).
- **`event_type` is the closed six-member enum `PLAYER_JOURNAL_EVENT_TYPES`** (SPEC-CRWDQ-059): `planned_state_render`, `dwell_timing`, `transition_error`, `template_fallback`, `config_apply`, `heartbeat_ack`. The enum is enforced at the application layer — SPEC-CRWDQ-059's read-API validation rejects any `event_type` outside it with `400 unknown_event_type`, and the ingest path (this spec) MUST apply the same validation. The enum is "extensible without a schema migration" but extending it requires a coordinated SPEC-CRWDQ-059 + SPEC-CRWDQ-061 change.
- An ingested row carries `bar_id` AND `display_id` (both NOT NULL) — the POST must supply both, not just `display_id`.

> **OPEN QUESTION — the journal-ingest endpoint is not specified backend-side.**
> SPEC-CRWDQ-059 ships the `player_journal` table and the `GET /journal`
> read API, and explicitly states the *ingest POST* "is NOT in this spec's
> scope ... the POST writer is SPEC-CRWDQ-061". But SPEC-CRWDQ-059 mounts
> `journalApp` registering only `GET /` on `/journal` and returns `405` for
> any other method on `/journal` — so the ingest POST cannot simply be
> `POST /journal` on that sub-app. No backend spec defines: (a) the ingest
> endpoint path, (b) the request `Content-Type` / `Content-Encoding`
> contract, (c) the ACK response shape, (d) the auth model for the ingest
> path. This spec assumes a dedicated ingest endpoint `POST /journal/sync`
> with a gzip JSONL body and a `{ack_seq_min, ack_seq_max}` ACK, derived
> from D-GRH-52 — but a backend spec MUST be authored to pin this contract.
> The endpoint path, content headers, and ACK shape below are this spec's
> proposal pending that backend spec; confirm with the backend owner.

> **OPEN QUESTION — player journal taxonomy vs the `event_type` enum.** The
> SPEC-CRWDQ-014..053 player specs emit dozens of fine-grained journal
> events (`planned_state_activated`, `dwell_boundary_reached`,
> `multi_game_reconciled`, `transition_catalog_miss`, `ad_slot_rendered`,
> `template_render_fallback`, `schema_violation_received`, …). The backend
> `player_journal.event_type` column accepts ONLY the six-member enum
> `{planned_state_render, dwell_timing, transition_error,
> template_fallback, config_apply, heartbeat_ack}` (SPEC-CRWDQ-059). The
> player's taxonomy and the backend's enum are disjoint — a POST carrying
> `event_type: "dwell_boundary_reached"` would be rejected
> `unknown_event_type`. **Resolution adopted by this spec:** the wire
> `event_type` is one of the six backend buckets; the fine-grained internal
> event name is carried inside `payload.event` (a string). `emit()` maps
> each internal event to its bucket via a fixed bucket table (below). The
> backend can still slice by the fine-grained name via `payload.event`.
> Confirm this bucketing approach with the backend owner — the alternative
> is extending SPEC-CRWDQ-059's `PLAYER_JOURNAL_EVENT_TYPES` to the full
> player taxonomy, which is a larger coordinated change.

## Current shape

- No journal / metrics emission in v1. The widget has a `console.log` debug surface gated by a `debug` URL query parameter, but nothing aggregated, nothing transmitted to the backend.
- D-GRH-52 specifies: HTTP POST, gzip-compressed JSONL, `Content-Encoding: gzip`, retry with backoff, and a server ACK with the accepted seq range.
- D-GRH-43 specifies network-layer auth via the tailnet — no JWT/token on the journal POST.

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
  maxBatchSize: number;                        // default 500 entries per POST
  maxBatchBytes: number;                       // default 256 KiB pre-gzip
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

  /** Mark a contiguous seq range as ACKed by the server. */
  ack(seqMin: number, seqMax: number): Promise<void>;

  /** Apply retention rules to the ACKed prefix. */
  prune(retainMaxRows: number, retainMaxAgeMs: number): Promise<{ pruned: number }>;
}
```

```ts
// modules/widget-v2/src/observability/JournalBatcher.ts
export interface JournalBatcher {
  /** Build the next gzip-compressed JSONL body + seq range. Returns null if no unsynced entries. */
  next(): Promise<{ seqMin: number; seqMax: number; body: Uint8Array; rowCount: number } | null>;
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

  /** Force a sync now; resolves with the POST outcome. */
  syncNow(): Promise<SyncOutcome>;

  /** Update the interval at runtime when a new ConfigPush arrives. */
  updateInterval(syncIntervalMs: number): void;
}

export type SyncOutcome =
  | { kind: 'noop'; reason: 'no_unsynced' }
  | { kind: 'sent'; seqMin: number; seqMax: number; rowCount: number; httpStatus: number }
  | { kind: 'failed'; reason: 'http_error' | 'network_error' | 'gzip_error'; httpStatus?: number; retryInMs: number };
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

POST body — newline-separated JSON objects, one entry per line, all entries in a contiguous `seq` range. Each line is a `JournalEntry` carrying `bar_id`, `display_id`, the six-bucket `event_type`, and `payload` (with the fine-grained `payload.event`):

```
{"seq":1042,"ts":"...","bar_id":"...","display_id":"...","event_type":"planned_state_render","payload":{"event":"planned_state_activated", ...}}
{"seq":1043,"ts":"...","bar_id":"...","display_id":"...","event_type":"dwell_timing","payload":{"event":"dwell_boundary_reached", ...}}
...
```

Compression: gzip, with `Content-Encoding: gzip`. The request `Content-Type` and the exact endpoint path are part of the unspecified-ingest OPEN QUESTION; this spec proposes `Content-Type: application/x-ndjson` and `POST /journal/sync`.

Request headers also include:
- `X-Display-Id: <display_id>` — tailnet-level auth (D-GRH-43) plus this header for server identification.
- `X-Seq-Min`, `X-Seq-Max` — convenience header echo (the body is the source of truth).

Server response (proposed — pending the backend ingest spec):
- `200 OK` with JSON body `{ "ack_seq_min": ..., "ack_seq_max": ... }`. The client calls `JournalStore.ack(ack_seq_min, ack_seq_max)`.
- `4xx` (other than 429): logged + a `template_fallback`-bucketed `journal_sync_failed` internal event; not retried.
- `5xx`, `429`, network error: exponential backoff with full jitter, capped at `60 s × 2^min(attempts, 5)`. The retry is part of the same loop; the entries stay unsynced.

### Persistence

`JournalStore` persists entries to IndexedDB (`crowdaq.widgetV2.journal` object store). IndexedDB is chosen over LocalStorage because the entry volume (hundreds per minute under high engagement) exceeds LocalStorage's reasonable size and synchronous-API tail-latency budget.

The `seq` counter persists across widget reloads. Bootstrap reads the highest stored `seq` and continues from there. Per SPEC-CRWDQ-059 the backend treats `seq` as monotonic per `(bar_id, display_id)`; since a display belongs to exactly one bar, the player's per-display counter satisfies that.

### Retention

Per D-GRH-29: 7-day / 250 MB for ACKed rows; unsynced uncapped. The `retainAckedMaxRows` + `retainAckedMaxAgeMs` knobs encode this as approximate proxies (the byte budget is hard to enforce precisely from JS without serializing every row; a conservative row count + age is close enough at typical event sizes). Pruning happens after each successful sync.

### Cadence

- **Periodic.** Every `syncIntervalMs` (default 60 000; configurable via `ConfigPush.intervals.journal_sync_ms`, D-GRH-75).
- **Backlog-triggered.** If `JournalStore.unsynced({maxRows: maxBatchSize})` returns the full `maxBatchSize`, a sync fires immediately rather than waiting for the interval. This prevents under-provisioning the journal under burst load.
- **Connectivity-triggered.** On `WsClient.on('reconnect')` after a connectivity loss, a sync fires once shortly after — backend visibility into the gap matters.

### Interaction with `ConfigPush.intervals.journal_sync_ms`

D-GRH-75 locked an `intervals` block on `ConfigPush` carrying `journal_sync_ms`, `heartbeat_ms`, and `manifest_recheck_ms` (amending D-GRH-73). This spec reads `intervals.journal_sync_ms`. `intervals` is a sibling of `preferences` on the `ConfigPush` frame — NOT nested inside `preferences` — and is persisted by SPEC-CRWDQ-014's `PreferenceStore` as part of the full `ConfigPushPayload` (SPEC-CRWDQ-014 owns the player-side `ConfigPushPayload` shape). Conservative bootstrap: if `intervals` or `intervals.journal_sync_ms` is absent (a pre-D-GRH-75 frame), the default `60 000 ms` is used. On every `ConfigPush` the current value flows through `JournalSyncClient.updateInterval(...)`.

### Out of scope

- Reading the journal from the player (no UI to display events; the journal is server-bound — the `GET /journal` read API is SPEC-CRWDQ-059, backend-side).
- Filtering / aggregation client-side — per D-GRH-29 "backend filters and aggregates".
- Heartbeat (covered by SPEC-CRWDQ-022 — a separate concern, on the WS not HTTP).
- Per-event ACK granularity — the server ACKs ranges per D-GRH-52.
- The `player_journal` table DDL and the `GET /journal` read API — backend-side, SPEC-CRWDQ-059.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| IndexedDB | 1 in-process | jsdom's `fake-indexeddb` or equivalent; real round-trip. |
| `fetch` (HTTP POST) | system boundary | `FakeFetchAdapter` injected; records the request body, headers, status code; returns canned responses. |
| Gzip | 1 in-process | Real `CompressionStream` if available, else a `pako` shim — exercise real bytes. |
| Clock | system boundary | Fake timers; advance to fire intervals. |
| WS lifecycle events | 2 local-substitutable | `FakeWsLifecycle` from SPEC-CRWDQ-052 reused. |
| `ConfigPush` source | 2 local-substitutable | Test driver dispatches frames into `ConfigPushHandler`; `JournalSyncClient.updateInterval` is observed. |

Test cases:

- Append + seq monotonicity: 5 `emit(...)` calls → the store has seq 1..5 in order; persisted to IndexedDB; each row carries `bar_id`, `display_id`, a six-bucket `event_type`, and `payload.event`.
- Bucket mapping: `emit('dwell_boundary_reached', ...)` → stored row has `event_type: 'dwell_timing'`, `payload.event: 'dwell_boundary_reached'`; `emit('transition_catalog_miss', ...)` → `event_type: 'transition_error'`. The bucket table is exhaustively asserted.
- Periodic sync happy path: fake clock advance 60 s with 3 unsynced entries → one POST with a gzip body containing all 3 JSONL lines, every line a valid `JournalEntry` with a six-member `event_type`; `X-Seq-Min`, `X-Seq-Max`, `X-Display-Id` headers; server responds 200 with `ack_seq_min`/`ack_seq_max`; entries marked ACKed.
- No unsynced: the timer fires, the store is empty → `SyncOutcome { kind: 'noop' }`; no `fetch` call.
- Batch byte cap: emit 1000 entries; the first POST contains ≤ `maxBatchBytes` and ≤ `maxBatchSize`; subsequent POSTs drain the rest.
- Backlog trigger: emit `maxBatchSize` entries instantly → sync fires without waiting for the interval; the remaining backlog drains on the timer.
- Connectivity-triggered: dispatch a `WsClient.reconnect` lifecycle event → sync fires once shortly after.
- HTTP 5xx retry: server returns 503 → outcome `failed: http_error, retryInMs ≈ 60s` (first-attempt jitter range); entries remain unsynced; the next attempt picks them up.
- HTTP 429: the same backoff path; honor the `Retry-After` header if present (capped by `60 × 2^N`).
- HTTP 4xx (non-429): `failed: http_error`; entries remain unsynced; the loop continues at the normal interval.
- Network error (`fetch` throws): `failed: network_error`; exponential backoff with full jitter.
- Gzip failure: simulate a `CompressionStream` throw → `failed: gzip_error`; entries remain unsynced; an alarm via `console.error` AND a journal entry (`emit('journal_sync_gzip_error', ...)` — the journal can journal its own faults; the retry eventually drains it).
- ACK partial: server returns a smaller `ack_seq_max` than `seqMax` → only the ACKed range is marked; the remainder retries the next interval.
- ACK out of order: ignored (the next sync naturally extends the ACK range).
- ConfigPush interval update: dispatch a `ConfigPush` with `intervals.journal_sync_ms: 30000` → `updateInterval(30000)` fires; the next interval tick is 30 s.
- Retention prune: after ACK, with `retainAckedMaxRows: 5`, the store has 10 ACKed rows → the 5 oldest are pruned; `prune` returns `{ pruned: 5 }`; journal `journal_retention_pruned`.
- Bootstrap from reload: pre-seed IndexedDB with seq 1..100 (50 ACKed, 50 unsynced) → `JournalStore` resumes; the next emit assigns seq 101; the next sync sends seq 51..100.

## Vocabulary

- `seq` — a monotonic per-`(bar, display)` journal counter (SPEC-CRWDQ-059; D-GRH-29 + D-GRH-52).
- "JournalSync" — the HTTP POST ingest path per D-GRH-52 (endpoint path not yet pinned backend-side — see the OPEN QUESTION).
- `event_type` — the closed six-member wire enum `{planned_state_render, dwell_timing, transition_error, template_fallback, config_apply, heartbeat_ack}` (SPEC-CRWDQ-059 `PLAYER_JOURNAL_EVENT_TYPES`).
- "ACKed prefix" — the contiguous seq range the server has confirmed accepting.
- "bucket mapping" — the fixed table mapping each fine-grained internal journal-event name to one of the six wire `event_type` buckets; the internal name is preserved in `payload.event`.

## Acceptance Criteria

- [ ] `JournalStore.append({ts, bar_id, display_id, event_type, payload})` assigns the next monotonic `seq`, persists the entry to IndexedDB under `crowdaq.widgetV2.journal`, and returns the assigned seq; every persisted row carries a non-null `bar_id`, `display_id`, and an `event_type` from the six-member enum.
- [ ] `seq` is monotonic per-display, persists across widget reloads (bootstrap reads the highest stored seq and continues from there).
- [ ] `emit(internalEvent, payload)` from `modules/widget-v2/src/observability/index.ts` maps `internalEvent` to one of the six `event_type` buckets via the fixed bucket table, stores the fine-grained name in `payload.event`, and appends via `JournalStore`; it never throws.
- [ ] Every POSTed JSONL line is a `JournalEntry` whose `event_type` is one of the six `PLAYER_JOURNAL_EVENT_TYPES` (SPEC-CRWDQ-059) — the player never POSTs an `event_type` the backend `player_journal` table would reject.
- [ ] `JournalSyncClient.start()` runs a periodic loop that ticks at `syncIntervalMs` (default 60 000; updated via `updateInterval(...)` on `ConfigPush` arrival when `intervals.journal_sync_ms` is present, per D-GRH-75).
- [ ] Each sync POSTs a gzip-compressed JSONL body with `Content-Encoding: gzip`, `X-Display-Id`, `X-Seq-Min`, `X-Seq-Max` headers; the body decodes to one JSON object per line. (The endpoint path and `Content-Type` follow whatever the backend ingest spec pins — see the OPEN QUESTION; this spec proposes `POST /journal/sync` + `application/x-ndjson`.)
- [ ] A server `200` with `{ack_seq_min, ack_seq_max}` triggers `JournalStore.ack(...)`; the ACKed prefix is then prunable.
- [ ] Backlog trigger: when `JournalStore.unsynced(...)` reaches `maxBatchSize`, a sync fires immediately without waiting for the interval.
- [ ] Connectivity trigger: a `WsClient.reconnect` lifecycle event fires a sync once shortly after.
- [ ] Failure handling: HTTP 5xx / 429 / network error → exponential backoff with full jitter, capped at `60 s × 2^min(attempts, 5)`; HTTP 4xx (non-429) → no retry, entries remain unsynced for the next interval; a gzip error → a self-journaled `journal_sync_gzip_error` event; all failures emit a `SyncOutcome { kind: 'failed' }`.
- [ ] A partial ACK (server returns a smaller `ack_seq_max` than POSTed) is honored — only the confirmed prefix is marked.
- [ ] Retention: after each successful sync, ACKed rows older than `retainAckedMaxAgeMs` OR beyond `retainAckedMaxRows` count are pruned; unsynced rows are never pruned.
- [ ] Tests cover all enumerated cases: append+seq, bucket mapping, periodic happy, no-unsynced noop, batch byte cap, backlog trigger, connectivity trigger, 5xx retry, 429 with `Retry-After`, 4xx no-retry, network error, gzip failure (with self-journaling), partial ACK, out-of-order ACK ignored, interval update via ConfigPush, retention prune, bootstrap-from-reload.
- [ ] No mocks of `JournalStore`, `JournalBatcher`, gzip, or IndexedDB internals (INV-FACTORY-16); only `fetch`, the clock, and the `WsClient.reconnect` lifecycle are substituted (INV-FACTORY-17).
