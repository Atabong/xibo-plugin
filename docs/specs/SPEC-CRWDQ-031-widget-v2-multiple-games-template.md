---
spec_id: SPEC-CRWDQ-031
title: Widget v2 multiple_games (2x2 grid) render template + dwell handling
status: draft
owner: player-runtime/widget-v2/templates/multi-game
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-023]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-031 — Widget v2 multiple_games (2x2 grid) render template + dwell handling

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S5 — Weight rule + multi-game render |
| Plane epic | CRWDQ-6 |
| Decisions referenced | D-GRH-12, D-GRH-13, D-GRH-14, D-GRH-21, D-GRH-30, D-GRH-50, D-GRH-51 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `GameStateStore.ts`, `DwellTimer.ts`, `TransitionExecutor.ts` (consumed from SPEC-CRWDQ-023) |
| New files | `modules/widget-v2/src/templates/multi-game/MultiGameTemplate.ts`, `modules/widget-v2/src/templates/multi-game/multi-game.html`, `modules/widget-v2/src/templates/multi-game/multi-game.css`, `modules/widget-v2/src/templates/multi-game/CardSet.ts`, `modules/widget-v2/tests/templates/multi-game/*.test.ts` |

> **Backend authority note:** The `multiple_games` `PlannedState` / `ProgramSlot`
> wire shapes consumed by this template are produced by the authoritative
> backend specs `crowdaq-backend/docs/specs/SPEC-CRWDQ-030`
> (multi-game `PlannedState` emitter) and delivered by `SPEC-CRWDQ-020`
> (GameDeliveryService WS server, re-push order). Every claim below about
> field values, `template_id`, `transition`, card-count bounds, and frame
> ordering is cross-checked against those specs. The backend is the source
> of truth.

## Module

`player-runtime :: widget-v2 :: templates/multi-game` — the `multiple_games` business-mode template (D-GRH-30 mode #2). Renders a 2x2 grid (2–4 cards, card count dictated by `ProgramSlot.game_ids[]` length, D-GRH-14). Each card subscribes independently to the multiplexed `GameState` stream (D-GRH-12) for its `game_id`. The `primary_game_id` card is visually distinguished. Add/remove of cards is backend-driven via a revised `PlannedState`/`ProgramSlot` (D-GRH-13) — no player-side card lifecycle decisions.

> **Dependencies.** This template is built on the shared render orchestration introduced by **SPEC-CRWDQ-023** (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`) — a hard build dependency, declared in `depends_on`. **SPEC-CRWDQ-030** (the `BarPlayerSchedulerService` multi-game ordering output) is the cross-repo *backend producer* of the `multiple_games` `PlannedState`/`ProgramSlot` frames this template consumes; it is a wire-contract counterpart for shape agreement, not a build dependency, and is therefore not in `depends_on`.

## Current shape

- No multi-game rendering exists in the v1 widget. The v1 stencil and `<onRender>` block are single-game by design.
- SPEC-CRWDQ-023 introduced the shared `PlannedStateActivator` / `ProgramSlotResolver` / `GameStateStore` / `TransitionExecutor` orchestration, scoped to a single template family. This spec adds a second template family that plugs into the same orchestration without duplicating it.
- The grid CSS pattern is new to the widget. Existing widget CSS targets a single score panel; multi-game introduces a CSS Grid 2×2 layout with cells dynamically populated.

## Backend wire-contract facts (SPEC-CRWDQ-030 / -020 cross-check)

The following are guaranteed by the authoritative backend specs and constrain this template:

- **`business_mode === "multiple_games"`** is the discriminator on `PlannedStatePayload` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`).
- **`template_id` is backend-authored** as `multi-game-grid-<K>` where `K = min(scoredLiveGames.length, 4)` (SPEC-CRWDQ-030). `K` and `ProgramSlot.game_ids.length` always agree — the server never pads `game_ids` with placeholders and never emits `K` outside `[2, 4]` (SPEC-CRWDQ-030 ACs). This template derives card count from `game_ids.length`; `template_id` is a redundant cross-check, not the source of truth.
- **`PlannedStatePayload.transition === "cut"`** for every `multiple_games` `PlannedState` (SPEC-CRWDQ-030). The PlannedState-level `transition` is therefore always `cut` on the wire; the card-level enter/exit transitions named in this spec (`card_slide_in` / `card_slide_out`) are a **separate, player-internal** concept used only inside `reconcile()` — they are not `PlannedStatePayload.transition` values and are never read off the wire.
- **`ProgramSlot.primary_game_id`** for `multiple_games` is always `scoredLiveGames[0].gameId` — a non-null `game_id` that is always a member of `game_ids` (SPEC-CRWDQ-030). The `ProgramSlotPayload.primary_game_id` type is `string | null` (SPEC-CRWDQ-017); a `null` value is not produced for this mode. This template's null-primary handling is therefore a **defensive** path, not an expected one.
- **`ProgramSlot.fixture_ids === []`** for `multiple_games` (SPEC-CRWDQ-030). This template does not read `fixture_ids`.
- **`dwell_target_ms`** is backend-authored (`= defaultDwellMs`, SPEC-CRWDQ-030). The template executes the supplied value exactly; there is no per-card dwell.
- **Re-push frame order** (SPEC-CRWDQ-020, D-GRH-49) is `ConfigPush → ScheduleWindow → AssetManifest → PlannedState(s) → ProgramSlot(s) → GameState(s)` — `PlannedState` arrives **before** its referenced `ProgramSlot` on the re-push. The shared SPEC-CRWDQ-023 `PlannedStateActivator` already tolerates this by buffering a `PlannedState` until its `ProgramSlot` resolves; this template inherits that order-independence and never assumes a specific `(PlannedState, ProgramSlot)` arrival order.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/multi-game/MultiGameTemplate.ts
export interface MultiGameTemplate {
  mount(host: HTMLElement, context: MultiGameContext): MultiGameInstance;
}

export interface MultiGameContext {
  programSlot: ProgramSlotPayload; // game_ids[] length 2..4; primary_game_id ∈ game_ids
  theme: ResolvedTheme;            // resolved per SPEC-CRWDQ-023 § Theme resolution
  gameStateStore: GameStateStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface MultiGameInstance {
  /**
   * Called when a new PlannedState supersedes this one (different
   * state_id, different program_slot_id — the schedule advanced). Returns
   * the DOM node for the outgoing transition. An updated ProgramSlot for
   * the SAME program_slot_id is NOT a detach — it is handled via
   * reconcile() (the D-GRH-13 add/remove path).
   */
  detach(): HTMLElement;

  /**
   * Reconcile against an updated ProgramSlot. Diffs the new game_ids[]
   * against the current CardSet: cards whose game_id is no longer in
   * the list are removed (with the player-internal `card_slide_out` exit
   * transition); new game_ids are added (with the `card_slide_in` enter
   * transition). Reorders surviving cards into the new positions. No full
   * re-mount. Resolves when every card add/remove/move has settled.
   */
  reconcile(newSlot: ProgramSlotPayload): Promise<void>;
}
```

```ts
// modules/widget-v2/src/templates/multi-game/CardSet.ts
export interface CardSet {
  /** Set of currently rendered game_ids in display order. */
  current(): readonly string[];

  /** Add a card for game_id at the given position (0-based). Subscribes
   *  to GameStateStore. Resolves when the enter transition completes. */
  addCard(gameId: string, position: number): Promise<void>;

  /** Remove the card for game_id, running the `card_slide_out` exit
   *  transition. Unsubscribes from GameStateStore. Resolves when the exit
   *  transition completes and the DOM node is detached. */
  removeCard(gameId: string): Promise<void>;

  /** Move an existing card to a new position. No data change, layout-only.
   *  Synchronous — updates the data-position attribute and CSS grid cell. */
  moveCard(gameId: string, toPosition: number): void;

  /** Mark a card as the primary (visual distinction). Passing null clears
   *  the marker from every card. Synchronous. */
  setPrimary(gameId: string | null): void;
}
```

`ResolvedTheme`, `PendingPreferenceApply`, `ProgramSlotPayload`, and the `GameStateStore` / `PlannedStateActivator` / `ProgramSlotResolver` / `DwellTimer` / `TransitionExecutor` interfaces are all defined by SPEC-CRWDQ-023 and consumed verbatim here — this spec hand-authors none of them.

### Activation flow

`PlannedStateActivator` (from SPEC-CRWDQ-023) routes a `PlannedStateFrame` whose `payload.business_mode === "multiple_games"` to this template:

1. **Resolve `ProgramSlot`.** Same shared `ProgramSlotResolver`. The activator buffers the `PlannedStateFrame` if the referenced `ProgramSlot` has not yet been upserted (the SPEC-CRWDQ-023 buffer-with-5s-timeout path; the re-push delivers `PlannedState` before `ProgramSlot`, so buffering is the normal case). Once resolved, `game_ids[]` length is asserted ∈ `[2, 4]`. A length outside that range is a backend authoring error (SPEC-CRWDQ-030 guarantees `[2, 4]`); the template journals `template_input_invalid` and does not mount. Escalation to safe mode on this fall-through is out of scope here and is owned by SPEC-CRWDQ-052.
2. **Run transition.** The shared `TransitionExecutor` runs `PlannedStatePayload.transition`. The backend always supplies `"cut"` for `multiple_games` (SPEC-CRWDQ-030); a catalog miss falls back to the default per SPEC-CRWDQ-023's `TransitionExecutor` contract. This is the PlannedState-level transition only — card-level enter/exit transitions are run inside `reconcile()`, not here.
3. **Mount grid.** `MultiGameTemplate.mount(host, ctx)` builds the 2×2 grid (`<section class="crowdaq-multi-game cdq-grid-2x2">`). For each `game_id` in `programSlot.game_ids` order, `CardSet.addCard(gameId, position)` is called — each card subscribes to `GameStateStore` for that `game_id`. `setPrimary(programSlot.primary_game_id)` then marks the primary card.
4. **Apply pending preferences.** At this dwell boundary, the same path as SPEC-CRWDQ-023: theme CSS swap + `data-theme` attribute update via the SPEC-CRWDQ-023 § Theme resolution rule. `pendingApply` is consumed (cleared) here.
5. **Arm dwell.** Same `DwellTimer.arm(dwell_target_ms, onBoundary)` semantics as SPEC-CRWDQ-023. Per D-GRH-50 the backend authors `dwell_target_ms`; the template executes the supplied value exactly. `onBoundary` emits a `dwell_boundary_reached` journal event; the next `PlannedState` is what advances the slot.
6. **Per-game subscription.** Each `CardSet` card's `GameStateStore` subscription fires on its own `GameState` snapshots / `GameEvent` deltas, multiplexed over the single WS (D-GRH-12). DOM mutations happen in place; no transition runs on per-event updates.

### `ProgramSlot` revision flow (D-GRH-13 add/remove)

Per D-GRH-13 the backend sends a new `PlannedState` AND/OR an updated `ProgramSlot` (same `program_slot_id`) when the active game set changes. Both arrive on the control channel. The player makes no assumption about the relative arrival order of an updated `ProgramSlot` and its referencing `PlannedState`: the shared `ProgramSlotResolver` upserts on a last-write-wins basis keyed by `program_slot_id`, and the `PlannedStateActivator` buffers a `PlannedState` whose `ProgramSlot` has not yet resolved (SPEC-CRWDQ-023). Order-independence is the contract; the re-push itself (SPEC-CRWDQ-020) delivers `PlannedState` before `ProgramSlot`.

When the active template's `program_slot_id` is updated in place:

1. `ProgramSlotResolver.upsert(newSlot)` fires. The shared `PlannedStateActivator` (SPEC-CRWDQ-023) detects the upsert targets the *active* slot and routes it to the active instance's `reconcile(newSlot)` hook — rather than the SPEC-CRWDQ-023 "soft re-render" path used for instances that expose no `reconcile`.
   > **OPEN QUESTION:** SPEC-CRWDQ-023 as currently written does NOT declare an optional `reconcile?(slot)` hook on its generic template-instance contract — its `SingleGameInstance` exposes only `detach()`. This dispatch path therefore requires a follow-up edit to SPEC-CRWDQ-023 adding an optional `reconcile?(slot: ProgramSlotPayload): Promise<void>` member to the `PlannedStateActivator`'s template-instance interface, so the activator can branch on its presence (`MultiGameInstance` implements it; `SingleGameInstance` does not and keeps the soft-re-render path). This cross-spec change must be agreed with the SPEC-CRWDQ-023 owner before either spec is implemented. Until then, the routing in this step is not buildable.
2. The active instance's `reconcile(newSlot)` runs:
   - Diff `current()` against `newSlot.game_ids`.
   - Cards no longer in the list: `removeCard(gameId)` — runs the player-internal `card_slide_out` exit transition.
   - New cards: `addCard(gameId, position)` — runs the player-internal `card_slide_in` enter transition.
   - Surviving cards moved to their new positions via `moveCard`.
   - `setPrimary(newSlot.primary_game_id)`.
3. The dwell timer is NOT reset — only a slot supersede (a new `PlannedState` with a different `state_id`) resets dwell, per D-GRH-13 ("Player recomposes card layout from new `PlannedState`" — the dwell context belongs to the slot, not the cards).
4. Journal `multi_game_reconciled` with `added: [...]`, `removed: [...]`, `reordered: [...]` (each a list of `game_id` strings). If the new `game_ids` set and order are identical to the current set, `reconcile` is a no-op and emits no journal entry.

If instead a new `PlannedState` with a different `state_id` AND a different `program_slot_id` arrives (the schedule advanced, not just the card set), the standard supersede flow from SPEC-CRWDQ-023 runs — outgoing transition, `detach()` (which unsubscribes every card), new activation.

### Grid layout

CSS Grid:

```css
.cdq-grid-2x2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: var(--cdq-grid-gap, 12px);
}
.cdq-grid-2x2[data-card-count="2"] { grid-template-rows: 1fr; }
.cdq-grid-2x2[data-card-count="3"] .cdq-card[data-position="2"] { grid-column: span 2; }
.cdq-grid-2x2[data-card-count="4"] { /* normal 2x2 */ }
```

`data-card-count` is set on mount and updated on `reconcile`. Position attributes are `0..3` for the slots; the primary card carries `data-primary="true"`.

### Primary visual distinction

The primary card receives `data-primary="true"`. The CSS distinguishes via one of: size (`transform: scale(1.05)`), border emphasis, or backdrop tint — the exact visual is left to the theme CSS (D-GRH-51) so themes can choose. The contract is the attribute presence and uniqueness: exactly one card carries `data-primary="true"` when `programSlot.primary_game_id` is a member of `game_ids`, and zero cards carry it when `primary_game_id` is `null` (a defensive case — the backend does not produce `null` primary for `multiple_games`).

### Dwell handling

Multi-game cards share the slot dwell — there is no per-card dwell. When `DwellTimer` fires the boundary, the player emits a `dwell_boundary_reached` journal event. The next `PlannedState` arriving from the server advances the slot. Per-game updates (score changes, `GameEvent` deltas) during dwell never advance the slot and never reset the dwell timer.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore` | 1 in-process | Real shared instances from SPEC-CRWDQ-023; driven via test driver. |
| DOM | 1 in-process | jsdom. Asserts on `data-card-count`, `data-position`, `data-primary` attributes. |
| `TransitionExecutor` | 2 local-substitutable | `RecordingTransitionAdapter` records `animation_id` per PlannedState transition and per card enter/exit. |
| `DwellTimer` | system boundary | Vitest fake timers. |
| Journal sink | 2 local-substitutable | In-memory; assert event types and payload shape. |

Test cases:

- 2-card mount: `game_ids: ["g1","g2"]` → 2 `<div class="cdq-card">` in DOM, `data-card-count="2"`, both subscribed to `GameStateStore`.
- 3-card mount: `game_ids: ["g1","g2","g3"]` → `data-card-count="3"`; position 2 spans columns per CSS.
- 4-card mount: `game_ids: ["g1","g2","g3","g4"]` → standard 2×2.
- Out-of-bounds card count (defensive): `game_ids: ["g1"]` (1) or a 5-element list → journal `template_input_invalid`; no mount.
- Re-push order: a `multiple_games` `PlannedState` arrives before its `ProgramSlot` → the activator buffers and mounts on the subsequent `ProgramSlot` arrival within 5s (SPEC-CRWDQ-023 buffer path).
- PlannedState transition: `PlannedStatePayload.transition: "cut"` → `RecordingTransitionAdapter` records the `cut` PlannedState transition on mount; card-level transitions are not run on mount.
- Primary visual: `primary_game_id: "g2"` → exactly one card has `data-primary="true"`, on the matching `game_id`.
- Null primary (defensive): `primary_game_id: null` → zero cards have `data-primary="true"`; no crash.
- Per-game multiplexing: feed `GameState` for `g1`, then `g2`, then `g1` again → each card's DOM updates independently; no cross-talk.
- Reconcile add: `programSlot` updates from `["g1","g2"]` → `["g1","g2","g3"]` → `addCard("g3", 2)` runs the `card_slide_in` enter transition; dwell timer not reset; journal `multi_game_reconciled` with `added:["g3"]`, `removed:[]`, `reordered:[]`.
- Reconcile remove: `["g1","g2","g3"]` → `["g1","g3"]` → `removeCard("g2")` runs `card_slide_out`; surviving `g3` moves to position 1 via `moveCard`; journal `multi_game_reconciled` with `removed:["g2"]`, `reordered:["g3"]`.
- Reconcile reorder only: same `game_ids` set, different order → no add/remove, only `moveCard` calls; journal `reordered: [...]`.
- Reconcile no-op: an updated `ProgramSlot` with an identical `game_ids` set and order → no add/remove/move, no journal entry.
- Reconcile + primary change: `primary_game_id` shifts from `g1` to `g2` → exactly one card has `data-primary="true"` after, on `g2`.
- Out-of-order `GameEvent`: feed a `GameEvent` for `g1` at seq 5 then seq 3 → seq 3 dropped for `g1` (`game_event_seq_regression` per SPEC-CRWDQ-023 `GameStateStore`), `g2` unaffected (per-game seq tracking).
- Dwell boundary on multi-game: timer fires after `dwell_target_ms`; journal `dwell_boundary_reached`; cards remain rendered until the next `PlannedState`.
- Supersede to single_game: a new `PlannedState{business_mode:'single_game'}` with a different `state_id` and `program_slot_id` → outgoing transition on the multi-game host; `detach()` unsubscribes every card; `SingleGameTemplate` mounts.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- `multiple_games` — D-GRH-30 business mode #2; the `PlannedStatePayload.business_mode` value.
- `game_ids[]` — ordered list on `ProgramSlotPayload` (D-GRH-21); length ∈ `[2, 4]` for `multiple_games`.
- `primary_game_id` — `ProgramSlotPayload` field; the visually-distinguished card; for `multiple_games` always `scoredLiveGames[0].gameId` (SPEC-CRWDQ-030).
- `template_id` — `PlannedStatePayload` field; `multi-game-grid-<K>` for this mode (SPEC-CRWDQ-030).
- "multiplexed stream" — D-GRH-12 single WS carrying N games' `GameState` / `GameEvent` frames.
- `card_slide_in` / `card_slide_out` — local terms: the player-internal enter/exit transitions run by `reconcile()` for card add/remove. They are NOT `PlannedStatePayload.transition` catalog values.

## Acceptance Criteria

- [ ] `MultiGameTemplate.mount(host, ctx)` renders `<section class="crowdaq-multi-game cdq-grid-2x2" data-card-count="N" data-theme="...">` with one `<div class="cdq-card" data-game-id="..." data-position="...">` per game in `ProgramSlotPayload.game_ids[]` (D-GRH-14 order preserved).
- [ ] Card count outside `[2, 4]` journals `template_input_invalid` and the template does not mount. This is a defensive path — SPEC-CRWDQ-030 guarantees the backend emits `game_ids.length` ∈ `[2, 4]`. Escalation to safe is out of scope here; SPEC-CRWDQ-052 owns it.
- [ ] Exactly one card carries `data-primary="true"` when `programSlot.primary_game_id` is a member of `game_ids`; zero when `primary_game_id` is `null` (defensive); the assertion holds across reconciles.
- [ ] Each card subscribes to `GameStateStore` for its own `game_id`; per-game `GameState` / `GameEvent` updates mutate only that card's DOM (multiplexing per D-GRH-12).
- [ ] The PlannedState-level transition run on mount is `PlannedStatePayload.transition` (always `"cut"` from the backend for `multiple_games`, per SPEC-CRWDQ-030); the card-level `card_slide_in` / `card_slide_out` transitions are run only inside `reconcile()` and are never read off the wire.
- [ ] `reconcile(newSlot)` diffs the current `game_ids` against the new list, removing missing cards with the `card_slide_out` exit transition, adding new cards with the `card_slide_in` enter transition, repositioning survivors via `moveCard`, and updating the primary marker — all WITHOUT resetting `DwellTimer` (D-GRH-13: a card change is not a slot change).
- [ ] Journal entry `multi_game_reconciled` is emitted on every successful reconcile that changes the card set or order, carrying `added`, `removed`, `reordered` lists; it is NOT emitted when the new `game_ids` set and order are identical to the current.
- [ ] A `multiple_games` `PlannedState` arriving before its referenced `ProgramSlot` is buffered by the shared SPEC-CRWDQ-023 `PlannedStateActivator` and mounts on the `ProgramSlot` arrival; the template makes no assumption about `(PlannedState, ProgramSlot)` arrival order.
- [ ] Mode supersede (different `state_id`, different `program_slot_id`) routes through the shared `PlannedStateActivator` supersede flow — outgoing transition, `detach()` unsubscribes every card, the new template mounts.
- [ ] Theme CSS swap and `pendingApply` consumption follow the same dwell-boundary contract as SPEC-CRWDQ-023 — no new mechanism; `ctx.theme` is the SPEC-CRWDQ-023 `ResolvedTheme`.
- [ ] Per-game seq tracking: an out-of-order `GameEvent` for `gN` is dropped for that game only (`game_event_seq_regression`); other cards unaffected.
- [ ] Tests cover: 2/3/4-card mount, out-of-bounds count, re-push order buffering, PlannedState transition, primary present/null, per-game multiplexing, reconcile add/remove/reorder/no-op, primary shift on reconcile, out-of-order `GameEvent`, dwell boundary, supersede to single_game.
- [ ] No mocks of shared orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`) or `CardSet` internals (INV-FACTORY-16).
