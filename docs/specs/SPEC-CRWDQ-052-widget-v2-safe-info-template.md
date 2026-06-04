---
spec_id: SPEC-CRWDQ-052
title: Widget v2 safe_info render template
status: impl-ready
owner: player-runtime/widget-v2/templates/safe
depends_on: [SPEC-CRWDQ-014, SPEC-CRWDQ-022, SPEC-CRWDQ-023, SPEC-CRWDQ-064]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-052 — Widget v2 safe_info render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S11 — Safe / ambient fallback |
| Plane epic | CRWDQ-12 |
| Decisions referenced | D-GRH-21, D-GRH-22, D-GRH-23, D-GRH-30, D-GRH-31, D-GRH-50, D-GRH-51, D-GRH-73, D-GRH-76, D-SAFE-01 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `GameStateStore.ts` (consumed from SPEC-CRWDQ-023); `AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064) |
| New files | `modules/widget-v2/src/templates/safe-info/SafeInfoTemplate.ts`, `modules/widget-v2/src/templates/safe-info/safe-info.html`, `modules/widget-v2/src/templates/safe-info/safe-info.css`, `modules/widget-v2/src/render/SafeStateController.ts`, `modules/widget-v2/tests/templates/safe-info/*.test.ts` |

> **Backend authority note:** The backend-authored `safe_info` `PlannedState`
> consumed by this template is produced by the authoritative backend spec
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-051` (fallback-mode selection),
> over the wire-protocol envelope of `SPEC-CRWDQ-017`. Every claim below
> about the `safe_info` frame shape, the `business_mode` value, the
> `template_id`, and the absence of a `safe_reason` wire field is
> cross-checked against SPEC-CRWDQ-051. The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: templates/safe-info` — the `safe_info` business-mode template (one of the nine `business_mode` values in the closed SPEC-CRWDQ-017 `PlannedStatePayload.business_mode` enum). A static, sport-neutral, theme-aware information panel with venue branding from `BarPreferences` (D-GRH-73). No game-data dependencies; always renders; offline-safe per D-SAFE-01.

`safe_info` is reached three ways — a backend-authored `PlannedState{business_mode: "safe_info"}` (SPEC-CRWDQ-051), the player-side D-SAFE-01 connectivity/staleness fallback (`SafeStateController`), and a content template's `template_input_invalid` escalation. All three converge on this template. (`ambient`, SPEC-CRWDQ-053, is a separate `business_mode` value, not a sibling variant under a `safe` family — there is no `safe` super-family or `sub` field; `business_mode` carries `safe_info` directly. The value is `safe_info`, not `safe`.)

> **Dependencies.** Consumes the shared orchestration of SPEC-CRWDQ-023 (`PlannedStateActivator`, `GameStateStore`), the `AssetManifestStore` of SPEC-CRWDQ-064 (venue-brand asset), and the `BarPreferences` / `ConfigPushHandler` of SPEC-CRWDQ-014 — all in `depends_on`. SPEC-CRWDQ-051 (`BarPlayerSchedulerService` fallback-mode selection) is the cross-repo `crowdaq-backend` producer of backend-authored `safe_info` `PlannedState`s — a wire-contract counterpart, not a build dependency.

## Backend wire-contract facts (SPEC-CRWDQ-051 / -017 cross-check)

- The backend-authored `safe_info` `PlannedState` discriminator is `business_mode === "safe_info"` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`; value `safe_info`, NOT `safe`).
- A backend `safe_info` `PlannedState` carries `template_id: "safe-info-default"`, `transition: "cut"`, `interrupt_class: "scheduled"`, `ad_slot_id: null`, a backend-authored `dwell_target_ms`, and a non-null `program_slot_id` referencing a freshly minted `ProgramSlot` (`primary_game_id: null`, `game_ids: []`, `fixture_ids: []`) — SPEC-CRWDQ-051 `buildFallback`.
- Per SPEC-CRWDQ-051, the backend always emits some content window — `selectMode` never returns empty and `Reprocess` always persists exactly one `PlannedState`; when there is no live game / no fixtures / no ambient inventory the result is a `safe_info` window. The player therefore always has a renderable `PlannedState`.

> **RESOLVED — no backend `safe_reason` field (backend code cross-check).**
> Verified against the `crowdaq-backend` source: `buildFallback`
> (`src/scheduler/build/fallback.ts:103-116`) emits the `safe_info`
> `PlannedState` using the SPEC-CRWDQ-019 schema verbatim, and the wire
> `PlannedStatePayload` (`src/wire/types.ts:31-44`) has no reason field of
> any kind. A backend `safe_info` `PlannedState` shall be treated as
> carrying NO `safe_reason`, no `runtime_reason`, no `reason` — nothing
> distinguishing "scheduled maintenance" from "no content available". The
> player shall derive no reason from the wire. On the `backend_planned`
> path the player shall use the fixed reason `'scheduled'` (a calm,
> non-alarming default) and the safe-state footer shall be empty for it.
> The fallback reason exists only as a server-side WARN log
> (`fallback_mode_unexpected`, `theme_unset_for_bar`) — it is never
> patron-visible and never reaches the player. D-GRH-76 is reconciled
> accordingly below.

> **RESOLVED — D-GRH-76 footer cannot show a runtime reason (backend code
> cross-check).** D-GRH-76 is described as classifying the player
> `runtime_reason` as journal-only. The backend wire carries no reason
> field at all (`src/wire/types.ts:31-44`), so the footer cannot render a
> backend-supplied runtime reason regardless of D-GRH-76's intent. The
> player-fallback `runtime_reason` (`control_channel_lost`, `data_stale`,
> `no_recent_state`) is a player-side classification, not a wire value;
> the player shall journal the specific `runtime_reason` and the footer
> shall show only the calm per-reason phrasings in the table below
> ("Reconnecting…" / "Refreshing…" / "Loading…"). These phrasings are
> player-authored calm indicators, not echoes of any wire field — D-GRH-76's
> journal-only rule applies to the *backend* reason channel, which does not
> exist on the wire.

## Current shape

- No safe / fallback template in v1. The MVP widget shows a "Waiting for CROWDAQ feed…" placeholder when SSE has no events. That is a Twig placeholder, not a state-driven template.
- The `safe_info` `business_mode` is reachable three ways:
  1. The backend authors `PlannedState{business_mode: "safe_info"}` directly (SPEC-CRWDQ-051 — no live game, no fixtures, no ambient inventory).
  2. The player triggers `safe_info` unilaterally when D-SAFE-01 connectivity/staleness conditions hit (control-channel lost, data stale, no recent state) — the `SafeStateController` defined here.
  3. A content template (single-game, multi-game, fixtures, recap, with-ads) hits a `template_input_invalid` / unrecoverable-input condition and escalates to `safe_info` — Path C below.
- All three paths converge on this same template.
- The `safe_info` template is the "preferred" fallback per D-GRH-22 / D-GRH-26 (over `ambient`, which is a separate template — SPEC-CRWDQ-053).

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/safe-info/SafeInfoTemplate.ts
export interface SafeInfoTemplate {
  mount(host: HTMLElement, context: SafeInfoContext): SafeInfoInstance;
}

export interface SafeInfoContext {
  /** The ProgramSlot when entered via a backend PlannedState (Path A);
   *  null when entered via SafeStateController (Path B) or escalation
   *  (Path C). */
  programSlot: ProgramSlotPayload | null;
  /** SPEC-CRWDQ-023 three-state resolved theme (set/default/unset). */
  theme: ResolvedTheme;
  /** Read from the active BarPreferences (D-GRH-73). Drives venue branding.
   *  Null only on a cold boot before the first ConfigPush. */
  barPreferences: BarPreferences | null;
  /** Why are we here? */
  source: SafeSource;
}

export type SafeSource =
  | { kind: 'backend_planned'; reason: 'scheduled' | 'no_content' | 'maintenance' }
  | { kind: 'player_fallback'; reason: 'control_channel_lost' | 'data_stale' | 'no_recent_state' }
  | { kind: 'template_escalation'; reason: 'template_input_invalid' | 'template_buffer_timeout' };

export interface SafeInfoInstance {
  detach(): HTMLElement;
}
```

```ts
// modules/widget-v2/src/render/SafeStateController.ts
export interface SafeStateController {
  /**
   * Subscribes to:
   *  - WsClient lifecycle events (open/close/reconnect).
   *  - GameStateStore staleness probes.
   *  - PlannedStateActivator's "no recent activation" timer.
   * Triggers a safe_info mount when a D-SAFE-01 condition holds.
   */
  start(): void;
  stop(): void;

  /**
   * Called by a content template's PlannedStateActivator path when an
   * unrecoverable template input is detected (Path C). Escalates to
   * safe_info with a `template_escalation` source.
   */
  escalateFromTemplate(reason: 'template_input_invalid' | 'template_buffer_timeout'): void;

  /** Current diagnostic state. */
  state(): { inSafe: boolean; source: SafeSource | null };
}
```

`ResolvedTheme`, `ProgramSlotPayload`, `BarPreferences`, and the `PlannedStateActivator` / `GameStateStore` interfaces are defined by SPEC-CRWDQ-023 / -014 and consumed verbatim. `AssetManifestStore` is owned by SPEC-CRWDQ-064.

### DOM shape

```
<section class="crowdaq-safe-info" data-theme data-source data-reason>
  <header class="cdq-safe-header">
    <span class="cdq-venue-name"><!-- BarPreferences-driven venue brand text --></span>
  </header>
  <div class="cdq-safe-body">
    <h1 class="cdq-safe-title">CROWDAQ</h1>
    <p class="cdq-safe-tagline">Live sports excitement</p>
  </div>
  <footer class="cdq-safe-footer">
    <span class="cdq-safe-status"><!-- subtle, non-alarming status indicator --></span>
  </footer>
</section>
```

The DOM is intentionally minimal. The content is a venue-aware "stay tuned" panel with the bar's brand. D-GRH-73's locked `BarPreferences` schema has no `venue_name` field; the player derives a display from `BarPreferences.city` + `state`, OR uses an asset-cached branded image when one is provided in `AssetManifest`.

### Activation paths

**Path A — backend `PlannedState{business_mode: "safe_info"}`:**

1. Routed by `PlannedStateActivator` like any other mode; the activator resolves the referenced `ProgramSlot` (the backend mints a fresh one — SPEC-CRWDQ-051).
2. `source = { kind: 'backend_planned', reason }`. The backend `safe_info` `PlannedState` carries no reason field (verified against `crowdaq-backend` `src/wire/types.ts:31-44` / `fallback.ts:103-116` — see RESOLVED note above), so the player shall set `reason` to the fixed value `'scheduled'`.
3. Standard transition (`cut` from the backend) + `dwell_target_ms` dwell.

**Path B — player connectivity/staleness fallback via `SafeStateController`:**

1. `SafeStateController.start()` runs at widget boot. It watches:
   - `WsClient` lifecycle: connection-lost ≥ 30 s with no successful reconnect → `'control_channel_lost'`.
   - `GameStateStore` per-active-game staleness: no `GameEvent` for any active game ≥ 120 s while in a content mode → `'data_stale'`.
   - `PlannedStateActivator` no-state timer: no active `PlannedState` ≥ 60 s after WS open → `'no_recent_state'`.
   These three thresholds are player-side D-SAFE-01 values owned by this spec — they are not on the wire and not backend-configurable.
2. When any trigger fires, the controller calls `PlannedStateActivator.activate(syntheticPlannedState({business_mode: 'safe_info'}))`. The synthetic state is a client-built `PlannedState` filling the SPEC-CRWDQ-017 required fields with sentinels: a generated `state_id`, `program_slot_id: null`, `theme_id` = last-known theme, `transition` = `cut` (no animation — consistent with the backend `safe_info` transition and the D-SAFE-01 calm intent), `dwell_target_ms` = `0` (interpreted as infinite — see Dwell). The transition value is player-chosen for the synthetic state; it is not read off any wire frame.
3. `SafeInfoTemplate.mount(...)` runs with `source = { kind: 'player_fallback', reason }`.
4. On D-SAFE-01 recovery (connection back, `GameEvent` received, a real `PlannedState` arrives), the controller cancels the synthetic state — the real activation supersedes it via the normal supersede path.

**Path C — content-template `template_input_invalid` escalation:**

1. A content template (SPEC-CRWDQ-031 / -034 / -041 / -046 / -065 / -066) detects an unrecoverable input condition — `template_input_invalid` (bad `ProgramSlot`, out-of-range card count, empty `fixture_ids`, null `primary_game_id`) or `template_buffer_timeout` (a referenced `ProgramSlot` / `AdSlot` failed to resolve within the 5 s buffer window). The detecting template journals the condition and calls `SafeStateController.escalateFromTemplate(reason)` instead of mounting.
2. The controller routes a synthetic `safe_info` state exactly as Path B step 2, with `source = { kind: 'template_escalation', reason }`.
3. Recovery is the same as Path B: the next valid `PlannedState` arrival supersedes the synthetic safe state.

### Venue branding

The venue name is rendered from a small fallback chain:

1. If `AssetManifestStore.get("venue_brand:" + barPreferences.bar_id)` returns a cached image asset → render `<img>` instead of text (`get()` is the synchronous cache read; SPEC-CRWDQ-064).
2. Else if `barPreferences.city` + `barPreferences.state` are populated → render `<span>${city.toUpperCase()}, ${state.toUpperCase()}</span>`.
3. Else (including `barPreferences === null` on a cold boot) → render the literal `"CROWDAQ"` brand only.

The status footer is a subtle indicator (per D-SAFE-01: safe templates must not alarm — no red borders, no "ERROR" text, no flashing). Status text is `source.reason`-keyed:

| Source kind | Reason | Footer text |
|-------------|--------|-------------|
| `backend_planned` | `scheduled` | (empty) |
| `backend_planned` | `no_content` | (empty) |
| `backend_planned` | `maintenance` | "Brief pause" |
| `player_fallback` | `control_channel_lost` | "Reconnecting…" |
| `player_fallback` | `data_stale` | "Refreshing…" |
| `player_fallback` | `no_recent_state` | "Loading…" |
| `template_escalation` | `template_input_invalid` | "Loading…" |
| `template_escalation` | `template_buffer_timeout` | "Loading…" |

All status text is theme-aware (small caps, low-contrast accent). No motion. Always offline-safe — the template renders entirely from in-memory state with no fetch, no network.

### No motion / no flash

Per the D-GRH-31 anti-flash constraint and the D-SAFE-01 "calm" intent, the safe template runs no animations and no transitions on the inner content. The outer transition from `PlannedStateActivator` runs on activation (the backend supplies `cut`; the synthetic Path B/C state also uses `cut`), but the body itself is static.

### Dwell

If entered via Path A, dwell is `plannedState.payload.dwell_target_ms`. If entered via Path B or Path C, the synthetic state's `dwell_target_ms` is `0`, interpreted by `DwellTimer` as infinite — the template stays mounted until the controller cancels it on recovery (a real `PlannedState` arrival).

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| `WsClient` lifecycle | 2 local-substitutable | `FakeWsLifecycle` driver with explicit event triggers. |
| `GameStateStore` staleness probes | 1 in-process | Real instance; advance clock to age out events. |
| DOM | 1 in-process | jsdom. |
| `AssetManifestStore` | 1 in-process | Real instance with a pre-seeded venue brand asset. |
| `BarPreferences` source | 1 in-process | Real instance from SPEC-CRWDQ-014. |
| Journal sink | 2 local-substitutable | In-memory. |
| Clock | system boundary | Fake timers. |

Test cases:

- Path A backend-planned: dispatch `PlannedState{business_mode: "safe_info"}` → DOM contains `data-source="backend_planned"`, `data-reason="scheduled"` (the fixed value — the backend wire carries no `safe_reason` field), status footer empty.
- Path B control-channel-lost: fire WS close, advance the clock 30 s, no reconnect → the controller triggers `safe_info` with `data-source="player_fallback"`, `data-reason="control_channel_lost"`, footer "Reconnecting…".
- Path B data-stale: simulate an active content mode + age the last `GameEvent` past 120 s → the controller triggers `data_stale`; footer "Refreshing…".
- Path B no-recent-state: WS open + 60 s without a `PlannedState` arrival → the controller triggers `no_recent_state`; footer "Loading…".
- Path C escalation: a content template calls `escalateFromTemplate('template_input_invalid')` → DOM `data-source="template_escalation"`, `data-reason="template_input_invalid"`, footer "Loading…".
- D-SAFE-01 recovery: in a Path B/C safe state, a real `PlannedState{business_mode:"single_game"}` arrives → supersede transitions to the new mode; the safe instance detaches; the controller's `state().inSafe` flips to `false`.
- Venue brand asset present: `AssetManifestStore.get("venue_brand:bar-007")` returns a cached asset → DOM contains `<img>` not city/state text.
- Venue brand asset miss + city/state present: DOM contains text like "CHICAGO, IL".
- Venue brand asset miss + city/state empty (or `barPreferences` null): DOM falls back to the "CROWDAQ" wordmark only.
- No motion: assert no `transition`, `animation`, or `keyframes` CSS properties are applied to any descendant of `.cdq-safe-body` after mount.
- Theme apply at boundary (Path A only): the theme swap occurs per the shared SPEC-CRWDQ-023 semantics.
- Path B/C dwell: the dwell timer is NOT armed with a finite value; the template stays mounted indefinitely until recovery.
- Status footer text matches the source/reason-to-text table exactly.

## Vocabulary

- `safe_info` mode — a `business_mode` value (SPEC-CRWDQ-017 closed 9-value enum; SPEC-CRWDQ-051 `template_id` `safe-info-default`). The value is `safe_info`, not `safe`.
- D-SAFE-01 — the player-side fallback chain; this spec owns the player-side connectivity/staleness thresholds and the synthetic-state synthesis.
- "venue brand" — derived from `BarPreferences` + an optional `AssetManifest` asset; no first-class wire field.
- Path A / B / C — backend-planned / player connectivity-fallback / content-template escalation, respectively.

## Acceptance Criteria

- [ ] `SafeInfoTemplate.mount(host, ctx)` renders `<section class="crowdaq-safe-info" data-theme data-source data-reason>` with a header (venue brand), a body (CROWDAQ wordmark + tagline), and a footer (status text from the source/reason map).
- [ ] Venue-brand fallback chain: asset → city/state text → wordmark only, in that order; the first non-null wins; a null `barPreferences` resolves to the wordmark.
- [ ] Path A: a `PlannedState{business_mode: "safe_info"}` is routed by `PlannedStateActivator` with the backend transition (`cut`) + backend `dwell_target_ms`; `data-source="backend_planned"`; `reason` shall be the fixed value `'scheduled'` because the backend `safe_info` `PlannedState` carries no reason field (verified against `crowdaq-backend` `src/wire/types.ts:31-44`).
- [ ] Path B: `SafeStateController` triggers `safe_info` on `control_channel_lost` (WS down ≥ 30 s, no reconnect), `data_stale` (no `GameEvent` ≥ 120 s in a content mode), and `no_recent_state` (WS open + no `PlannedState` ≥ 60 s); the trigger constructs a synthetic `PlannedState` and routes it via the normal activator.
- [ ] Path C: `SafeStateController.escalateFromTemplate(reason)` mounts `safe_info` with `source.kind === 'template_escalation'` for a content template's `template_input_invalid` / `template_buffer_timeout` condition; this is the escalation entry point that SPEC-CRWDQ-031 / -034 / -041 / -046 reference.
- [ ] On D-SAFE-01 recovery, a real `PlannedState` arrival supersedes the synthetic safe state via the standard supersede flow; the controller's `state().inSafe` flips to `false`.
- [ ] No motion is applied to any descendant of `.cdq-safe-body` after mount: assertions on computed `animation-name` / `transition-property` / `@keyframes` are negative.
- [ ] Footer status text matches the source/reason map exactly: `backend_planned/scheduled` and `backend_planned/no_content` empty, `backend_planned/maintenance` "Brief pause", `player_fallback/control_channel_lost` "Reconnecting…", `player_fallback/data_stale` "Refreshing…", `player_fallback/no_recent_state` "Loading…", both `template_escalation` reasons "Loading…".
- [ ] Path A honors `plannedState.payload.dwell_target_ms`; Paths B and C synthesize `dwell_target_ms: 0`, interpreted as infinite (the timer is not armed with a finite value), and the template stays mounted until recovery.
- [ ] Always offline-safe: the template makes no fetch calls; the venue-brand asset, if needed, is read synchronously from `AssetManifestStore.get(...)`; a cache miss falls back to text per the chain.
- [ ] `ctx.theme` is the SPEC-CRWDQ-023 three-state `ResolvedTheme`; the template renders `data-theme` for `set` / `__default__` / `__unset__` distinctly.
- [ ] Tests cover all three paths, each reason, each fallback rung in the brand chain, D-SAFE-01 recovery supersede, the no-motion assertion, theme apply at boundary (Path A only), and the Path B/C no-finite-dwell behavior.
- [ ] No mocks of `PlannedStateActivator`, `GameStateStore`, `AssetManifestStore`, `BarPreferences`, or `SafeStateController` internals (INV-FACTORY-16); only the `WsClient` lifecycle and the clock are substituted (INV-FACTORY-17).
