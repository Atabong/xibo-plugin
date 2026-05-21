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
  resolve(programSlotId: string): ProgramSlotFrame | null;
  /** Returns true iff the slot exists. Used by PlannedStateActivator to know if it must defer activation until the ProgramSlot frame arrives. */
  has(programSlotId: string): boolean;
}
```

```ts
// modules/widget-v2/src/render/GameStateStore.ts
export interface GameStateStore {
  upsertSnapshot(snapshot: GameStateFrame): void;
  applyEvent(event: GameEventFrame): void;
  get(gameId: string): GameState | null;
  /** The most recent GameEvent applied for this game, or null if none
   *  seen. Source for the single_game "last moment" overlay text. */
  lastEvent(gameId: string): GameEventFrame | null;
  /** Subscribe to mutations for a specific game; returns unsubscribe.
   *  Fires on both snapshot upserts and event applies. */
  subscribe(gameId: string, listener: (state: GameState) => void): () => void;
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
   * string carried by `PlannedState.transition` (SPEC-CRWDQ-017 — a
   * closed-enum string, NOT an object). Resolves the name against the
   * pre-baked catalog (D-GRH-28 / D-GRH-50) to a `TransitionSpec`;
   * falls back to the AssetManifest cache; falls back to default fade
   * if both miss (D-GRH-31). Returns when the transition completes.
   */
  run(transitionName: string, target: HTMLElement): Promise<void>;
}

/** Resolved catalog entry — the internal result of resolving a
 *  `PlannedState.transition` name against the pre-baked catalog. */
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
  programSlot: ProgramSlot;          // resolved by ProgramSlotResolver
  themeId: string | null;            // resolved by ConfigPushHandler at boundary apply
  gameStateStore: GameStateStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface SingleGameInstance {
  /** Called when a new PlannedState supersedes this one. Unsubscribes, returns the DOM node for the outgoing transition. */
  detach(): HTMLElement;
}
```

### `single_game` template DOM shape

A single `<section class="crowdaq-single-game" data-theme="<theme_id>">` containing:

- `<header class="cdq-sport-context">` — sport, league, optional venue badge (resolved from `GameState.sport_context` per D-GRH-09). Empty if `sport_context` absent.
- `<div class="cdq-score">` — two team blocks (home/away) each with team name and score, plus a center clock/period indicator. Driven entirely by `GameState.home_score`, `GameState.away_score`, and the top-level `GameState.period` / `GameState.clock` fields (SPEC-CRWDQ-017 `GameStatePayload`).
- `<aside class="cdq-overlay">` — last notable moment text (capped at `maxMomentLength` per existing widget convention). SPEC-CRWDQ-017's `GameStatePayload` carries no moment field, so the text is derived in-widget from the most recent `GameEvent` for `primary_game_id` (`GameStateStore.lastEvent(gameId)`; the template maps the event's `kind` + `delta` + `at_clock` to display text). Shown only when a `GameEvent` has been seen for the game.

No multi-game grid logic, no ad panel, no fixtures, no recap. Those are separate templates that share the same orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`).

### Activation flow

For an incoming `PlannedState` with `mode: "single_game"` and `program_slot_id: X`:

1. **Resolve `ProgramSlot`.** `ProgramSlotResolver.resolve(X)`. If null, the activator buffers the `PlannedState` and waits for the matching `ProgramSlot` frame to arrive (per D-GRH-25 the server sends `ProgramSlot` before any referencing `PlannedState` on the re-push; mid-session it sends them adjacently). Buffer timeout: 5s — after which the player falls through to safe (out of scope here; flagged in SPEC-CRWDQ-052).
2. **Read `primary_game_id`.** `programSlot.primary_game_id` is the single source. If null, the template renders a "no live game" placeholder; per D-GRH-30 single_game requires a live game so this is a backend authoring error — journal `template_render_fallback` and proceed.
3. **Run transition.** `TransitionExecutor.run(plannedState.transition, host)`. Default `fade_scale_up` if catalog miss.
4. **Mount.** `SingleGameTemplate.mount(host, ctx)`. The instance subscribes to `GameStateStore` for `primary_game_id`. Initial DOM populated from current snapshot (which the re-push guarantees is in-store before the `PlannedState` arrives, per D-GRH-49).
5. **Apply pending preferences.** If `ConfigPushHandler` has a pending apply (SPEC-CRWDQ-014), this is the dwell boundary — swap the theme CSS stylesheet (D-GRH-51) and update `data-theme` attribute. The apply is consumed; subsequent boundaries see `pendingApply === null` until next `ConfigPush`.
6. **Arm dwell.** `DwellTimer.arm(plannedState.dwell_target_ms, onBoundary)`. `onBoundary` does nothing on its own — the next `PlannedState` arriving from the server is what advances the slot. The dwell-boundary callback simply emits a `dwell_boundary_reached` journal event (D-GRH-29) so backend reconciliation can detect dwell drift.
7. **Re-render on event.** `GameStateStore` subscription fires on each `GameState` snapshot or `GameEvent` delta for `primary_game_id`. The template diffs and mutates the DOM in place. No transition runs on per-event update — only on `PlannedState` swap.

### Supersede / detach

When a new `PlannedState` arrives (different `state_id`):

1. Cancel the current `DwellTimer`.
2. Run outgoing transition (`fade_scale_down` default).
3. Call `instance.detach()`; unsubscribe `GameStateStore` listener.
4. Begin the new activation flow from step 1.

### Idempotency

- `PlannedState` with the same `state_id` arriving twice (re-push artifact): no-op. The activator stores the active `state_id` and short-circuits.
- `ProgramSlot` upserts: last-write-wins per `program_slot_id`. Mid-session updates to a referenced slot trigger a soft re-render of the active template (`GameState` listener re-fires with current state) without re-running the transition.
- `GameState` snapshots carry no `seq` (SPEC-CRWDQ-017) — every snapshot is a recovery point and is always applied, resetting the per-`game_id` seq baseline. Only `GameEvent` deltas carry `seq`: a delta whose `seq` is ≤ the last applied seq for that `game_id` is dropped (journal `game_event_seq_regression`).

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022; activator registers as the `PlannedState` handler. |
| DOM | 1 in-process | jsdom. Real elements; assert on rendered text and attributes via `getByTestId`. |
| `GameStateStore` | 1 in-process | Real instance; drive snapshots/events via test driver. |
| `ProgramSlotResolver` | 1 in-process | Real instance. |
| `TransitionExecutor` | 2 local-substitutable | `InstantTransitionAdapter` that resolves immediately and records the animation_id. The real animation timing surfaces are exercised in SPEC-CRWDQ-027 e2e. |
| `DwellTimer` | system boundary | Vitest fake timers; assert on `arm`/`cancel`/boundary firing. |
| Theme CSS swap | 2 local-substitutable | `StyleSheetRegistry` mock that records the `theme_id`; real `<link>` injection covered by SPEC-CRWDQ-027 e2e. |
| Journal sink | 2 local-substitutable | In-memory journal. |
| `Date.now`, `performance.now` | system boundary | Frozen clock. |

Test cases:

- Happy path: `ProgramSlot` then `PlannedState{single_game}` then `GameState` arrivals → DOM contains home/away/score; subscription fires on event; DOM re-renders without transition.
- Re-push order edge: `PlannedState` arrives before `ProgramSlot` → activator buffers; on subsequent `ProgramSlot` arrival within 5s the template mounts. After 5s the activator escalates (journal `template_buffer_timeout`).
- Idempotent re-activation: same `state_id` × 2 → exactly one transition, exactly one mount.
- Supersede: second `PlannedState` (different `state_id`) → outgoing transition runs, instance detaches, subscription is removed, new mount happens.
- `primary_game_id` null: placeholder DOM, journal `template_render_fallback`, dwell still armed.
- Pending preference apply at boundary: `pendingApply` non-null at mount → `StyleSheetRegistry` records the new `theme_id`; `data-theme` attribute updates; `pendingApply` is consumed.
- Out-of-order `GameEvent` (seq 5 then seq 3): seq 3 dropped; journal `game_event_seq_regression`.
- Last-moment overlay: a `GameEvent` (kind `goal`) for `primary_game_id` → `<aside class="cdq-overlay">` renders text derived from the event's `kind`/`delta`/`at_clock`; with no `GameEvent` seen the overlay is absent.
- Transition catalog miss: `PlannedState.transition: "nonexistent"` → `TransitionExecutor` falls back to default fade; journal `transition_catalog_miss`.
- Dwell boundary: `DwellTimer.arm(30000)`; advance fake clock 30s → boundary callback fires; journal `dwell_boundary_reached` with `actualDwellMs` close to 30000 (∆ ≤ 1ms).

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`. Uses:

- `business_mode` — closed enum from D-GRH-30; this template handles `single_game` only.
- `program_slot_id`, `primary_game_id` — D-GRH-21 ProgramSlot fields.
- `sport_context` — fixed per-sport schema in D-GRH-09.
- `transition`, `animation_id`, `duration_ms` — D-GRH-50 flat catalog name.
- `dwell_target_ms` — backend-authored per-slot dwell (D-GRH-50).

## Acceptance Criteria

- [ ] `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` exports `SingleGameTemplate` whose `mount(host, ctx)` renders a `<section class="crowdaq-single-game">` containing the sport_context header, score block (home/away/clock), and last-moment overlay, with `data-testid` attributes for each sub-region.
- [ ] `PlannedStateActivator.activate(...)` is the registered `PlannedState` dispatcher handler (from SPEC-CRWDQ-022); same `state_id` arriving twice triggers exactly one transition and one mount.
- [ ] `ProgramSlotResolver` resolves `program_slot_id` to the current upserted slot; last-write-wins on per-id updates; resolution is synchronous.
- [ ] When `PlannedState` arrives before its referenced `ProgramSlot`, the activator buffers for up to 5 s and proceeds on arrival; otherwise journals `template_buffer_timeout` and emits `template_render_fallback`.
- [ ] `GameStateStore` accepts `GameState` snapshots (full state, always applied — no `seq`, resets the baseline) and `GameEvent` deltas (per-field, `seq`-ordered); subscribers fire on every applied change; a `GameEvent` whose `seq` regresses is dropped with a `game_event_seq_regression` journal entry; `lastEvent(gameId)` exposes the most recent applied event.
- [ ] Per D-GRH-21, `primary_game_id` is read from `ProgramSlot`, NOT from `PlannedState`. The template never reads `PlannedState.game_id` (singular) — fields not defined post-D-GRH-21.
- [ ] `TransitionExecutor.run(transitionName, host)` takes the `PlannedState.transition` catalog-name string, resolves it against the pre-baked catalog first, then the `AssetManifest` asset cache, then default fade; a catalog miss is journaled but the transition still completes.
- [ ] `DwellTimer.arm(dwell_target_ms, onBoundary)` fires `onBoundary` after the elapsed wall-clock duration ±1 ms in tests; `cancel()` prevents firing; re-arming replaces the prior schedule.
- [ ] Theme CSS swap occurs only on a dwell boundary when `pendingApply` is non-null; the swap consumes the pending slot; the active `PlannedState` is never forcibly re-mounted by a `ConfigPush` arrival.
- [ ] No multi-game, no ad panel, no fixture rendering: the template's DOM has no `.cdq-card-grid`, no `.cdq-ad-panel`, no `.cdq-fixture-card`. Other templates own those.
- [ ] Tests cover: happy path, re-push order edge, idempotent re-activation, supersede, null `primary_game_id`, pending apply at boundary, out-of-order GameEvent, transition catalog miss, dwell boundary firing.
- [ ] No mocks of `Dispatcher`, `GameStateStore`, `ProgramSlotResolver`, `DwellTimer`, or template internals (INV-FACTORY-16); only the WS source, clock, transition timing, and CSS injection are substituted (INV-FACTORY-17).
