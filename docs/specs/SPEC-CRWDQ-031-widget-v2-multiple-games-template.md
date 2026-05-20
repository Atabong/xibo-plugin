---
spec_id: SPEC-CRWDQ-031
title: Widget v2 multiple_games (2x2 grid) render template + dwell handling
status: draft
owner: player-runtime/widget-v2/templates/multi-game
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-030]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-031 — Widget v2 multiple_games (2x2 grid) render template + dwell handling

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S5 — Weight rule + multi-game render |
| Plane epic | CRWDQ-6 |
| Decisions referenced | D-GRH-12, D-GRH-13, D-GRH-14, D-GRH-21, D-GRH-30, D-GRH-50 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `GameStateStore.ts`, `DwellTimer.ts`, `TransitionExecutor.ts` (consumed from SPEC-CRWDQ-023) |
| New files | `modules/widget-v2/src/templates/multi-game/MultiGameTemplate.ts`, `modules/widget-v2/src/templates/multi-game/multi-game.html`, `modules/widget-v2/src/templates/multi-game/multi-game.css`, `modules/widget-v2/src/templates/multi-game/CardSet.ts`, `modules/widget-v2/tests/templates/multi-game/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/multi-game` — the `multiple_games` business-mode template (D-GRH-30 mode #2). Renders a 2x2 grid (size 2–4 cards, dictated by `ProgramSlot.game_ids[]` length, D-GRH-14). Each card subscribes independently to the multiplexed `GameState` stream (D-GRH-12) for its `game_id`. The `primary_game_id` card is visually distinguished. Add/remove of cards is backend-driven via revised `PlannedState`/`ProgramSlot` (D-GRH-13) — no player-side card lifecycle decisions.

## Current shape

- No multi-game rendering exists in the v1 widget. The v1 stencil and `<onRender>` block are single-game by design.
- SPEC-CRWDQ-023 introduced the shared `PlannedStateActivator` / `ProgramSlotResolver` / `GameStateStore` / `TransitionExecutor` orchestration, scoped to a single template family. This spec adds a second template family that plugs into the same orchestration without duplicating it.
- The grid CSS pattern is new to the widget. Existing widget CSS targets a single score panel; multi-game introduces a CSS Grid 2×2 layout with cells dynamically populated.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/multi-game/MultiGameTemplate.ts
export interface MultiGameTemplate {
  mount(host: HTMLElement, context: MultiGameContext): MultiGameInstance;
}

export interface MultiGameContext {
  programSlot: ProgramSlot;       // game_ids[] length 2..4; primary_game_id ∈ game_ids
  themeId: string | null;
  gameStateStore: GameStateStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface MultiGameInstance {
  /**
   * Called when a new PlannedState supersedes this one, OR when an
   * updated ProgramSlot (same program_slot_id) arrives with a different
   * game_ids[] — the latter is the D-GRH-13 add/remove path, handled
   * via reconcile() not detach.
   */
  detach(): HTMLElement;

  /**
   * Reconcile against an updated ProgramSlot. Diffs the new game_ids[]
   * against the current CardSet: cards whose game_id is no longer in
   * the list are removed (with exit transition); new game_ids are
   * added (with enter transition). Reorders surviving cards into the
   * new positions. No full re-mount.
   */
  reconcile(newSlot: ProgramSlot): Promise<void>;
}
```

```ts
// modules/widget-v2/src/templates/multi-game/CardSet.ts
export interface CardSet {
  /** Set of currently rendered game_ids in display order. */
  current(): readonly string[];

  /** Add a card for game_id at the given position. Subscribes to GameStateStore. */
  addCard(gameId: string, position: number): Promise<void>;

  /** Remove the card for game_id, with the named exit transition. Unsubscribes. */
  removeCard(gameId: string): Promise<void>;

  /** Move an existing card to a new position. No data change, layout-only. */
  moveCard(gameId: string, toPosition: number): void;

  /** Mark a card as the primary (visual distinction). */
  setPrimary(gameId: string | null): void;
}
```

### Activation flow

`PlannedStateActivator` (from SPEC-CRWDQ-023) routes `mode: "multiple_games"` to this template:

1. **Resolve `ProgramSlot`.** Same shared resolver. `game_ids[]` MUST have length ∈ [2, 4]; outside that range journals `template_input_invalid` and falls through to safe.
2. **Run transition.** Same shared `TransitionExecutor`. Default `card_reshuffle` if catalog miss.
3. **Mount grid.** `MultiGameTemplate.mount(host, ctx)` builds the 2×2 grid (`<section class="crowdaq-multi-game cdq-grid-2x2">`). For each `game_id` in `programSlot.game_ids` order, `CardSet.addCard(gameId, position)` is called — each subscribes to `GameStateStore` for that `game_id`. `setPrimary(programSlot.primary_game_id)`.
4. **Apply pending preferences.** At this dwell boundary, same path as SPEC-CRWDQ-023: theme CSS swap + `data-theme` attribute update. `pendingApply` consumed.
5. **Arm dwell.** Same `DwellTimer.arm(...)` semantics. Per D-GRH-50 the backend authors `dwell_target_ms`; the template executes exactly.
6. **Per-game subscription.** Each `CardSet` card's subscription fires on its own `GameState` snapshots / `GameEvent` deltas, multiplexed over the single WS (D-GRH-12). DOM mutations happen in place; no transition runs on per-event updates.

### `ProgramSlot` revision flow (D-GRH-13 add/remove)

Per D-GRH-13 the backend sends a new `PlannedState` AND/OR an updated `ProgramSlot` (same `program_slot_id`) when the active game set changes. Both arrive on the control channel; the dispatcher's order is "ProgramSlot first, then referencing PlannedState," guaranteed by the wire spec (D-GRH-21 referential integrity).

When the active template's `program_slot_id` is updated in place:

1. `ProgramSlotResolver.upsert(newSlot)` fires.
2. The active instance's `reconcile(newSlot)` runs:
   - Diff `current()` vs `newSlot.game_ids`.
   - Cards no longer in the list: `removeCard(gameId)` with exit transition (`card_slide_out` default).
   - New cards: `addCard(gameId, position)` with enter transition (`card_slide_in` default).
   - Surviving cards moved to their new positions via `moveCard`.
   - `setPrimary(newSlot.primary_game_id)`.
3. The dwell timer is NOT reset — only mode change resets dwell, per D-GRH-13 ("Player recomposes card layout from new `PlannedState`" — the dwell context belongs to the slot, not the cards).
4. Journal `multi_game_reconciled` with `added: [...], removed: [...], reordered: [...]`.

If instead a new `PlannedState` with a different `state_id` AND a different `program_slot_id` arrives (i.e., the schedule advanced, not just the card set), the standard supersede flow from SPEC-CRWDQ-023 runs — outgoing transition, detach, new activation.

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

The primary card receives `data-primary="true"`. The CSS distinguishes via one of: size (slight `transform: scale(1.05)`), border emphasis, or backdrop tint — the spec leaves the exact visual to the theme CSS (D-GRH-51) so themes can choose. The contract is the attribute presence and uniqueness (exactly one card has `data-primary="true"` at any time, or zero if `primary_game_id` is null).

### Dwell handling

Per the spec title's emphasis on "dwell handling": multi-game cards share the slot dwell. There is no per-card dwell. When `DwellTimer` fires the boundary, the player emits `dwell_boundary_reached`. The next `PlannedState` arriving advances the slot. Per-game updates (score changes etc.) during dwell never advance the slot.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore` | 1 in-process | Real shared instances from SPEC-CRWDQ-023; driven via test driver. |
| DOM | 1 in-process | jsdom. Asserts on `data-card-count`, `data-position`, `data-primary` attributes. |
| `TransitionExecutor` | 2 local-substitutable | `RecordingTransitionAdapter` records `animation_id` per enter/exit. |
| `DwellTimer` | system boundary | Fake timers. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- 2-card mount: `game_ids: ["g1","g2"]` → 2 `<div class="cdq-card">` in DOM, `data-card-count="2"`, both subscribed.
- 3-card mount: `game_ids: ["g1","g2","g3"]` → `data-card-count="3"`; position 2 spans columns per CSS.
- 4-card mount: `game_ids: ["g1","g2","g3","g4"]` → standard 2×2.
- Out-of-bounds card count: `game_ids: ["g1"]` (1) or `[1..5]` (5) → journal `template_input_invalid`; no mount.
- Primary visual: `primary_game_id: "g2"` → exactly one card has `data-primary="true"`, on the matching `game_id`.
- Null primary: `primary_game_id: null` → zero cards have `data-primary="true"`.
- Per-game multiplexing: feed `GameState` for `g1`, then `g2`, then `g1` again → each card's DOM updates independently; no cross-talk.
- Reconcile add: `programSlot` updates from `["g1","g2"]` → `["g1","g2","g3"]` → `addCard("g3", 2)` exit/enter sequence; dwell timer not reset; journal `multi_game_reconciled` with `added:["g3"]`.
- Reconcile remove: `["g1","g2","g3"]` → `["g1","g3"]` → `removeCard("g2")`; surviving `g3` moves to position 1 (`moveCard`); journal logs `removed:["g2"], reordered:["g3"]`.
- Reconcile reorder only: same `game_ids` set, different order → no add/remove, only `moveCard` calls; journal logs `reordered: [...]` only.
- Reconcile + primary change: `primary_game_id` shifts from `g1` to `g2` → exactly one card has `data-primary="true"` after, on `g2`.
- Out-of-order `GameEvent`: feed `g1` event seq 5 then seq 3 → seq 3 dropped for `g1`, `g2` unaffected (per-game seq tracking).
- Dwell boundary on multi-game: timer fires after `dwell_target_ms`; journal `dwell_boundary_reached`; cards remain rendered until the next `PlannedState`.
- Supersede to single_game: new `PlannedState{single_game}` with different `state_id` → outgoing transition on the multi-game host; detach unsubscribes all 4 cards; SingleGameTemplate mounts.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- `multiple_games` — D-GRH-30 mode #2.
- `game_ids[]` — ordered list on `ProgramSlot` (D-GRH-21).
- `primary_game_id` — `ProgramSlot` field; the visually-distinguished card.
- "multiplexed stream" — D-GRH-12 single WS carrying N games' events.

## Acceptance Criteria

- [ ] `MultiGameTemplate.mount(host, ctx)` renders `<section class="crowdaq-multi-game cdq-grid-2x2" data-card-count="N" data-theme="...">` with one `<div class="cdq-card" data-game-id="..." data-position="..."` per game in `ProgramSlot.game_ids[]` (D-GRH-14 order preserved).
- [ ] Card count outside [2, 4] journals `template_input_invalid` and the template does not mount (escalation to safe is out of scope here; SPEC-CRWDQ-052 owns it).
- [ ] Exactly one card carries `data-primary="true"` when `programSlot.primary_game_id` is in `game_ids`; zero when null; the assertion holds across reconciles.
- [ ] Each card subscribes to `GameStateStore` for its own `game_id`; per-game `GameState` / `GameEvent` updates mutate only that card's DOM (multiplexing per D-GRH-12).
- [ ] `reconcile(newSlot)` diffs the current `game_ids` against the new list, removing missing cards with exit transition, adding new cards with enter transition, repositioning survivors via `moveCard`, and updating the primary marker — all WITHOUT resetting `DwellTimer` (D-GRH-13: card change is not a slot change).
- [ ] Journal entry `multi_game_reconciled` is emitted on every successful reconcile with `added`, `removed`, `reordered` lists; not emitted when the slot is unchanged.
- [ ] Mode supersede (different `state_id`, different mode) routes through the shared `PlannedStateActivator.activate(...)` supersede flow — outgoing transition, detach unsubscribes all cards, new template mounts.
- [ ] Theme CSS swap and `pendingApply` consumption follow the same dwell-boundary contract as SPEC-CRWDQ-023 — no new mechanism.
- [ ] Per-game seq tracking: out-of-order `GameEvent` for `gN` is dropped for that game only; other cards unaffected.
- [ ] Tests cover: 2/3/4-card mount, out-of-bounds count, primary present/null, per-game multiplexing, reconcile add/remove/reorder, primary shift on reconcile, out-of-order GameEvent, dwell boundary, supersede to single_game.
- [ ] No mocks of shared orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`) or `CardSet` internals (INV-FACTORY-16).
