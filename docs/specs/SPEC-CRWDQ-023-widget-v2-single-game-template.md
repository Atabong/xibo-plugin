---
spec_id: SPEC-CRWDQ-023
title: Widget v2 single_game render template
status: draft
owner: player-runtime/widget-v2/templates/single-game
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-014]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-023 — Widget v2 single_game render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S3 — Single-game render (no admin path) |
| Plane epic | CRWDQ-4 |
| Decisions referenced | D-GRH-09, D-GRH-12, D-GRH-14, D-GRH-21, D-GRH-23, D-GRH-28, D-GRH-30, D-GRH-31, D-GRH-50, D-GRH-51 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts`, `modules/widget-v2/src/templates/single-game/single-game.html`, `modules/widget-v2/src/templates/single-game/single-game.css`, `modules/widget-v2/src/render/PlannedStateActivator.ts`, `modules/widget-v2/src/render/ProgramSlotResolver.ts`, `modules/widget-v2/src/render/GameStateStore.ts`, `modules/widget-v2/src/render/DwellTimer.ts`, `modules/widget-v2/src/render/TransitionExecutor.ts`, `modules/widget-v2/tests/templates/single-game/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/single-game` — the `single_game` business-mode template (D-GRH-30 mode #1) plus the supporting render orchestration: `PlannedState` activation, `ProgramSlot` resolution by `program_slot_id` (D-GRH-21), `GameState` lookup by `primary_game_id`, dwell-timer management (D-GRH-50), and the named-animation transition executor. This spec also establishes the shared render-orchestration shape that every downstream template (multi-game, fixtures, recap, ads, safe, ambient) reuses without re-deriving.

## Current shape

- Widget v1's `<onRender>` block renders one score panel from SSE `score-update` events directly into the Twig stencil's static DOM (`#crowdaq-score`). There is no `PlannedState`, no `ProgramSlot`, no template family — only one DOM tree with text nodes the SSE handler mutates in place. No dwell timer; the widget runs for whatever `defaultDuration` the layout assigns (60s) and is then unmounted by the player.
- No transition library; no animation catalog; no theme stylesheet swap. The "dark" / "light" theme dropdown selects a static CSS class on `<body>` at boot.
- Today's widget reads `sport_context` only implicitly (the team names and crests are passed through verbatim from the SSE payload).
- v2 needs: per-`PlannedState` activation, dynamic theme swap, animated transitions from a named catalog, dwell-bounded slot lifetime, and a single-game template that pulls score + `sport_context` overlay from the in-memory `GameState` map (D-GRH-12 single multiplexed stream).

## Dependencies

This spec depends on two specs, both declared in `depends_on:`:

- **SPEC-CRWDQ-022** (`xibo-plugin :: widget-v2 :: transport`) — owns the `Dispatcher` into which `PlannedStateActivator` registers as the `PlannedState` handler, and the wire-frame types (`PlannedStateFrame`, `ProgramSlotFrame`, `GameStateFrame`, `GameEventFrame`, `AdSlotFrame`, `AssetManifestFrame`) this spec consumes. Its implementation issue must be CLOSED before this spec's issue unblocks.
- **SPEC-CRWDQ-014** (`xibo-plugin :: widget-v2 :: config`) — owns `ConfigPushHandler` and the pending-preference-apply slot this template reads at a dwell boundary. SPEC-CRWDQ-014 explicitly defers the theme CSS-stylesheet swap to "the theme apply path … arrives with SPEC-CRWDQ-023 single_game render"; this spec owns that apply path. Its implementation issue must be CLOSED before this spec's issue unblocks.

**Non-blocking references.** SPEC-CRWDQ-017 (`crowdaq-backend :: shared/wire-protocol`) is the authoritative source of the `Envelope` and payload shapes (`PlannedStatePayload`, `ProgramSlotPayload`, `GameStatePayload`, `GameEventPayload`); it is reached transitively through SPEC-CRWDQ-022, which re-exports those types, so it is not listed as a direct `depends_on:`. SPEC-CRWDQ-064 (AssetManifestStore) owns the asset-cache the `TransitionExecutor` consults as its second-tier transition fallback; because `single_game` renders correctly without it (the pre-baked catalog plus the default-fade fallback cover every case), SPEC-CRWDQ-064 is **not** a blocking dependency — a `TransitionExecutor` running before SPEC-CRWDQ-064 lands simply skips the asset-cache tier.

## Wire types (consumed, not defined here)

All wire frame/payload types come from SPEC-CRWDQ-022's `transport/types.ts`, which re-exports the SPEC-CRWDQ-017 wire barrel. This spec hand-authors no wire type. Naming convention used throughout this spec:

- `<Type>Frame` — the full `Envelope<…Payload>` as it appears in SPEC-CRWDQ-022's `ServerFrame` union (e.g. `PlannedStateFrame`, `ProgramSlotFrame`, `GameStateFrame`, `GameEventFrame`).
- `<Type>Payload` — the `payload` member of that envelope (e.g. `PlannedStatePayload`, `ProgramSlotPayload`, `GameStatePayload`), the SPEC-CRWDQ-017 interface.

The interfaces below take `<Type>Frame` at the dispatcher boundary and operate on the unwrapped `<Type>Payload` internally.

The SPEC-CRWDQ-017 fields this spec depends on:

```ts
// from SPEC-CRWDQ-017 — PlannedStatePayload (excerpt)
interface PlannedStatePayload {
  state_id: string;
  window_id: string;
  schedule_slot_index: number;
  valid_from: string;
  interrupt_class: 'scheduled' | 'exceptional_override';
  business_mode: string;            // closed 9-value enum — single_game is mode #1
  template_id: string;
  theme_id: string | null;          // per-slot theme; null = default theme
  dwell_target_ms: number;
  transition: string;               // closed-enum catalog name — a STRING, not an object
  program_slot_id: string | null;   // null only for recap/ambient slots
  ad_slot_id: string | null;
}

// from SPEC-CRWDQ-017 — ProgramSlotPayload
interface ProgramSlotPayload {
  program_slot_id: string;
  primary_game_id: string | null;
  game_ids: string[];
  fixture_ids: string[];
}

// from SPEC-CRWDQ-017 — GameStatePayload (no seq — every snapshot is a recovery point)
interface GameStatePayload {
  game_id: string;
  sport: string;
  home_score: number;
  away_score: number;
  period: string;
  clock: string;
  signals: string[];
  badges: string[];
  sport_context: Record<string, unknown>;
}

// from SPEC-CRWDQ-017 — GameEventPayload (seq-bearing, monotonic per game_id)
interface GameEventPayload {
  game_id: string;
  seq: number;
  kind: 'goal' | 'card' | 'sub' | 'period' | 'shot' | 'var' | 'penalty';
  at_clock: string;
  delta: Record<string, unknown>;
}
```

> **Field-name correction (SPEC-CRWDQ-017 cross-check).** The business-mode discriminator on `PlannedState` is `business_mode` (per `PlannedStatePayload`), **not** `mode`. An earlier draft of this spec said "an incoming `PlannedState` with `mode: \"single_game\"`"; that field does not exist on the wire. The activator branches on `plannedState.payload.business_mode === 'single_game'`.

## Proposed deep interface

```ts
// modules/widget-v2/src/render/PlannedStateActivator.ts
export interface PlannedStateActivator {
  /**
   * Called by the Dispatcher's PlannedState handler. Resolves the
   * referenced ProgramSlot and AdSlot (if present), runs the named
   * transition, mounts the right template family, starts the dwell
   * timer. Idempotent on repeated activation of the same state_id.
   */
  activate(plannedState: PlannedStateFrame): Promise<void>;
}
```

```ts
// modules/widget-v2/src/render/ProgramSlotResolver.ts
export interface ProgramSlotResolver {
  upsert(slot: ProgramSlotFrame): void;
  resolve(programSlotId: string): ProgramSlotPayload | null;
  /** Returns true iff the slot exists. Used by PlannedStateActivator to know if it must defer activation until the ProgramSlot frame arrives. */
  has(programSlotId: string): boolean;
}
```

```ts
// modules/widget-v2/src/render/GameStateStore.ts
export interface GameStateStore {
  upsertSnapshot(snapshot: GameStateFrame): void;
  applyEvent(event: GameEventFrame): void;
  get(gameId: string): GameStatePayload | null;
  /** The most recent GameEvent applied for this game, or null if none
   *  seen. Source for the single_game "last moment" overlay text. */
  lastEvent(gameId: string): GameEventPayload | null;
  /** Subscribe to mutations for a specific game; returns unsubscribe.
   *  Fires on both snapshot upserts and event applies. */
  subscribe(gameId: string, listener: (state: GameStatePayload) => void): () => void;
}
```

```ts
// modules/widget-v2/src/render/DwellTimer.ts
export interface DwellTimer {
  /** Arm a one-shot. fireAt = now + dwellTargetMs. Returns the boundary monotonic ts. */
  arm(dwellTargetMs: number, onBoundary: (actualDwellMs: number) => void): void;
  cancel(): void;
  /** Current elapsed milliseconds in the active dwell, or null if not armed. */
  elapsed(): number | null;
}
```

```ts
// modules/widget-v2/src/render/TransitionExecutor.ts
export interface TransitionExecutor {
  /**
   * Execute the named transition. `transitionName` is the catalog-name
   * string carried by `PlannedStatePayload.transition` (SPEC-CRWDQ-017 — a
   * closed-enum string, NOT an object). Resolves the name against the
   * pre-baked catalog (D-GRH-28 / D-GRH-50) to a `TransitionSpec`;
   * falls back to the AssetManifest cache (SPEC-CRWDQ-064, when present);
   * falls back to default fade if both miss (D-GRH-31). Returns when the
   * transition completes.
   */
  run(transitionName: string, target: HTMLElement): Promise<void>;
}

/** Resolved catalog entry — the internal result of resolving a
 *  `PlannedStatePayload.transition` name against the pre-baked catalog. */
export interface TransitionSpec {
  animation_id: string;
  duration_ms: number;
}
```

```ts
// modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts
export interface SingleGameTemplate {
  /** Mount template DOM into the host. Subscribes to GameState for the primary_game_id. */
  mount(host: HTMLElement, context: SingleGameContext): SingleGameInstance;
}

export interface SingleGameContext {
  programSlot: ProgramSlotPayload;     // resolved by ProgramSlotResolver
  /**
   * The theme to render. Resolved by the activator (see § Theme resolution):
   * the three-state ThemeChoiceWire from the most recent applied ConfigPush
   * preferences, NARROWED against the per-slot PlannedStatePayload.theme_id.
   */
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
}

/**
 * The resolved theme for a slot. Preserves the D-GRH-51 three-state
 * distinction (default vs unset are NOT collapsed to one null).
 */
export type ResolvedTheme =
  | { state: 'set'; id: string }       // a concrete theme stylesheet to load
  | { state: 'default' }               // system-default theme
  | { state: 'unset' };                // no theme selected — surface the onboarding affordance

export interface SingleGameInstance {
  /** Called when a new PlannedState supersedes this one. Unsubscribes, returns the DOM node for the outgoing transition. */
  detach(): HTMLElement;
}
```

### Theme resolution

D-GRH-51 defines a three-state theme (`set` / `default` / `unset`). Two wire sources carry theme information and this spec reconciles them deterministically:

- **`PlannedStatePayload.theme_id` (`string | null`)** — the per-slot theme the backend authored for *this* `PlannedState`. SPEC-CRWDQ-017 documents `null` as "default theme."
- **`ConfigPushHandler`'s applied bar preferences (`ThemeChoiceWire`)** — the bar-wide three-state theme from the most recently applied `ConfigPush` (SPEC-CRWDQ-014). `ThemeChoiceWire` is `{state:'set';id} | {state:'default'} | {state:'unset'}`.

**Resolution rule (per-slot override wins where present):**

1. If `PlannedStatePayload.theme_id` is a non-empty string → `ResolvedTheme = { state: 'set', id: <theme_id> }`. The backend authored an explicit per-slot theme; it overrides the bar default.
2. If `PlannedStatePayload.theme_id` is `null` → fall through to the bar-wide `ThemeChoiceWire` from `ConfigPushHandler`: a `set`/`default`/`unset` `ThemeChoiceWire` maps one-to-one onto `ResolvedTheme`.
3. If no `ConfigPush` has been applied yet (boot before first `ConfigPush`) and `theme_id` is `null` → `ResolvedTheme = { state: 'default' }`.

The `unset` state is preserved end-to-end and is **not** collapsed into `default`: per D-GRH-51 `unset` means "no theme selected" and the template surfaces a distinct onboarding affordance (a `data-theme="__unset__"` attribute the stylesheet keys off), whereas `default` loads the system-default stylesheet. An earlier draft typed the context theme as `themeId: string | null`, which erased that distinction; `ResolvedTheme` restores it.

### `single_game` template DOM shape

A single `<section class="crowdaq-single-game" data-theme="<theme-attr>">` where `<theme-attr>` is the `set` theme id, the literal `__default__` for `{state:'default'}`, or the literal `__unset__` for `{state:'unset'}`. The section contains:

- `<header class="cdq-sport-context">` — sport, league, optional venue badge (resolved from `GameStatePayload.sport_context` per D-GRH-09). Empty if `sport_context` is an empty object.
- `<div class="cdq-score">` — two team blocks (home/away) each with team name and score, plus a center clock/period indicator. Driven entirely by `GameStatePayload.home_score`, `GameStatePayload.away_score`, and the top-level `GameStatePayload.period` / `GameStatePayload.clock` fields.
- `<aside class="cdq-overlay">` — last notable moment text (capped at `maxMomentLength` per existing widget convention). `GameStatePayload` carries no moment field, so the text is derived in-widget from the most recent `GameEvent` for `primary_game_id` (`GameStateStore.lastEvent(gameId)`; the template maps the event's `kind` + `delta` + `at_clock` to display text). Shown only when a `GameEvent` has been seen for the game.

No multi-game grid logic, no ad panel, no fixtures, no recap. Those are separate templates that share the same orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`).

### Activation flow

For an incoming `PlannedStateFrame` whose `payload.business_mode === "single_game"`:

1. **Validate `program_slot_id`.** `single_game` requires a `ProgramSlot` (D-GRH-30). `PlannedStatePayload.program_slot_id` is `string | null` on the wire (`null` is valid only for recap/ambient slots). If a `single_game` `PlannedState` arrives with `program_slot_id === null`, that is a backend authoring error: the activator journals `template_render_fallback` (reason `single_game_missing_program_slot`), renders the "no live game" placeholder, arms the dwell timer normally, and does NOT buffer. Otherwise continue with the non-null `program_slot_id` (call it `X`).
2. **Resolve `ProgramSlot`.** `ProgramSlotResolver.resolve(X)`. If `null`, the activator buffers the `PlannedStateFrame` and waits for the matching `ProgramSlot` frame (per D-GRH-25 the server sends `ProgramSlot` before any referencing `PlannedState` on the re-push; mid-session it sends them adjacently). Buffer timeout: 5 s — on expiry the activator journals `template_buffer_timeout` and emits `template_render_fallback` (the safe-mode fall-through itself is out of scope here; owned by SPEC-CRWDQ-052).
3. **Read `primary_game_id`.** `programSlot.primary_game_id` is the single source. If `null`, the template renders a "no live game" placeholder; per D-GRH-30 `single_game` requires a live game, so this is a backend authoring error — journal `template_render_fallback` (reason `single_game_null_primary_game`) and proceed (dwell still armed).
4. **Resolve theme.** Apply the § Theme resolution rule against `plannedState.payload.theme_id` and `ConfigPushHandler`'s current applied `ThemeChoiceWire` → a `ResolvedTheme`.
5. **Run transition.** `TransitionExecutor.run(plannedState.payload.transition, host)`. Default `fade_scale_up` if catalog miss.
6. **Mount.** `SingleGameTemplate.mount(host, ctx)` with `ctx.theme` set to the step-4 `ResolvedTheme`. The instance subscribes to `GameStateStore` for `primary_game_id`. Initial DOM is populated from the current snapshot (which the re-push guarantees is in-store before the `PlannedState` arrives, per D-GRH-49).
7. **Apply pending preferences.** If `ConfigPushHandler` has a pending apply (SPEC-CRWDQ-014), this dwell boundary is where it is consumed: the activator re-runs § Theme resolution against the now-current preferences, swaps the theme CSS stylesheet (D-GRH-51) if the `ResolvedTheme` changed, and updates the `data-theme` attribute. The pending-apply slot is then cleared; subsequent boundaries see no pending apply until the next `ConfigPush`. The theme CSS swap occurs ONLY here — never mid-dwell, never forced by a `ConfigPush` arrival.
8. **Arm dwell.** `DwellTimer.arm(plannedState.payload.dwell_target_ms, onBoundary)`. `onBoundary` does nothing on its own — the next `PlannedState` arriving from the server is what advances the slot. The dwell-boundary callback emits a `dwell_boundary_reached` journal event (D-GRH-29) so backend reconciliation can detect dwell drift.
9. **Re-render on event.** The `GameStateStore` subscription fires on each `GameState` snapshot or `GameEvent` delta for `primary_game_id`. The template diffs and mutates the DOM in place. No transition runs on a per-event update — only on a `PlannedState` swap.

### Supersede / detach

When a new `PlannedState` arrives (different `state_id`):

1. Cancel the current `DwellTimer`.
2. Run the outgoing transition (`fade_scale_down` default).
3. Call `instance.detach()`; unsubscribe the `GameStateStore` listener.
4. Begin the new activation flow from step 1.

### Idempotency

- `PlannedState` with the same `state_id` arriving twice (re-push artifact): no-op. The activator stores the active `state_id` and short-circuits before running a transition or mounting.
- `ProgramSlot` upserts: last-write-wins per `program_slot_id`. A mid-session update to a referenced slot triggers a soft re-render of the active template (the `GameState` listener re-fires with current state) without re-running the transition.
- `GameState` snapshots carry no `seq` (SPEC-CRWDQ-017) — every snapshot is a recovery point and is always applied, resetting the per-`game_id` seq baseline. Only `GameEvent` deltas carry `seq`: a delta whose `seq` is ≤ the last applied seq for that `game_id` is dropped (journal `game_event_seq_regression`).
- `activate()` is invoked synchronously in receipt order by the SPEC-CRWDQ-022 dispatcher ("handlers are invoked synchronously in receipt order per logical channel"), so it is never re-entered concurrently; the `Promise` it returns is awaited by the caller before the next `PlannedState` is dispatched. No internal concurrency guard is required beyond the `state_id` short-circuit.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022; activator registers as the `PlannedState` handler. |
| DOM | 1 in-process | jsdom. Real elements; assert on rendered text and attributes via `getByTestId`. |
| `GameStateStore` | 1 in-process | Real instance; drive snapshots/events via test driver. |
| `ProgramSlotResolver` | 1 in-process | Real instance. |
| `ConfigPushHandler` pending apply | 2 local-substitutable | `PendingApplyProbe` exposing the same pending-slot read surface SPEC-CRWDQ-014 defines; the real handler is exercised in SPEC-CRWDQ-027 e2e. |
| `TransitionExecutor` | 2 local-substitutable | `InstantTransitionAdapter` that resolves immediately and records the `animation_id`. The real animation timing surfaces are exercised in SPEC-CRWDQ-027 e2e. |
| `DwellTimer` | system boundary | Vitest fake timers; assert on `arm`/`cancel`/boundary firing. |
| Theme CSS swap | 2 local-substitutable | `StyleSheetRegistry` substitute that records the resolved theme; real `<link>` injection covered by SPEC-CRWDQ-027 e2e. |
| Journal sink | 2 local-substitutable | In-memory journal. |
| `Date.now`, `performance.now` | system boundary | Frozen clock. |

Test cases:

- Happy path: `ProgramSlot` then `PlannedState{business_mode:'single_game'}` then `GameState` arrivals → DOM contains home/away/score; subscription fires on event; DOM re-renders without a transition.
- Re-push order edge: `PlannedState` arrives before its `ProgramSlot` → activator buffers; on the subsequent `ProgramSlot` arrival within 5 s the template mounts. After 5 s the activator journals `template_buffer_timeout` and emits `template_render_fallback`.
- `single_game` `PlannedState` with `program_slot_id: null` → no buffering; placeholder DOM, journal `template_render_fallback` reason `single_game_missing_program_slot`, dwell still armed.
- Idempotent re-activation: same `state_id` × 2 → exactly one transition, exactly one mount.
- Supersede: a second `PlannedState` (different `state_id`) → the outgoing transition runs, the instance detaches, the subscription is removed, a new mount happens.
- `primary_game_id` null: placeholder DOM, journal `template_render_fallback` reason `single_game_null_primary_game`, dwell still armed.
- Theme resolution — per-slot override: `PlannedState.theme_id: "neo-dark"` with the bar `ThemeChoiceWire` at `{state:'default'}` → `ResolvedTheme {state:'set',id:'neo-dark'}`, `data-theme="neo-dark"`.
- Theme resolution — bar fallthrough: `PlannedState.theme_id: null` with bar `ThemeChoiceWire {state:'unset'}` → `ResolvedTheme {state:'unset'}`, `data-theme="__unset__"` (distinct from `default`).
- Theme resolution — boot default: `PlannedState.theme_id: null` and no `ConfigPush` applied yet → `ResolvedTheme {state:'default'}`, `data-theme="__default__"`.
- Pending preference apply at boundary: a pending apply present at mount → `StyleSheetRegistry` records the re-resolved theme; the `data-theme` attribute updates; the pending-apply slot is consumed.
- Out-of-order `GameEvent` (seq 5 then seq 3): seq 3 is dropped; journal `game_event_seq_regression`.
- Last-moment overlay: a `GameEvent` (`kind: "goal"`) for `primary_game_id` → `<aside class="cdq-overlay">` renders text derived from the event's `kind`/`delta`/`at_clock`; with no `GameEvent` seen the overlay is absent.
- Transition catalog miss: `PlannedState.transition: "nonexistent"` → `TransitionExecutor` falls back to the default fade; journal `transition_catalog_miss`.
- Dwell boundary: `DwellTimer.arm(30000)`; advance the fake clock 30 s → the boundary callback fires; journal `dwell_boundary_reached` with `actualDwellMs` close to 30000 (∆ ≤ 1 ms).

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`. Uses:

- `business_mode` — closed 9-value enum from D-GRH-30 (the `PlannedStatePayload.business_mode` field); this template handles `single_game` only.
- `program_slot_id`, `primary_game_id` — D-GRH-21 `ProgramSlot` fields.
- `sport_context` — fixed per-sport schema in D-GRH-09.
- `transition`, `animation_id`, `duration_ms` — D-GRH-50 flat catalog name.
- `dwell_target_ms` — backend-authored per-slot dwell (D-GRH-50).
- `ResolvedTheme` — local term: the three-state theme (`set`/`default`/`unset`) after reconciling the per-slot `PlannedStatePayload.theme_id` against the bar-wide `ThemeChoiceWire`. See § Theme resolution.

## Acceptance Criteria

- [ ] `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` exports `SingleGameTemplate` whose `mount(host, ctx)` renders a `<section class="crowdaq-single-game">` containing the `sport_context` header, the score block (home/away/clock), and the last-moment overlay, with `data-testid` attributes for each sub-region.
- [ ] `PlannedStateActivator.activate(...)` is the registered `PlannedState` dispatcher handler (from SPEC-CRWDQ-022); the activator branches on `plannedState.payload.business_mode === 'single_game'`; the same `state_id` arriving twice triggers exactly one transition and one mount.
- [ ] `ProgramSlotResolver` resolves a `program_slot_id` to the current upserted `ProgramSlotPayload`; last-write-wins on per-id updates; resolution is synchronous.
- [ ] When a `single_game` `PlannedState` arrives before its referenced `ProgramSlot`, the activator buffers for up to 5 s and proceeds on arrival; on timeout it journals `template_buffer_timeout` and emits `template_render_fallback`.
- [ ] A `single_game` `PlannedState` whose `program_slot_id` is `null` is not buffered: the activator renders the "no live game" placeholder, journals `template_render_fallback` with reason `single_game_missing_program_slot`, and still arms the dwell timer.
- [ ] `GameStateStore` accepts `GameState` snapshots (full state, always applied — no `seq`, resets the baseline) and `GameEvent` deltas (per-field, `seq`-ordered); subscribers fire on every applied change; a `GameEvent` whose `seq` regresses (≤ the last applied seq) is dropped with a `game_event_seq_regression` journal entry; `lastEvent(gameId)` exposes the most recent applied event.
- [ ] Per D-GRH-21, `primary_game_id` is read from `ProgramSlotPayload`, NOT from `PlannedState`. The template never reads a `PlannedState.game_id` (singular) field — it does not exist post-D-GRH-21.
- [ ] Theme resolution follows § Theme resolution: a non-empty `PlannedStatePayload.theme_id` yields `ResolvedTheme {state:'set',id}`; a `null` `theme_id` falls through to the bar-wide `ThemeChoiceWire` from `ConfigPushHandler`; with no `ConfigPush` applied and a `null` `theme_id` the result is `{state:'default'}`. The `unset` state is preserved distinctly from `default` (rendered as `data-theme="__unset__"` vs `data-theme="__default__"`).
- [ ] `TransitionExecutor.run(transitionName, host)` takes the `PlannedStatePayload.transition` catalog-name string, resolves it against the pre-baked catalog first, then the `AssetManifest` asset cache (when SPEC-CRWDQ-064 is present), then default fade; a catalog miss is journaled (`transition_catalog_miss`) but the transition still completes.
- [ ] `DwellTimer.arm(dwell_target_ms, onBoundary)` fires `onBoundary` after the elapsed wall-clock duration ±1 ms in tests; `cancel()` prevents firing; re-arming replaces the prior schedule.
- [ ] The theme CSS swap occurs only on a dwell boundary when a `ConfigPushHandler` pending apply is present; the swap consumes the pending slot; the active `PlannedState` is never forcibly re-mounted by a `ConfigPush` arrival.
- [ ] No multi-game, no ad panel, no fixture rendering: the template's DOM has no `.cdq-card-grid`, no `.cdq-ad-panel`, no `.cdq-fixture-card`. Other templates own those.
- [ ] Tests cover: happy path, re-push order edge, null `program_slot_id`, idempotent re-activation, supersede, null `primary_game_id`, theme resolution (per-slot override / bar fallthrough / boot default), pending apply at boundary, out-of-order `GameEvent`, transition catalog miss, and dwell boundary firing.
- [ ] No mocks of `Dispatcher`, `GameStateStore`, `ProgramSlotResolver`, `DwellTimer`, or template internals (INV-FACTORY-16); only the WS source, clock, transition timing, `ConfigPushHandler` pending-apply surface, and CSS injection are substituted (INV-FACTORY-17).
