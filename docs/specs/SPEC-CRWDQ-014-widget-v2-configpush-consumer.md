---
spec_id: SPEC-CRWDQ-014
title: Widget v2 ConfigPush consumer with local cache + apply
status: design-ready
owner: player-runtime/widget-v2/config
depends_on: [SPEC-CRWDQ-017]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-014 — Widget v2 ConfigPush consumer with local cache + apply

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S2 — Bar onboarding (BarPreferences + ConfigPush) |
| Plane epic | CRWDQ-3 |
| Decisions referenced | D-GRH-23, D-GRH-29, D-GRH-36, D-GRH-42, D-GRH-48, D-GRH-49, D-GRH-51, D-GRH-60, D-GRH-61, D-GRH-73 |
| Source files | `modules/crowdaq-widget.xml` (legacy v1 SSE stencil — untouched) |
| New files | `modules/widget-v2/src/config/ConfigPushHandler.ts`, `modules/widget-v2/src/config/PreferenceStore.ts`, `modules/widget-v2/src/config/ApplyPreferenceState.ts`, `modules/widget-v2/src/config/types.ts`, `modules/widget-v2/tests/config/ConfigPushHandler.test.ts`, `modules/widget-v2/tests/config/PreferenceStore.test.ts` |

## Module

`player-runtime :: widget-v2 :: config` — the player-side ConfigPush handler that receives `ConfigPush` frames (D-GRH-60 + D-GRH-73) off the WebSocket dispatcher (SPEC-CRWDQ-022), validates and persists the full payload in widget-local storage, applies preferences to the render state on the next dwell boundary, and tracks `config_hash` for drift detection.

## Current shape

- Widget v1 (`modules/crowdaq-widget.xml`) is a single inline `<onRender>` block speaking SSE. There is no `ConfigPush` concept on the player today — `apiBaseUrl`, `eventId`, and `theme` arrive as Xibo widget properties baked at layout-publish time. Multi-bar resolution is done by reading `xiboIC.info()` at render boot.
- No persistent local store of bar preferences exists. The widget never writes to IndexedDB or LocalStorage; theme is a CSS class applied from the Twig property block.
- Therefore there is no `config_hash`, no eviction model, no drift detection, and no in-process notion of "next dwell boundary." Preferences cannot change without a fresh layout publish from the CMS.

Widget v2 (the target of this slice) introduces a long-lived JSONL WebSocket session (SPEC-CRWDQ-022) over which the bar's preferences are pushed at runtime. This spec defines the consumer of those pushes — purely the bar-profile-snapshot side; rules are not consumed client-side (D-GRH-60 explicitly excludes rules).

## Wire contract (consumed, not defined here)

The `ConfigPush` frame is a wire-protocol `Envelope` defined and owned by **SPEC-CRWDQ-017** (`crowdaq-backend :: shared/wire-protocol`, `src/wire/`). This spec **imports** the wire types — it does NOT hand-author them. Hand-rolling a divergent `BarPreferences` type is the defect this revision corrects (see § Revision note). Per SPEC-CRWDQ-022's "Generated types" rule, all wire types come from the SPEC-CRWDQ-017 module barrel; `xibo-plugin` consumes that TypeScript module directly (no codegen — SPEC-CRWDQ-017 § Stack note).

The frame is `Envelope<ConfigPushPayload>`:

```ts
// imported from the SPEC-CRWDQ-017 wire barrel — declared there, not here
interface Envelope<P> {
  schema_version: number;   // 1 in phase-1; envelope parser rejects != 1
  channel: 'control';       // ConfigPush is pinned to the control channel (D-GRH-48)
  message_type: 'ConfigPush';
  ts: string;               // RFC 3339 UTC
  bar_id?: string;          // UUID
  payload: ConfigPushPayload;
}

interface ConfigPushPayload {
  preferences: BarPreferencesWire;
  config_hash: string;                                  // server-computed (D-GRH-36)
  cache_ceiling_bytes: number;                          // D-GRH-60 asset-cache ceiling
  intervals: { heartbeat_ms: number; journal_sync_ms: number };
}

// D-GRH-73 schema lock — exact on-the-wire snake_case shape.
// Authoritative reference: SPEC-CRWDQ-012 § "Response body" (impl-ready).
interface BarPreferencesWire {
  theme: ThemeChoiceWire;
  sports: string[];
  leagues: string[];
  region: string | null;
  state: string | null;
  city: string | null;
  timezone: string;                                     // IANA TZ name
  business_hours: BusinessHourWire[];
  local_team_list: string[];
  fallback_mode_order: BusinessMode[];                  // order-semantic (D-GRH-26)
}

type ThemeChoiceWire =                                  // D-GRH-51 three-state
  | { state: 'set'; id: string }
  | { state: 'default' }
  | { state: 'unset' };

interface BusinessHourWire {
  day_of_week: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  open_local: string;                                   // HH:MM 24h
  close_local: string;                                  // HH:MM 24h; may be < open_local (overnight)
}

type BusinessMode =
  | 'single_game' | 'multiple_games' | 'multiple_games_with_ads'
  | 'fixtures' | 'fixtures_with_live_game' | 'fixtures_with_ads'
  | 'recap' | 'safe_info' | 'ambient';
```

> **Ordering note for SPEC-CRWDQ-017.** SPEC-CRWDQ-017's `src/wire/types.ts` MUST declare `ConfigPushPayload` with the four fields above (`preferences`, `config_hash`, `cache_ceiling_bytes`, `intervals`) and the nested `BarPreferencesWire` / `ThemeChoiceWire` / `BusinessHourWire` shapes. If the current SPEC-CRWDQ-017 draft's `ConfigPushPayload` is incomplete, that is a SPEC-CRWDQ-017 gap blocking this spec — flag it there.

## Proposed deep interface

A single entry point invoked by the WebSocket dispatcher (SPEC-CRWDQ-022). The dispatcher delivers a structurally-parsed `Envelope` (valid JSON, known `message_type`, envelope-level fields validated by the SPEC-CRWDQ-017 parser); the `payload` content is **not** validated upstream. This handler validates the entire payload against the D-GRH-73 schema lock.

```ts
// modules/widget-v2/src/config/ConfigPushHandler.ts
import type { Envelope, ConfigPushPayload } from '<spec-017-wire-barrel>';

export type ConfigPushFrame = Envelope<ConfigPushPayload>;

export interface ConfigPushHandler {
  /**
   * Called by the WS dispatcher for every frame with
   * message_type === "ConfigPush". The frame's envelope is already
   * valid; its `payload` is unvalidated. Synchronous shape decisions
   * (parse, validate, hash compare) happen inline; async persistence
   * is awaited. The handler NEVER throws — an invalid payload journals
   * a `config_push_received` event with `accepted: false` and returns
   * a `rejected` outcome.
   */
  handle(frame: Envelope<unknown>): Promise<ConfigPushOutcome>;
}

export type ConfigPushOutcome =
  | { kind: 'first_push'; payload: ConfigPushPayload; configHash: string }
  | { kind: 'unchanged'; configHash: string }
  | { kind: 'replaced'; previousHash: string; configHash: string; evictedKeys: string[] }
  | { kind: 'rejected'; reason: ConfigRejectReason };

export type ConfigRejectReason =
  | 'schema_invalid'          // missing, extra, or mistyped field in payload or preferences
  | 'theme_coupling_invalid'  // theme.state vs id coupling violated (D-GRH-51)
  | 'timezone_invalid_iana'   // timezone not resolvable via Intl
  | 'config_hash_missing';    // config_hash absent or empty
```

Backed by:

```ts
// modules/widget-v2/src/config/PreferenceStore.ts
import type { ConfigPushPayload } from '<spec-017-wire-barrel>';

export interface PreferenceStore {
  load(): Promise<{ payload: ConfigPushPayload; configHash: string } | null>;
  save(snapshot: { payload: ConfigPushPayload; configHash: string }): Promise<void>;
  evictPreferenceDerivedCache(): Promise<string[]>; // returns evicted cache keys for journaling (D-GRH-60)
}
```

```ts
// modules/widget-v2/src/config/ApplyPreferenceState.ts
import type { BarPreferencesWire } from '<spec-017-wire-barrel>';

export interface ApplyPreferenceState {
  /**
   * Queue a preference change to take effect at the next dwell
   * boundary. Never forces re-render of the active PlannedState.
   * Returns the boundary the apply is bound to. Records into a single
   * pending slot — see § Idempotency rules.
   */
  queueApply(preferences: BarPreferencesWire): { applyAt: 'next_dwell_boundary' };
}
```

`modules/widget-v2/src/config/types.ts` declares ONLY this handler's own result types (`ConfigPushFrame`, `ConfigPushOutcome`, `ConfigRejectReason`). It MUST NOT redeclare any wire type — `BarPreferencesWire`, `ThemeChoiceWire`, `BusinessHourWire`, `ConfigPushPayload`, `Envelope` are imported from the SPEC-CRWDQ-017 barrel.

### Behavior contract

1. **Receive.** The dispatcher hands an `Envelope<unknown>` with `message_type === "ConfigPush"`. The envelope (`schema_version`, `channel`, `message_type`, `ts`) is already valid — `schema_version` validity in particular is owned by the SPEC-CRWDQ-017 parser, which rejects `schema_version !== 1`; this handler does NOT re-check it.
2. **Validate (closed-shape).** The handler validates `frame.payload` in full against the D-GRH-73 schema lock — it does not trust the payload content. `payload` must be an object with exactly the four keys `preferences`, `config_hash`, `cache_ceiling_bytes`, `intervals`; `preferences` must be an object with exactly the ten keys of `BarPreferencesWire`. A missing key, an extra/unknown key, or a wrong-typed value → `rejected: schema_invalid`. Per-field: `theme` follows the D-GRH-51 discriminated-union rules (see § Error modes); `timezone` must resolve via `Intl.DateTimeFormat(undefined, { timeZone: x })` without throwing; `business_hours[].day_of_week` ∈ the closed `MON..SUN` enum; `open_local`/`close_local` match `^([01]\d|2[0-3]):[0-5]\d$`; `fallback_mode_order[]` entries ∈ the `BusinessMode` enum; `cache_ceiling_bytes` and `intervals.{heartbeat_ms,journal_sync_ms}` are positive integers. `config_hash` must be a non-empty string.
3. **Compare.** If `PreferenceStore.load()` returns a snapshot whose `configHash === incoming.config_hash`, return `{ kind: 'unchanged' }`. No write, no apply, no eviction. Journal a `config_push_received` event (D-GRH-29) with `accepted: true, applied: false, reason: "hash_match"`.
4. **Replace.** Hash differs (or no prior snapshot): persist the **full** `ConfigPushPayload` via `PreferenceStore.save(...)`, call `evictPreferenceDerivedCache()` (returns the asset/theme cache keys whose validity depends on prior preferences per D-GRH-60), and `queueApply(payload.preferences)`. Journal `config_push_received` with `accepted: true, applied: true, evicted_keys: [...]`.
5. **Apply.** `ApplyPreferenceState.queueApply` records the pending preferences in an in-memory slot the render loop reads at every `dwell_target_ms` boundary. On boundary, the active CSS theme stylesheet swap (D-GRH-51) and filter set update happen between the outgoing transition end and the next `PlannedState` activation. **No re-render is forced.** The currently rendered `PlannedState` runs out its dwell as-is.
6. **Reconnect.** On WS re-establish (SPEC-CRWDQ-022), the server re-pushes `ConfigPush` first (D-GRH-49 + D-GRH-61). Same handler path; hash-equal pushes are a no-op.

### Persistence target

LocalStorage under key `crowdaq.widgetV2.barPreferences`, value = JSON-encoded `{ payload, configHash }` where `payload` is the **entire** `ConfigPushPayload` (preferences + `config_hash` + `cache_ceiling_bytes` + `intervals`). This handler is the sole ConfigPush consumer; persisting the whole payload lets other widget-v2 modules read the fields they own from the one snapshot — the asset cache ceiling (`cache_ceiling_bytes`, consumed by SPEC-CRWDQ-064 AssetManifestStore) and the cadence intervals (`intervals`, consumed by the SPEC-CRWDQ-022 heartbeat) — without a second ConfigPush listener. This handler itself only *applies* `payload.preferences`. LocalStorage is chosen over IndexedDB because the payload is < 4 KB even at the high end and the synchronous read at boot avoids a frame of "empty preferences" before the WS opens. Eviction of preference-derived state lives in a separate key namespace (`crowdaq.widgetV2.assetCache.*`) — `PreferenceStore.evictPreferenceDerivedCache()` enumerates and removes matching keys. The handler does not touch CSS `<link>` tags directly; that responsibility lives in the theme apply path (out of scope for this spec; arrives with SPEC-CRWDQ-023 single_game render).

### Error modes

The handler never throws. Every invalid payload returns `{ kind: 'rejected'; reason }` and journals `config_push_received` with `accepted: false, applied: false, reason: <ConfigRejectReason>`.

| Trigger | Reason |
|---------|--------|
| `payload` or `preferences` is not an object; a required key missing; an unknown/extra key present; a field has the wrong JSON type; `business_hours[].day_of_week` outside `MON..SUN`; `open_local`/`close_local` fails the regex; `fallback_mode_order[]` entry not a `BusinessMode`; `theme` not an object or `theme.state` not in `{set,default,unset}`; `cache_ceiling_bytes`/`intervals` not positive integers | `schema_invalid` |
| `theme.state === 'set'` with `id` missing or empty; `theme.state ∈ {default,unset}` with a non-null `id` present | `theme_coupling_invalid` |
| `timezone` does not resolve via `Intl.DateTimeFormat(undefined, { timeZone })` | `timezone_invalid_iana` |
| `config_hash` absent or empty string | `config_hash_missing` |

The `rejected` outcome carries only the `reason` code — there is no free-text message field. There is no client-side fallback to content-hashing the preferences: the server-supplied `config_hash` is canonical (D-GRH-36), so a frame without it is rejected rather than rescued.

### Idempotency rules

- Identical `config_hash` arriving N times: exactly one journal entry per arrival (drift visibility), zero writes, zero evictions, zero applies.
- First-ever push (no prior snapshot): treated as `replaced` for storage but journaled and returned as `first_push` for analytics.
- `handle()` is called serially by the SPEC-CRWDQ-022 dispatcher — "handlers are invoked synchronously in receipt order per logical channel" (SPEC-CRWDQ-022). `handle()` is never re-entered concurrently, so no internal concurrency guard is required; the handler must, however, remain idempotent across **sequential** re-delivery (the reconnect re-push of an identical `config_hash`).
- `queueApply` records into a **single** pending slot: repeated calls before a dwell boundary REPLACE the slot, they do not append. When a replace supersedes a still-pending apply, `ConfigPushHandler` journals the superseded prior hash as `superseded_by: <hash>` on the `config_push_received` event. Journaling is owned entirely by `ConfigPushHandler`; `ApplyPreferenceState.queueApply` is a pure in-memory slot writer with no journal dependency.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| WebSocket frame source | 3 remote-owned | In-test driver feeds `Envelope` objects into `handle(...)` directly; no real socket. |
| Wire types (SPEC-CRWDQ-017) | 1 in-process | Real imported types; fixtures built to the `Envelope<ConfigPushPayload>` shape. |
| LocalStorage | 1 in-process | Real call against jsdom's storage; one fresh instance per test. |
| Preference-derived asset cache | 2 local-substitutable | `InMemoryAssetCacheAdapter` implementing the same eviction interface used by SPEC-CRWDQ-064. |
| Render loop dwell boundary | 2 local-substitutable | `ApplyQueueProbe` that records `queueApply` calls; the render loop itself is not exercised. |
| `Intl.DateTimeFormat` TZ validation | 1 in-process | Real call; jsdom passes IANA TZ checks. |
| Journal sink | 2 local-substitutable | Memory journal; assert event types + payload shape. |
| Time (`Date.now`) | system boundary | Frozen clock per INV-FACTORY-17. |

Test cases (Vitest + jsdom; no internal mocking per INV-FACTORY-16):

- First push: storage empty → outcome `first_push`, full payload persisted, apply queued, journal `accepted: true, applied: true`.
- Hash-match push: outcome `unchanged`, no storage write, no apply, journal `accepted: true, applied: false, reason: "hash_match"`.
- Hash-different push: outcome `replaced`, prior cache keys returned in `evictedKeys`, apply queued.
- Schema-invalid — missing field (`preferences` without `timezone`): outcome `rejected: schema_invalid`, no write, journal `accepted: false`.
- Schema-invalid — extra field (an unknown key in `preferences` or `payload`): outcome `rejected: schema_invalid`.
- `theme` three-state coverage: `{state:'set',id:'dark_sport'}`, `{state:'default'}`, `{state:'unset'}` all accepted.
- `theme` coupling violations: `{state:'set'}` (no `id`), `{state:'set',id:''}`, `{state:'default',id:'x'}`, `{state:'unset',id:'x'}` → `rejected: theme_coupling_invalid`; `theme` not an object / `state:'wat'` → `rejected: schema_invalid`.
- Invalid IANA TZ (`"Mars/Olympus"`): outcome `rejected: timezone_invalid_iana`.
- Missing `config_hash` (absent or empty string): outcome `rejected: config_hash_missing`.
- Reconnect path: simulated re-push of identical hash 2× → exactly 2 journal entries, exactly 0 writes.
- Supersede: `queueApply` reached twice before a boundary tick → second call replaces first; one apply at boundary; journal `superseded_by: <hash>` for the first.
- Full-payload persistence round-trip: after a `replaced` push, `PreferenceStore.load()` returns the entire `ConfigPushPayload` including `cache_ceiling_bytes` and `intervals` byte-equal to the pushed frame.
- No forced re-render: `ConfigPushHandler` is constructed with no render-loop port; the only render-affecting side effect observed by `ApplyQueueProbe` is the dwell-boundary read of the pending-apply slot.

## Vocabulary

Shared protocol vocabulary is defined in `xibo/docs/specs/SPEC-CATALOG.md` under "Common vocabulary." This spec uses:

- `ConfigPush` — control-channel frame, `Envelope<ConfigPushPayload>`; schema in D-GRH-60 + D-GRH-73; envelope owned by SPEC-CRWDQ-017.
- `BarPreferences` — Tier-1 schema lock in D-GRH-71 + D-GRH-73; on-the-wire shape is `BarPreferencesWire` (SPEC-CRWDQ-012 § Response body).
- `config_hash` — server-computed bar-profile hash (D-GRH-36).
- `dwell boundary` — the instant the current `PlannedState.dwell_target_ms` elapses (D-GRH-21).
- `preference-derived cache` — any client cache entry whose key derives from preferences (theme CSS, sport badge sets, local_team_list filter results).

## Revision note

The original draft of this spec hand-authored a `BarPreferences` type that diverged from the locked D-GRH-73 contract: a flat `theme_id: string | null | '__unset__'` instead of the `theme: {state,id}` discriminated object; non-nullable `region`/`state`/`city`; a missing `fallback_mode_order` field; and `business_hours` element keys `{day_of_week:'mon'.., start_local, end_local}` instead of `{day_of_week:'MON'.., open_local, close_local}`. As specified, the consumer could not parse a single real `ConfigPush` frame emitted by SPEC-CRWDQ-013. This revision replaces the hand-authored type with the SPEC-CRWDQ-017 wire import, persists the full `ConfigPushPayload`, and corrects `depends_on` to the wire module.

## Acceptance Criteria

- [ ] All wire types (`Envelope`, `ConfigPushPayload`, `BarPreferencesWire`, `ThemeChoiceWire`, `BusinessHourWire`, `BusinessMode`) are imported from the SPEC-CRWDQ-017 wire module; `modules/widget-v2/src/config/types.ts` declares only `ConfigPushFrame`, `ConfigPushOutcome`, `ConfigRejectReason` and contains no hand-rolled wire-type duplicate.
- [ ] `ConfigPushHandler.handle(frame)` returns a `ConfigPushOutcome` — one of `first_push | unchanged | replaced | rejected` — and never throws on any input.
- [ ] The handler validates `payload` closed-shape against D-GRH-73: `payload` carries exactly `{preferences, config_hash, cache_ceiling_bytes, intervals}` and `preferences` carries exactly the ten `BarPreferencesWire` fields; any missing, extra, or mistyped field → `rejected: schema_invalid`.
- [ ] `theme` is consumed as the discriminated object `{state:'set';id} | {state:'default'} | {state:'unset'}`: `theme` not an object or `state` outside the enum → `rejected: schema_invalid`; `set` without a non-empty `id`, or `default`/`unset` with an `id` present → `rejected: theme_coupling_invalid`.
- [ ] `timezone` is validated via `Intl.DateTimeFormat(undefined, { timeZone })` (invalid → `rejected: timezone_invalid_iana`); `business_hours[].day_of_week` enforces `MON|TUE|WED|THU|FRI|SAT|SUN`; `open_local`/`close_local` enforce `^([01]\d|2[0-3]):[0-5]\d$`; `region`/`state`/`city` accept `string` or `null`; `fallback_mode_order[]` entries are validated against `BusinessMode`.
- [ ] `config_hash` absent or an empty string → `rejected: config_hash_missing`, with no fallback to client-side content-hashing.
- [ ] `PreferenceStore` persists the entire `ConfigPushPayload` (preferences + `config_hash` + `cache_ceiling_bytes` + `intervals`) to LocalStorage key `crowdaq.widgetV2.barPreferences` as JSON `{payload, configHash}`; `load()` returns the round-tripped snapshot or `null` when absent.
- [ ] On hash-equal `ConfigPush` the handler performs zero storage writes, zero cache evictions, zero `queueApply` calls, and emits exactly one journal entry `accepted: true, applied: false, reason: "hash_match"`; on hash-different `ConfigPush` it persists the new snapshot, calls `evictPreferenceDerivedCache()`, calls `queueApply(payload.preferences)` once, and emits a journal entry `accepted: true, applied: true` with the evicted-key list.
- [ ] `ApplyPreferenceState.queueApply(...)` records into a single pending slot — repeated calls before a dwell boundary replace, not append; `ConfigPushHandler` journals the superseded prior hash as `superseded_by`. The handler never calls the render loop's transition or `PlannedState` activation paths and is constructed with no render-loop port.
- [ ] Vitest + jsdom suite, no internal-collaborator mocks (INV-FACTORY-16/17 — real `PreferenceStore` on jsdom LocalStorage, real `InMemoryAssetCacheAdapter`, real `ApplyQueueProbe`; only the WS source and the clock substituted), covers: first push, hash-match, hash-different, schema-invalid (missing + extra field), theme three-state + coupling violations, invalid IANA TZ, `config_hash_missing`, reconnect idempotency, supersede-on-second-queueApply, and full-payload persistence round-trip.
