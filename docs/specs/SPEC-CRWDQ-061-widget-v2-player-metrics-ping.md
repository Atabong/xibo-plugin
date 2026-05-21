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
| Decisions referenced | D-GRH-25, D-GRH-29, D-GRH-43, D-GRH-52, D-GRH-60, D-GRH-73, D-GRH-75 |
| Source files | `modules/widget-v2/src/transport/WsClient.ts`, `Dispatcher.ts` (consumed); every template (journal emitters) |
| New files | `modules/widget-v2/src/observability/JournalStore.ts`, `modules/widget-v2/src/observability/JournalSyncClient.ts`, `modules/widget-v2/src/observability/JournalBatcher.ts`, `modules/widget-v2/src/observability/types.ts`, `modules/widget-v2/tests/observability/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: observability/journal-sync` — player-side metrics emission per D-GRH-29 journal scope. Collects per-`PlannedState` render counts, dwell timing (actual vs target), transition errors, template fallback reasons. Batches into JSONL. POSTs (gzip) to the `/journal/sync` endpoint per D-GRH-52 at the cadence configured in `ConfigPush.intervals.journal_sync_ms` (the `intervals` block locked by D-GRH-75). Transport is HTTP — explicitly NOT the WS — per D-GRH-52's transport separation rationale.

## Current shape

- No journal / metrics emission in v1. The widget has a `console.log` debug surface, gated by a `debug` URL query parameter, but nothing aggregated, nothing transmitted to the backend.
- D-GRH-29 enumerates the journal event types — `planned_state_activated`, `ad_slot_rendered`, `override_received`, `fallback_entered`, `fallback_exited`, `game_state_received`, `game_event_received`, `asset_fetch_completed`, `connectivity_lost`, `connectivity_restored`, `config_push_received`, `heartbeat_mismatch`, `device_registration_sent`, `journal_sync_sent`, plus any spec-specific extensions like `template_render_fallback`, `dwell_boundary_reached`, `multi_game_reconciled`, etc., used throughout the SPEC-CRWDQ-014..053 specs.
- D-GRH-52 specifies: HTTP POST, gzip-compressed JSONL, `Content-Encoding: gzip`, `Content-Type: application/x-ndjson`, retry with backoff, server returns ACK with accepted seq range.
- D-GRH-43 specifies network-layer auth via tailnet — no JWT/token on the journal POST.

## Proposed deep interface

```ts
// modules/widget-v2/src/observability/types.ts
export interface JournalEntry {
  seq: number;                                 // monotonic per-display, persisted across reloads
  ts: string;                                  // ISO 8601 UTC
  event_type: string;                          // D-GRH-29 closed set + spec extensions
  payload: Record<string, unknown>;            // event-specific
}

export interface JournalConfig {
  syncIntervalMs: number;                      // from ConfigPush.intervals.journal_sync_ms (D-GRH-75); default 60000
  maxBatchSize: number;                        // default 500 entries per POST
  maxBatchBytes: number;                       // default 256 KiB pre-gzip
  retainAckedMaxRows: number;                  // default 10000 (7-day / 250 MB ceiling per D-GRH-29; rough proxy)
  retainAckedMaxAgeMs: number;                 // default 7 * 24 * 60 * 60 * 1000
}
```

```ts
// modules/widget-v2/src/observability/JournalStore.ts
export interface JournalStore {
  /** Append-only. Assigns next seq, persists, returns assigned seq. */
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
   * Start the periodic sync loop. Reads syncIntervalMs from
   * JournalConfig (sourced from ConfigPush updates). Fires immediately
   * if there is an unsynced backlog crossing a soft threshold.
   */
  start(): void;
  stop(): void;

  /** Force a sync now; resolves with the POST outcome. */
  syncNow(): Promise<SyncOutcome>;

  /** Update interval at runtime when a new ConfigPush arrives. */
  updateInterval(syncIntervalMs: number): void;
}

export type SyncOutcome =
  | { kind: 'noop'; reason: 'no_unsynced' }
  | { kind: 'sent'; seqMin: number; seqMax: number; rowCount: number; httpStatus: number }
  | { kind: 'failed'; reason: 'http_error' | 'network_error' | 'gzip_error'; httpStatus?: number; retryInMs: number };
```

### Journal entry emission

Every spec in the SPEC-CRWDQ-014..053 set already names its journal events inline. This spec defines the shared `JournalStore.append(...)` they call. A small adapter is exported per spec area so emitters don't depend on `JournalStore` directly:

```ts
// modules/widget-v2/src/observability/index.ts
export function emit(eventType: string, payload: Record<string, unknown>): void;
// internally appends via JournalStore with ts: new Date().toISOString()
```

### Wire format

POST body — newline-separated JSON objects, one entry per line, all entries belonging to a contiguous `seq` range:

```
{"seq":1042,"ts":"...","event_type":"planned_state_activated","payload":{...}}
{"seq":1043,"ts":"...","event_type":"dwell_boundary_reached","payload":{...}}
...
```

Compression: gzip, with `Content-Encoding: gzip`, `Content-Type: application/x-ndjson`.

Request headers also include:
- `X-Display-Id: <display_id>` — tailnet-level auth + this header for the server's identification (per D-GRH-43 + D-GRH-52).
- `X-Seq-Min`, `X-Seq-Max` — convenience header echo (the body is the source of truth).

Server response:
- `200 OK` with JSON body `{ "ack_seq_min": ..., "ack_seq_max": ... }`. Client calls `JournalStore.ack(ack_seq_min, ack_seq_max)`.
- `4xx` (other than 429): logged + journaled `journal_sync_failed`; not retried.
- `5xx`, `429`, network error: exponential backoff with full jitter, capped at `60 s × 2^min(attempts, 5)`. The retry is part of the same loop; the entries stay unsynced.

### Persistence

`JournalStore` persists entries to IndexedDB (`crowdaq.widgetV2.journal` object store). IndexedDB chosen over LocalStorage here because the entry volume (hundreds per minute under high engagement) exceeds LocalStorage's reasonable size and synchronous-API tail-latency budget.

The `seq` counter persists across widget reloads. Bootstrap reads the highest stored `seq` and continues from there.

### Retention

Per D-GRH-29: 7-day / 250 MB for ACKed rows; unsynced uncapped. The `retainAckedMaxRows` + `retainAckedMaxAgeMs` knobs encode this as approximate proxies (the byte budget is hard to enforce precisely from JS without serializing every row; we use a conservative row count + age, which is close enough at typical event sizes). Pruning happens after each successful sync.

### Cadence

- **Periodic.** Every `syncIntervalMs` (default 60 000; configurable via `ConfigPush.intervals.journal_sync_ms`, D-GRH-75).
- **Backlog-triggered.** If `JournalStore.unsynced({maxRows: maxBatchSize})` returns the full `maxBatchSize`, sync fires immediately rather than waiting for the interval. This prevents under-provisioning the journal under burst load.
- **Connectivity-triggered.** On `WsClient.on('reconnect')` after a `connectivity_lost` event, sync fires once shortly after — backend visibility into the gap matters.

### Interaction with `ConfigPush.intervals.journal_sync_ms`

D-GRH-75 locked an `intervals` block on `ConfigPush` carrying `journal_sync_ms`, `heartbeat_ms`, and `manifest_recheck_ms` (amending D-GRH-73). This spec reads `intervals.journal_sync_ms`. `intervals` is a sibling of `preferences` on the `ConfigPush` frame — NOT nested inside `preferences` — and is persisted by SPEC-CRWDQ-014's `PreferenceStore` as part of the full `ConfigPushPayload`. Conservative bootstrap: if `intervals` or `intervals.journal_sync_ms` is absent (a pre-D-GRH-75 frame), the default `60 000 ms` is used. On every `ConfigPush` the current value flows through `JournalSyncClient.updateInterval(...)`.

### Out of scope

- Reading the journal from the player (no UI to display events; the journal is server-bound).
- Filtering / aggregation client-side — per D-GRH-29 "backend filters and aggregates."
- Heartbeat (covered by SPEC-CRWDQ-022 — separate concern, on the WS not HTTP).
- Per-event ACK granularity — server ACKs ranges per D-GRH-52.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| IndexedDB | 1 in-process | jsdom's `fake-indexeddb` or equivalent; real round-trip. |
| `fetch` (HTTP POST) | system boundary | `FakeFetchAdapter` injected; records request body, headers, status code; returns canned responses. |
| Gzip | 1 in-process | Real `CompressionStream` if available, else `pako` shim — exercise real bytes. |
| Clock | system boundary | Fake timers; advance to fire intervals. |
| WS lifecycle events | 2 local-substitutable | `FakeWsLifecycle` from SPEC-CRWDQ-052 reused. |
| `ConfigPush` source | 2 local-substitutable | Test driver dispatches frames into `ConfigPushHandler`; `JournalSyncClient.updateInterval` is observed. |

Test cases:

- Append + seq monotonicity: 5 `emit(...)` calls → store has seq 1..5 in order; persisted to IndexedDB.
- Periodic sync happy path: fake clock advance 60 s with 3 unsynced entries → one POST with gzip body containing all 3 JSONL lines; `X-Seq-Min`, `X-Seq-Max`, `X-Display-Id` headers; server responds 200 with `ack_seq_min`/`ack_seq_max`; entries marked ACKed.
- No unsynced: timer fires, store empty → `SyncOutcome { kind: 'noop' }`; no `fetch` call.
- Batch byte cap: emit 1000 entries; first POST contains ≤ `maxBatchBytes` and ≤ `maxBatchSize`; subsequent POSTs drain the rest.
- Backlog trigger: emit `maxBatchSize` entries instantly → sync fires without waiting for the interval; remaining backlog drained on the timer.
- Connectivity-triggered: dispatch `WsClient.reconnect` lifecycle → sync fires once shortly after.
- HTTP 5xx retry: server returns 503 → outcome `failed: http_error, retryInMs ≈ 60s` (first attempt jitter range); entries remain unsynced; next attempt picks them up.
- HTTP 429: same backoff path; honor `Retry-After` header if present (cap by `60 × 2^N`).
- HTTP 4xx (non-429): `failed: http_error`; entries remain unsynced; loop continues normal interval.
- Network error (`fetch` throws): `failed: network_error`; exponential backoff with full jitter.
- Gzip failure: simulate `CompressionStream` throw → `failed: gzip_error`; entries remain unsynced; alarm via `console.error` AND journal (recursive: append a `journal_sync_gzip_error` entry — yes, the journal can journal its own faults; the retry will eventually drain).
- ACK partial: server returns smaller `ack_seq_max` than `seqMax` → only the ACKed range is marked; remainder retries next interval.
- ACK out of order: ignore (next sync naturally extends the ACK range).
- ConfigPush interval update: dispatch a `ConfigPush` with `intervals.journal_sync_ms: 30000` → `updateInterval(30000)` fires; next interval tick is 30 s.
- Retention prune: after ACK, with `retainAckedMaxRows: 5`, store has 10 ACKed rows → 5 oldest pruned; `prune` returns `{ pruned: 5 }`; journal `journal_retention_pruned`.
- Bootstrap from reload: pre-seed IndexedDB with seq 1..100 (50 ACKed, 50 unsynced) → `JournalStore` resumes; next emit assigns seq 101; next sync sends seq 51..100.

## Vocabulary

- `seq` — monotonic per-display journal counter (D-GRH-29 + D-GRH-52).
- "JournalSync" — HTTP POST endpoint per D-GRH-52.
- "ACKed prefix" — contiguous seq range the server has confirmed accepting.

## Acceptance Criteria

- [ ] `JournalStore.append({ts, event_type, payload})` assigns the next monotonic `seq`, persists the entry to IndexedDB under `crowdaq.widgetV2.journal`, and returns the assigned seq.
- [ ] `seq` is monotonic per-display, persists across widget reloads (bootstrap reads the highest stored seq and continues from there).
- [ ] `JournalSyncClient.start()` runs a periodic loop that ticks at `syncIntervalMs` (default 60 000; updated via `updateInterval(...)` on `ConfigPush` arrival when `intervals.journal_sync_ms` is present, per D-GRH-75).
- [ ] Each sync POSTs gzip-compressed JSONL to `/journal/sync` with `Content-Encoding: gzip`, `Content-Type: application/x-ndjson`, `X-Display-Id`, `X-Seq-Min`, `X-Seq-Max` headers; body decodes to one JSON object per line.
- [ ] Server `200` with `{ack_seq_min, ack_seq_max}` triggers `JournalStore.ack(...)`; ACKed prefix is then prunable.
- [ ] Backlog trigger: when `JournalStore.unsynced(...)` reaches `maxBatchSize`, sync fires immediately without waiting for the interval.
- [ ] Connectivity trigger: `WsClient.reconnect` lifecycle event fires sync once shortly after.
- [ ] Failure handling: HTTP 5xx / 429 / network error → exponential backoff with full jitter, capped at `60 s × 2^min(attempts, 5)`; HTTP 4xx (non-429) → no retry, entries remain unsynced for next interval; gzip error → journal a `journal_sync_gzip_error` (the journal can journal its own faults); all failures emit a `SyncOutcome { kind: 'failed' }`.
- [ ] Partial ACK (server returns smaller `ack_seq_max` than POSTed) is honored — only the confirmed prefix is marked.
- [ ] Retention: after each successful sync, ACKed rows older than `retainAckedMaxAgeMs` OR beyond `retainAckedMaxRows` count are pruned; unsynced rows are never pruned.
- [ ] `emit(eventType, payload)` from `modules/widget-v2/src/observability/index.ts` is the shared adapter every template uses; it never throws (failures are best-effort).
- [ ] Tests cover all enumerated cases: append+seq, periodic happy, no-unsynced noop, batch byte cap, backlog trigger, connectivity trigger, 5xx retry, 429 with `Retry-After`, 4xx no-retry, network error, gzip failure (with self-journaling), partial ACK, out-of-order ACK ignored, interval update via ConfigPush, retention prune, bootstrap-from-reload.
- [ ] No mocks of `JournalStore`, `JournalBatcher`, gzip, or IndexedDB internals (INV-FACTORY-16); only `fetch`, the clock, and `WsClient.reconnect` lifecycle are substituted (INV-FACTORY-17).
