---
spec_id: SPEC-CRWDQ-014
title: Widget v2 ConfigPush consumer with local cache + apply
status: draft
parent: S2
area: player-runtime/widget-v2/config
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-014 — Widget v2 ConfigPush consumer with local cache + apply

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S2 — Bar onboarding (BarPreferences + ConfigPush) |
| Plane epic | CRWDQ-3 |
| Decisions referenced | D-GRH-23, D-GRH-36, D-GRH-49, D-GRH-51, D-GRH-60, D-GRH-61, D-GRH-73 |
| Source files | `modules/crowdaq-widget.xml` (legacy v1 SSE stencil — untouched) |
| New files | `modules/widget-v2/src/config/ConfigPushHandler.ts`, `modules/widget-v2/src/config/PreferenceStore.ts`, `modules/widget-v2/src/config/ApplyPreferenceState.ts`, `modules/widget-v2/src/config/types.ts`, `modules/widget-v2/tests/config/ConfigPushHandler.test.ts`, `modules/widget-v2/tests/config/PreferenceStore.test.ts` |
| Blocked by | SPEC-CRWDQ-013 (backend `ConfigPush` publisher) |

## Module

`player-runtime :: widget-v2 :: config` — the player-side ConfigPush handler that receives `ConfigPush` frames (D-GRH-60 + D-GRH-73), persists them in widget-local storage, applies preferences to the render state on the next dwell boundary, and tracks `config_hash` for drift detection.

## Current shape

- Widget v1 (`modules/crowdaq-widget.xml`) is a single inline `<onRender>` block speaking SSE. There is no `ConfigPush` concept on the player today — `apiBaseUrl`, `eventId`, and `theme` arrive as Xibo widget properties baked at layout-publish time. Multi-bar resolution is done by reading `xiboIC.info()` at render boot.
- No persistent local store of bar preferences exists. The widget never writes to IndexedDB or LocalStorage; theme is a CSS class applied from the Twig property block.
- Therefore there is no `config_hash`, no eviction model, no drift detection, and no in-process notion of "next dwell boundary." Preferences cannot change without a fresh layout publish from the CMS.

Widget v2 (the target of this slice) introduces a long-lived JSONL WebSocket session (SPEC-CRWDQ-022) over which the bar's preferences are pushed at runtime. This spec defines the consumer of those pushes — purely the bar-profile-snapshot side; rules are not consumed client-side (D-GRH-60 explicitly excludes rules).

## Proposed deep interface

A single entry point invoked by the WebSocket dispatcher (SPEC-CRWDQ-022):

```ts
// modules/widget-v2/src/config/ConfigPushHandler.ts
export interface ConfigPushHandler {
  /**
   * Called by the WS dispatcher whenever a frame with
   * message_type === "ConfigPush" arrives. Synchronous shape decisions
   * (parse, validate, hash compare) happen inline; async persistence
   * is awaited. The handler never throws — invalid payloads journal a
   * `config_push_received` event with `accepted: false` and return.
   */
  handle(frame: unknown): Promise<ConfigPushOutcome>;
}

export type ConfigPushOutcome =
  | { kind: 'first_push'; preferences: BarPreferences; configHash: string }
  | { kind: 'unchanged'; configHash: string }
  | { kind: 'replaced'; previousHash: string; configHash: string; evictedKeys: string[] }
  | { kind: 'rejected'; reason: ConfigRejectReason };

export type ConfigRejectReason =
  | 'schema_invalid'
  | 'timezone_invalid_iana'
  | 'theme_id_invalid'
  | 'config_hash_missing';
```

Backed by:

```ts
// modules/widget-v2/src/config/PreferenceStore.ts
export interface PreferenceStore {
  load(): Promise<{ preferences: BarPreferences; configHash: string } | null>;
  save(snapshot: { preferences: BarPreferences; configHash: string }): Promise<void>;
  evictPreferenceDerivedCache(): Promise<string[]>; // returns evicted cache keys for journaling (D-GRH-60)
}
```

```ts
// modules/widget-v2/src/config/ApplyPreferenceState.ts
export interface ApplyPreferenceState {
  /**
   * Queue a preference change to take effect at the next dwell
   * boundary. Never forces re-render of the active PlannedState.
   * Returns the boundary the apply is bound to.
   */
  queueApply(preferences: BarPreferences): { applyAt: 'next_dwell_boundary' };
}
```

`BarPreferences` matches the D-GRH-73 schema lock exactly — the type module is the single source of truth and must reject any extra/missing fields:

```ts
// modules/widget-v2/src/config/types.ts
export interface BarPreferences {
  theme_id: string | null | '__unset__';   // D-GRH-51 three-state
  sports: string[];
  leagues: string[];
  region: string;
  state: string;
  city: string;
  timezone: string;                         // IANA TZ; validated against Intl.supportedValuesOf('timeZone')
  business_hours: BusinessHoursEntry[];
  local_team_list: string[];
}

export interface BusinessHoursEntry {
  day_of_week: 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun';
  start_local: string;                      // HH:MM 24h
  end_local: string;                        // HH:MM 24h
}
```

### Behavior contract

1. **Receive.** Dispatcher hands an unparsed frame. Handler enforces `message_type === "ConfigPush"`, presence of `preferences` (object), `config_hash` (non-empty string).
2. **Validate.** Each field validated against the D-GRH-73 schema lock. `theme_id` follows the three-state rule (D-GRH-51). `timezone` must parse via `Intl.DateTimeFormat(undefined, { timeZone: x })` without exception. `business_hours[].day_of_week` ∈ closed enum; `start_local`/`end_local` match `^([01]\d|2[0-3]):[0-5]\d$`.
3. **Compare.** If `PreferenceStore.load()` returns a snapshot whose `configHash === incoming.configHash`, return `{ kind: 'unchanged' }`. No write, no apply, no eviction. Journal a `config_push_received` event (D-GRH-29) with `applied: false, reason: "hash_match"`.
4. **Replace.** Hash differs (or no prior snapshot): persist new snapshot via `PreferenceStore.save(...)`, call `evictPreferenceDerivedCache()` (returns the asset/theme cache keys whose validity depends on prior preferences per D-GRH-60), and `queueApply(preferences)`. Journal `config_push_received` with `applied: true, evicted_keys: [...]`.
5. **Apply.** `ApplyPreferenceState.queueApply` records the pending preferences in an in-memory slot the render loop reads at every `dwell_target_ms` boundary. On boundary, the active CSS theme stylesheet swap (D-GRH-51) and filter set update happen between the outgoing transition end and the next `PlannedState` activation. **No re-render is forced.** The currently rendered `PlannedState` runs out its dwell as-is.
6. **Reconnect.** On WS re-establish (SPEC-CRWDQ-022), the server re-pushes `ConfigPush` first (D-GRH-49 + D-GRH-61). Same handler path; hash-equal pushes are a no-op.

### Persistence target

LocalStorage under key `crowdaq.widgetV2.barPreferences`, value = JSON-encoded `{ preferences, configHash }`. LocalStorage chosen over IndexedDB because the payload is < 4 KB even at the high end and the synchronous read at boot avoids a frame of "empty preferences" before the WS opens. Eviction of preference-derived state lives in a separate key namespace (`crowdaq.widgetV2.assetCache.*`) — `PreferenceStore.evictPreferenceDerivedCache()` enumerates and removes matching keys. The handler does not touch CSS `<link>` tags directly; that responsibility lives in the theme apply path (out of scope for this spec; arrives with SPEC-CRWDQ-023 single_game render).

### Idempotency rules

- Identical `config_hash` arriving N times: exactly one journal entry per arrival (drift visibility), zero writes, zero evictions, zero applies.
- First-ever push (no prior snapshot): treated as `replaced` for storage but journaled as `first_push` for analytics.
- Frame missing `config_hash` (D-GRH-73 frame contract violation): reject with `config_hash_missing`; do not fall back to content-hashing the preferences ourselves — the server-supplied hash is canonical (D-GRH-36).

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| WebSocket frame source | 3 remote-owned | In-test driver feeds raw frame objects into `handle(...)` directly; no real socket. |
| LocalStorage | 1 in-process | Real call against jsdom's storage; one fresh instance per test. |
| Preference-derived asset cache | 2 local-substitutable | `InMemoryAssetCacheAdapter` implementing the same eviction interface used by SPEC-CRWDQ-023. |
| Render loop dwell boundary | 2 local-substitutable | `ApplyQueueProbe` that records `queueApply` calls; the render loop itself is not exercised. |
| `Intl.DateTimeFormat` TZ validation | 1 in-process | Real call; jsdom passes IANA TZ checks. |
| Journal sink | 2 local-substitutable | Memory journal; assert event types + payload shape. |
| Time (`Date.now`) | system boundary | Frozen clock per INV-FACTORY-17. |

Test cases (Vitest + jsdom; one assertion per ACE category, no internal mocking per INV-FACTORY-16):

- First push: storage empty → outcome `first_push`, snapshot persisted, apply queued, journal `applied: true`.
- Hash-match push: outcome `unchanged`, no storage write, no apply, journal `applied: false, reason: "hash_match"`.
- Hash-different push: outcome `replaced`, prior cache keys returned in `evictedKeys`, apply queued.
- Schema-invalid push (missing `timezone`): outcome `rejected: schema_invalid`, no write, journal still emitted with `accepted: false`.
- Invalid IANA TZ (`"Mars/Olympus"`): outcome `rejected: timezone_invalid_iana`.
- `theme_id` three-state coverage: `"dark_sport"`, `null`, `"__unset__"` all accepted; numeric / array / undefined rejected.
- Reconnect path: simulated re-push of identical hash 2× → exactly 2 journal entries, exactly 0 writes.
- Concurrent boundary apply: `queueApply` called twice before a boundary tick → second call replaces first; one apply at boundary; journal `superseded_by: <hash>` for first.

## Vocabulary

Shared protocol vocabulary is defined in `C:/Users/Atabong/Documents/GitHub/xibo/docs/specs/SPEC-CATALOG.md` under "Common vocabulary." This spec uses:

- `ConfigPush` — control-channel frame, schema in D-GRH-60 + D-GRH-73.
- `BarPreferences` — Tier-1 schema lock in D-GRH-71 + D-GRH-73.
- `config_hash` — server-computed bar-profile hash (D-GRH-36).
- `dwell boundary` — the instant the current `PlannedState.dwell_target_ms` elapses (D-GRH-21).
- `preference-derived cache` — any client cache entry whose key derives from preferences (theme CSS, sport badge sets, local_team_list filter results).

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-013 — backend `ConfigPush` publisher must emit the D-GRH-73 payload over `bar.<bar_id>.control` before this consumer has anything to read.

**Blocks (downstream):**

- SPEC-CRWDQ-022 — WS client dispatches `ConfigPush` frames to this handler.
- SPEC-CRWDQ-023, 031, 034, 041, 046, 052, 053 — render templates that read the applied theme + filter state.
- SPEC-CRWDQ-027 — e2e smoke test asserts the full re-push sequence includes a `ConfigPush` first frame.

## Acceptance Criteria

- [ ] `modules/widget-v2/src/config/types.ts` exports `BarPreferences`, `BusinessHoursEntry` exactly matching the D-GRH-73 field set (9 top-level fields, business_hours entry with the 3 keys above); extra or missing fields cause the validator to reject.
- [ ] `modules/widget-v2/src/config/ConfigPushHandler.ts` exports a `ConfigPushHandler` whose `handle(frame)` returns `ConfigPushOutcome` exactly as specified — one of `first_push | unchanged | replaced | rejected` — and never throws on malformed input.
- [ ] `theme_id` accepts all three of `"<string>"`, `null`, `"__unset__"` (D-GRH-51) and rejects any other type with `rejected: schema_invalid`.
- [ ] `timezone` is validated against `Intl.DateTimeFormat(undefined, { timeZone })`; invalid values produce `rejected: timezone_invalid_iana`.
- [ ] `business_hours[].day_of_week` enforces the closed enum `mon|tue|wed|thu|fri|sat|sun`; `start_local`/`end_local` enforce `^([01]\d|2[0-3]):[0-5]\d$`.
- [ ] `modules/widget-v2/src/config/PreferenceStore.ts` persists to LocalStorage key `crowdaq.widgetV2.barPreferences` as JSON `{preferences, configHash}` and `load()` returns the round-tripped snapshot or `null` when absent.
- [ ] On hash-equal `ConfigPush`, the handler performs zero storage writes, zero cache evictions, zero `queueApply` calls, and emits exactly one journal entry with `applied: false, reason: "hash_match"`.
- [ ] On hash-different `ConfigPush`, the handler persists the new snapshot, calls `evictPreferenceDerivedCache()`, calls `queueApply(preferences)` once, and emits a journal entry with `applied: true` and the evicted-key list in payload.
- [ ] `ApplyPreferenceState.queueApply(...)` records the pending preferences in a single slot — repeated calls before a dwell boundary replace, not append; the journal records the superseded prior hash.
- [ ] No re-render is forced: the handler never calls into the render loop's transition or `PlannedState` activation paths. The only side effect on render is via the dwell-boundary read of the pending-apply slot.
- [ ] PG-equivalent test suite (jsdom Vitest) covers: first push, hash-match, hash-different, schema-invalid, invalid TZ, theme three-state, repeated-reconnect idempotency, supersede-on-second-queueApply.
- [ ] No mocks of internal collaborators (INV-FACTORY-16): tests use real `PreferenceStore` against jsdom LocalStorage, real `InMemoryAssetCacheAdapter`, real `ApplyQueueProbe` — only the WS source and the clock are substituted.
