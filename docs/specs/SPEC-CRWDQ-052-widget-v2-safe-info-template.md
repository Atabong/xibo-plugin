---
spec_id: SPEC-CRWDQ-052
title: Widget v2 safe_info render template
status: draft
owner: player-runtime/widget-v2/templates/safe
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-051]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-052 — Widget v2 safe_info render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S11 — Safe / ambient fallback |
| Plane epic | CRWDQ-12 |
| Decisions referenced | D-GRH-21, D-GRH-22, D-GRH-23, D-GRH-25, D-GRH-30, D-GRH-50, D-GRH-51, D-GRH-73, D-SAFE-01 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/safe-info/SafeInfoTemplate.ts`, `modules/widget-v2/src/templates/safe-info/safe-info.html`, `modules/widget-v2/src/templates/safe-info/safe-info.css`, `modules/widget-v2/src/render/SafeStateController.ts`, `modules/widget-v2/tests/templates/safe-info/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/safe` — the `safe` business-mode template family, instance: `safe_info` (D-GRH-30 mode #8). A static, sport-neutral, theme-aware information panel with venue branding from `BarPreferences` (D-GRH-73). No game data dependencies; always renders; offline-safe per D-SAFE-01.

The catalog row names this spec `safe_info render template` — the broader `safe` mode dispatch on `business_mode` is shared with the player-side D-SAFE-01 fallback path (loss of connectivity, stale data) and the backend's explicit `safe` emission. Both paths converge on this same template family per D-GRH-30.

## Current shape

- No safe / fallback template in v1. The MVP widget shows a "Waiting for CROWDAQ feed…" placeholder when SSE has no events. That's a Twig placeholder, not a state-driven template.
- D-GRH-30 mode #8 (`safe`) is reachable two ways:
  1. Backend authors `PlannedState{mode: safe}` directly (e.g., scheduled maintenance, no content available).
  2. Player triggers the safe template family unilaterally when D-SAFE-01 conditions hit (control-channel lost, data stale, no recent state).
- Both paths converge on this same template. The player-trigger path is the `SafeStateController` defined here.
- The `safe_info` template is the "preferred" safe variant per D-GRH-22 (over `ambient`, which is a separate template — SPEC-CRWDQ-053).

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/safe-info/SafeInfoTemplate.ts
export interface SafeInfoTemplate {
  mount(host: HTMLElement, context: SafeInfoContext): SafeInfoInstance;
}

export interface SafeInfoContext {
  /** Optional ProgramSlot when entered via backend PlannedState; null when entered via SafeStateController. */
  programSlot: ProgramSlot | null;
  themeId: string | null;
  /** Read from active BarPreferences (D-GRH-73). Drives venue branding text. */
  barPreferences: BarPreferences | null;
  /** Why are we here? */
  source: SafeSource;
}

export type SafeSource =
  | { kind: 'backend_planned'; reason: 'scheduled' | 'no_content' | 'maintenance' }
  | { kind: 'player_fallback'; reason: 'control_channel_lost' | 'data_stale' | 'no_recent_state' };

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
   * Triggers safe_info mount when D-SAFE-01 conditions hit.
   */
  start(): void;
  stop(): void;

  /** Current diagnostic state. */
  state(): { inSafe: boolean; reason: SafeSource['reason'] | null };
}
```

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

The DOM is intentionally minimal. The content is a venue-aware "stay tuned" panel with the bar's brand (D-GRH-73 — there's no `venue_name` field in the locked schema; the player derives from `BarPreferences.city` + `state` as a fallback display, OR uses an asset-cached branded image when one is provided in `AssetManifest`).

### Activation paths

**Path A — backend `PlannedState{safe_info}`:**

1. Routed by `PlannedStateActivator` like any other mode.
2. `source = { kind: 'backend_planned', reason: 'scheduled' }` (the catalog row maps `PlannedState` flags onto the reason enum; an extension of D-SCHEMA-05 + D-GRH-30 to carry `safe_reason` is a backend concern — out of scope here. Default `'scheduled'`).
3. Standard transition + dwell.

**Path B — player fallback via `SafeStateController`:**

1. `SafeStateController.start()` runs at widget boot. It watches:
   - `WsClient` lifecycle: connection-lost ≥ 30 s and no successful reconnect → `'control_channel_lost'`.
   - `GameStateStore` per-active-game staleness: no `GameEvent` for any active game ≥ 120 s while in a content mode → `'data_stale'`.
   - `PlannedStateActivator` no-state timer: no active `PlannedState` ≥ 60 s after WS open → `'no_recent_state'`.
2. When any trigger fires, controller calls `PlannedStateActivator.activate(syntheticPlannedState({mode: 'safe', sub: 'safe_info'}))`. The synthetic state carries `program_slot_id: null`, theme = last-known theme, transition = `fade_scale_up` default.
3. `SafeInfoTemplate.mount(...)` runs with `source = { kind: 'player_fallback', reason }`.
4. On D-SAFE-01 recovery (connection back, GameEvent received, real PlannedState arrives), the controller cancels the synthetic state — the real activation supersedes it via the normal supersede path.

### Venue branding

The venue name is rendered from a small fallback chain:

1. If `AssetManifestStore.resolve("venue_brand:" + barPreferences.bar_id)` returns an image asset → render `<img>` instead of text.
2. Else if `barPreferences.city` + `barPreferences.state` populated → render `<span>${city.toUpperCase()}, ${state.toUpperCase()}</span>`.
3. Else → render the literal `"CROWDAQ"` brand only.

The status footer is a subtle indicator (per D-SAFE-01: safe templates must not alarm — no red borders, no "ERROR" text, no flashing). Status text is `source.reason`-keyed:

| Reason | Footer text |
|--------|-------------|
| `scheduled` | (empty) |
| `no_content` | (empty) |
| `maintenance` | "Brief pause" |
| `control_channel_lost` | "Reconnecting…" |
| `data_stale` | "Refreshing…" |
| `no_recent_state` | "Loading…" |

All status text is theme-aware (small caps, low-contrast accent). No motion. Always offline-safe — the template renders entirely from in-memory state with no fetch, no network.

### No motion / no flash

Per D-GRH-31 anti-flash constraint and D-SAFE-01 "calm" intent, the safe template runs no animations, no transitions on the inner content (the outer transition from `PlannedStateActivator` runs on activation, but the body itself is static).

### Dwell

If entered via Path A, dwell is `plannedState.dwell_target_ms`. If entered via Path B, dwell is infinite — the template stays mounted until the controller cancels it on D-SAFE-01 recovery.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| `WsClient` lifecycle | 2 local-substitutable | `FakeWsLifecycle` driver with explicit event triggers. |
| `GameStateStore` staleness probes | 1 in-process | Real instance; advance clock to age out events. |
| DOM | 1 in-process | jsdom. |
| `AssetManifestStore` | 1 in-process | Real instance with pre-seeded venue brand asset. |
| `BarPreferences` source | 1 in-process | Real instance from SPEC-CRWDQ-014. |
| Journal sink | 2 local-substitutable | In-memory. |
| Clock | system boundary | Fake timers. |

Test cases:

- Path A backend-planned: dispatch `PlannedState{mode: safe, sub: safe_info, reason: scheduled}` → DOM contains `data-source="backend_planned"`, `data-reason="scheduled"`, status footer empty.
- Path B control-channel-lost: fire WS close, advance clock 30 s, no reconnect → controller triggers safe_info with `data-source="player_fallback"`, `data-reason="control_channel_lost"`, footer "Reconnecting…".
- Path B data-stale: simulate active content mode + age last GameEvent past 120 s → controller triggers `data_stale` safe; footer "Refreshing…".
- Path B no-recent-state: WS open + 60 s without a `PlannedState` arrival → controller triggers `no_recent_state`; footer "Loading…".
- D-SAFE-01 recovery: in Path B safe, real `PlannedState{single_game}` arrives → supersede transitions to the new mode; safe instance detaches; controller's `state().inSafe` flips to `false`.
- Venue brand asset present: `AssetManifestStore.resolve("venue_brand:bar-007")` returns URL → DOM contains `<img>` not city/state text.
- Venue brand asset miss + city/state present: DOM contains text like "CHICAGO, IL".
- Venue brand asset miss + city/state empty: DOM falls back to "CROWDAQ" wordmark only.
- No motion: assert no `transition`, `animation`, `keyframes` CSS properties are applied to any descendant of `.cdq-safe-body` after mount.
- Theme apply at boundary (Path A only): theme swap occurs per shared semantics.
- Path B dwell: timer NOT armed; template stays mounted indefinitely until recovery.
- Status footer text matches the `reason`-to-text table.

## Vocabulary

- `safe` mode — D-GRH-30 mode #8.
- D-SAFE-01 — the player-side fallback chain established in the requirements doc.
- "venue brand" — derived from `BarPreferences` + optional asset; no first-class wire field.

## Acceptance Criteria

- [ ] `SafeInfoTemplate.mount(host, ctx)` renders `<section class="crowdaq-safe-info" data-theme data-source data-reason>` with header (venue brand), body (CROWDAQ wordmark + tagline), footer (status text from the reason map).
- [ ] Venue brand fallback chain: asset → city/state text → wordmark only, in that order; the first non-null wins.
- [ ] Path A: `PlannedState{mode: safe, sub: safe_info}` routed by `PlannedStateActivator` with standard transition + dwell; `data-source="backend_planned"`.
- [ ] Path B: `SafeStateController` triggers safe_info on `control_channel_lost` (WS down ≥ 30 s, no reconnect), `data_stale` (no GameEvent ≥ 120 s in content mode), `no_recent_state` (WS open + no PlannedState ≥ 60 s); the trigger constructs a synthetic PlannedState and routes via the normal activator.
- [ ] On D-SAFE-01 recovery, the real PlannedState arrival supersedes the synthetic safe state via the standard supersede flow; controller's `state().inSafe` flips to false.
- [ ] No motion is applied to any descendant of `.cdq-safe-body` after mount: assertions on computed `animation-name` / `transition-property` / `@keyframes` are negative.
- [ ] Footer status text matches the reason map exactly: `scheduled`/`no_content` empty, `maintenance` "Brief pause", `control_channel_lost` "Reconnecting…", `data_stale` "Refreshing…", `no_recent_state` "Loading…".
- [ ] Path A honors `plannedState.dwell_target_ms`; Path B does NOT arm the dwell timer (infinite until recovery).
- [ ] Always offline-safe: the template makes no fetch calls; venue brand asset, if needed, is resolved synchronously from `AssetManifestStore.resolve(...)` cache; cache miss falls back to text per the chain.
- [ ] Tests cover both paths, each reason, each fallback rung in the brand chain, D-SAFE-01 recovery supersede, no-motion assertion, theme apply at boundary (Path A only), Path B no-dwell.
- [ ] No mocks of `PlannedStateActivator`, `GameStateStore`, `AssetManifestStore`, `BarPreferences`, or `SafeStateController` internals (INV-FACTORY-16); only the `WsClient` lifecycle and clock are substituted.
