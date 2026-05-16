---
spec_id: SPEC-CRWDQ-066
title: Widget v2 fixtures_with_live_game template
status: draft
parent: S6
area: player-runtime/widget-v2/templates/mixed-state
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-066 — Widget v2 fixtures_with_live_game template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S6 — Fixtures mode (mixed-state extension); ranges into S7 — Mixed-state semantics |
| Plane epic | CRWDQ-7 |
| Decisions referenced | D-GRH-08, D-GRH-12, D-GRH-17, D-GRH-18, D-GRH-20, D-GRH-21, D-GRH-25, D-GRH-30, D-GRH-50, D-GRH-73 |
| Source files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts` (composed), `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` (re-used as inline live tile), `modules/widget-v2/src/render/PlannedStateActivator.ts` (consumed), `modules/widget-v2/src/render/ProgramSlotResolver.ts` (consumed), `modules/widget-v2/src/render/FixtureListStore.ts` (consumed), `modules/widget-v2/src/render/GameStateStore.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/mixed-state/FixturesWithLiveGameTemplate.ts`, `modules/widget-v2/src/templates/mixed-state/LiveFixtureTile.ts`, `modules/widget-v2/src/templates/mixed-state/fixtures-with-live-game.css`, `modules/widget-v2/tests/templates/mixed-state/*.test.ts` |
| Blocked by | SPEC-CRWDQ-023 (single_game base — composed inside the live tile), SPEC-CRWDQ-034 (fixtures template — composed for the static tiles) |

## Module

`player-runtime :: widget-v2 :: templates/mixed-state` — the `fixtures_with_live_game` business-mode template (D-GRH-30 mode #7). Renders a pre-game fixture grid (SPEC-CRWDQ-034 shape) where exactly one fixture tile is promoted to a live game render (SPEC-CRWDQ-023 shape). The promoted tile is driven by `GameState` for the matching `game_id` and receives `GameEvent` deltas; the other tiles stay static fixture cards (`FixtureListStore`-driven).

This is the canonical "mixed-state" composite: D-GRH-30 #7 is what S7 ("mixed-state semantics") opens, and this spec is the player-side rendering of it.

## Current shape

- SPEC-CRWDQ-034 renders pure fixture cards with no live game data — it explicitly notes "Display of the live score is the job of the `fixtures_with_live_game` mode (a separate template not in this slice's scope)." This spec is that separate template.
- SPEC-CRWDQ-023 renders `single_game` standalone (full-surface). The `LiveFixtureTile` introduced here adapts the `SingleGameTemplate` to a constrained tile-sized container — the tile is a smaller render of the same `GameStateStore`-driven content, with the score block as the primary affordance.
- D-GRH-21 establishes `ProgramSlot.game_ids[]` as the ordered list of games referenced by a slot. For `fixtures_with_live_game`, the live game's `game_id` is `primary_game_id` (per D-GRH-21's existing semantics for which game is "the" game). The remaining tiles correspond to `ProgramSlot.fixture_ids[]` (the static fixtures).
- D-GRH-25 establishes `FixtureList` as a game-data-channel frame. The same store SPEC-CRWDQ-034 already consumes covers the static tiles here.
- D-GRH-12's "single multiplexed stream" guarantees that `GameState` for the promoted tile arrives over the same WS the dispatcher already routes — no new transport.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/mixed-state/FixturesWithLiveGameTemplate.ts
export interface FixturesWithLiveGameTemplate {
  mount(host: HTMLElement, ctx: FixturesWithLiveGameContext): FixturesWithLiveGameInstance;
}

export interface FixturesWithLiveGameContext {
  /**
   * ProgramSlot carries BOTH fixture_ids[] and a non-null
   * primary_game_id. The fixture matching primary_game_id is the
   * promoted live tile; the remaining fixture_ids render static.
   * Backend authoring guarantees primary_game_id corresponds to one
   * of the fixtures in the slot (matched via fixture.game_id ==
   * primary_game_id, per D-GRH-20).
   */
  programSlot: ProgramSlot;
  themeId: string | null;
  timezone: string;
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  gameStateStore: GameStateStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesWithLiveGameInstance {
  detach(): HTMLElement;
  /**
   * D-GRH-13 reconcile path: the promoted game_id may change (game
   * ended; backend re-promotes another live fixture) without slot
   * supersede.
   */
  reconcile(newSlot: ProgramSlot): Promise<void>;
}
```

```ts
// modules/widget-v2/src/templates/mixed-state/LiveFixtureTile.ts
/**
 * Reduced-surface render of a live game suitable for placement in a
 * fixture-grid cell. Reuses the SingleGameTemplate's GameStateStore
 * subscription wiring but mounts a tile-shaped DOM (compact score
 * block, no sport_context header, no last-moment overlay — those
 * belong to the full-surface single_game template).
 */
export interface LiveFixtureTile {
  mount(host: HTMLElement, ctx: LiveFixtureTileContext): LiveFixtureTileInstance;
}

export interface LiveFixtureTileContext {
  gameId: string;                  // primary_game_id
  fixture: Fixture;                // static frame for team/sport/league metadata
  gameStateStore: GameStateStore;
  assetManifestStore: AssetManifestStore;
}

export interface LiveFixtureTileInstance {
  detach(): HTMLElement;
}
```

### DOM shape

```
<section class="crowdaq-fixtures-with-live-game" data-theme>
  <header class="cdq-fixtures-header"><h2>Coming up</h2></header>
  <ul class="cdq-fixture-list">
    <li class="cdq-fixture-card cdq-tile-live" data-fixture-id data-status="live" data-game-id>
      <span class="cdq-sport-badge"><img alt="" src="<asset-url>"></span>
      <div class="cdq-tile-score" data-testid="live-tile-score">
        <span class="cdq-tile-home"><img class="cdq-team-logo"><span class="cdq-team-name">HOME</span><span class="cdq-tile-home-score">0</span></span>
        <span class="cdq-tile-clock">Q3 8:12</span>
        <span class="cdq-tile-away"><span class="cdq-tile-away-score">0</span><span class="cdq-team-name">AWAY</span><img class="cdq-team-logo"></span>
      </div>
      <span class="cdq-status" data-status="live">LIVE</span>
    </li>
    <li class="cdq-fixture-card" data-fixture-id data-status="scheduled">
      <!-- standard SPEC-CRWDQ-034 fixture card -->
    </li>
    <!-- ...remaining static fixture_ids -->
  </ul>
</section>
```

The promoted tile gets the `cdq-tile-live` class and the additional `data-game-id` attribute. The live tile's children differ from a static fixture card (no `time`, no `vs` separator — the score block replaces those). Static tiles are SPEC-CRWDQ-034's existing card shape, unchanged.

### Activation flow

For `PlannedState` with `mode: "fixtures_with_live_game"` and `program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Shared resolver. `programSlot.fixture_ids[]` MUST be non-empty AND `programSlot.primary_game_id` MUST be non-null. Either constraint violation → journal `template_input_invalid` and fall through to safe.
2. **Identify the promoted fixture.** Find `fixture` in `fixture_ids` such that `FixtureListStore.resolve(fixture_id).game_id === programSlot.primary_game_id`. If no fixture matches (backend authoring error — the live game must correspond to one of the listed fixtures), journal `template_input_invalid` and fall through to safe.
3. **Resolve fixtures.** For each `fixture_id`, `FixtureListStore.resolve(fixture_id)`. Same cache-miss handling as SPEC-CRWDQ-034 (placeholder card, journal `fixture_cache_miss`).
4. **Resolve assets.** Same path as SPEC-CRWDQ-034 (sport badges, team logos).
5. **Format times** for the STATIC tiles only. The promoted tile shows a score block, not a `scheduled_at` time. Same formatter rules as SPEC-CRWDQ-034.
6. **Run transition.** Default `slide_stagger_in`, same as SPEC-CRWDQ-034.
7. **Mount the section + list.** For each fixture in order:
   - If `fixture_id === promotedFixtureId`: mount `LiveFixtureTile.mount(tileHost, { gameId: primary_game_id, fixture, gameStateStore, assetManifestStore })`. The tile subscribes to `GameStateStore.subscribe(primary_game_id, listener)`.
   - Else: mount a SPEC-CRWDQ-034 static fixture card (reuse the existing card-rendering primitive from SPEC-CRWDQ-034).
8. **Apply pending preferences** + **Arm dwell.** Same shared boundaries.

### Live tile rendering

The `LiveFixtureTile` is a small, focused render:

- Reads `GameState.home.score`, `GameState.away.score`, `GameState.clock`, `GameState.period` (D-SCHEMA-09 fields).
- Renders home + away team logos (resolved via `AssetManifestStore.get("team_logo:" + team_id)`) using the same lookup the static fixture card already uses for the matching fixture's home/away `team_id` (the team metadata source is the `Fixture` frame, not `GameState`).
- Initial DOM populated from current `GameStateStore.get(primary_game_id)` snapshot. Per D-GRH-21 + the SPEC-CRWDQ-023 ordering rule, by the time `PlannedState{fixtures_with_live_game}` arrives, the backend has already pushed `GameState` for `primary_game_id` over the game-data channel.
- Subsequent `GameEvent` deltas mutate the score/clock/period text nodes in place. No transition runs on per-event updates.
- The tile does NOT render `sport_context` (no period_clock overlay, no venue badge) — those are full-surface-only.
- The tile does NOT render `last_moment` — full-surface-only.

### Reconcile

The `primary_game_id` can change mid-slot (D-GRH-13) when:
- The current promoted game ends and the backend rotates to another live fixture in the same set.
- The backend reorders `fixture_ids` or swaps `primary_game_id`.

`reconcile(newSlot)`:
1. Find the new promoted fixture: locate `fixture.game_id === newSlot.primary_game_id` in `newSlot.fixture_ids`.
2. If the new promoted fixture is the same as the current → no structural change; the existing `LiveFixtureTile`'s `GameStateStore` subscription is already on the right `game_id`. Continue.
3. If the new promoted fixture is different:
   - Unsubscribe the old `LiveFixtureTile` (detach, no transition — small cross-fade only).
   - Find the new promoted fixture's `<li>` in the rendered list.
   - Replace its inner content with a `LiveFixtureTile` mount.
   - The OLD promoted slot demotes to static fixture: render the SPEC-CRWDQ-034 static card content in its `<li>` (status may now be `final`).
4. If `fixture_ids` changed (added/removed entries), apply SPEC-CRWDQ-034's reconcile path to the static portion.
5. Dwell timer NOT reset.
6. Journal `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id` (or `null` if no demote).

### Status flip mid-slot (live → final)

If the promoted game's `GameState.status` transitions to `final` via a `GameEvent`, the tile's score block freezes on the final values and the LIVE pill is replaced by `FINAL`. The tile remains the visually promoted cell until the next `PlannedState` arrives — the player does NOT auto-demote on status change. Status semantics belong to the backend, which will rotate the slot via a new `PlannedState` or update `ProgramSlot.primary_game_id`.

### Fixture frame edits mid-slot

If `FixtureList` re-pushes change a static tile's `status` (`scheduled` → `live`), the static tile updates its pill and `data-status` attribute. It does NOT auto-promote to a live tile — promotion is backend-driven via `primary_game_id`.

### Supersede

Standard SPEC-CRWDQ-023 supersede path: outgoing transition, detach, new activation. `detach()` unsubscribes the `LiveFixtureTile`'s `GameStateStore` subscription AND every static tile's `FixtureListStore` subscription.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| Shared orchestration | 1 in-process | Real instances from SPEC-CRWDQ-023. |
| `FixturesTemplate` (static-card primitive) | 1 in-process | Real instance from SPEC-CRWDQ-034 — re-used, not mocked. |
| `SingleGameTemplate` / `LiveFixtureTile` | 1 in-process | Real instance — `LiveFixtureTile` is a new primitive in this spec, exercised directly. |
| `FixtureListStore`, `GameStateStore`, `AssetManifestStore`, `ProgramSlotResolver` | 1 in-process | Real instances; frame-injection test driver. |
| DOM | 1 in-process | jsdom; assert tile placement, `data-game-id`, score values. |
| `Intl.DateTimeFormat` | 1 in-process | Real, for static tile times. |
| `TransitionExecutor`, `DwellTimer`, clock, journal | as in SPEC-CRWDQ-023 / 034 | Same fakes. |

Test cases:

- **Happy mount.** `programSlot = { fixture_ids: [fA, fB, fC], primary_game_id: G1 }`; `fA.game_id === G1, status: live`; `fB, fC: scheduled`. Pre-seed `GameStateStore.get(G1) = { home.score: 14, away.score: 7, period: "Q3", clock: "8:12" }`. Mount. Assert: `<li data-fixture-id="fA" data-status="live" data-game-id="G1" class="cdq-fixture-card cdq-tile-live">` is present; `.cdq-tile-home-score` = "14", `.cdq-tile-away-score` = "7"; LIVE pill on fA only; fB and fC are static fixture cards with bar-local times.
- **GameEvent updates live tile in place.** Mount as above; send `GameEvent` for G1 raising `home.score` to 21. Assert: `.cdq-tile-home-score` mutates to "21"; no other tile re-renders; no transition runs.
- **FixtureList re-push updates a static tile.** Mount as above; re-push `FixtureList` with `fB.status: "live"`. Assert: fB's `data-status` flips to `"live"`, LIVE pill renders; fB does NOT auto-promote to a live tile (`<li>` still uses the static-card layout, no `cdq-tile-live` class).
- **primary_game_id not in any fixture.** `programSlot = { fixture_ids: [fA, fB], primary_game_id: G_GHOST }`. Assert: journal `template_input_invalid`; no mount; fall-through to safe.
- **primary_game_id null.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Empty fixture_ids.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Reconcile to new promoted game.** Mount with promoted = fA/G1. Send revised `ProgramSlot` (same `program_slot_id`) with `primary_game_id: G2` where `fB.game_id === G2`. Assert: fA tile demotes to static card (now renders `fA.status`, e.g., `final`, with score-frozen layout per SPEC-CRWDQ-034 final-status card); fB tile promotes to `cdq-tile-live` with `data-game-id="G2"`; old `GameStateStore` subscription for G1 unsubscribed; new subscription on G2; dwell timer NOT reset; journal `live_tile_reconciled` with the right payload.
- **Reconcile: same promoted game, fixture_ids changed.** Same `primary_game_id`, added `fD` and removed `fC`. Assert: no structural change to live tile; SPEC-CRWDQ-034 reconcile path runs for the static portion.
- **GameState status → final mid-slot.** Mount with G1 live. Send `GameEvent` flipping `G1.status = "final"`. Assert: tile pill changes from LIVE to FINAL; score block freezes; tile still in the promoted cell (no auto-demote).
- **Asset cache miss for team logo (live tile).** `assetManifestStore.get("team_logo:" + home_team_id)` returns null. Assert: text-only initials fallback per D-GRH-08; the tile still renders the score; journal-less (same path as SPEC-CRWDQ-034).
- **Supersede.** Send new `PlannedState` (different `state_id`). Assert: outgoing transition runs on the section; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile unsubscribes from `FixtureListStore`.

## Vocabulary

- `fixtures_with_live_game` — D-GRH-30 #7.
- `primary_game_id`, `fixture_ids[]` — D-GRH-21.
- `Fixture.game_id`, `Fixture.status: 'live'` — D-GRH-20.
- "promoted tile", "demote" — internal terms defined in this spec.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-023 — `SingleGameTemplate` shape is the reference for `LiveFixtureTile`'s `GameStateStore` wiring; shared orchestration is consumed.
- SPEC-CRWDQ-034 — fixture-card primitive (static tiles), `FixtureListStore`, asset resolution path; SPEC-CRWDQ-034's reconcile path is reused for the static portion.

**Soft dependency:**

- SPEC-CRWDQ-063 — an `OverrideInjection` may target this mode and routes through the same `PlannedStateActivator`. No interface change required.

**Blocks (downstream):**

- None in the current xibo-plugin spec set.

## Acceptance Criteria

- [ ] `FixturesWithLiveGameTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures-with-live-game">` with a `.cdq-fixture-list` containing one `<li class="cdq-fixture-card cdq-tile-live" data-game-id>` for the promoted fixture and a SPEC-CRWDQ-034 static card for each remaining `fixture_id`.
- [ ] `PlannedStateActivator` dispatches `mode: "fixtures_with_live_game"` to this template; activation reuses `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`.
- [ ] Promoted-fixture identification: matches `fixture.game_id === programSlot.primary_game_id`; if no fixture matches, the template journals `template_input_invalid` and falls through to safe.
- [ ] Constraint violations (`primary_game_id == null`, `fixture_ids.length === 0`) journal `template_input_invalid` and do not mount.
- [ ] The live tile subscribes to `GameStateStore.subscribe(primary_game_id, ...)`; `GameEvent` deltas mutate `.cdq-tile-home-score`, `.cdq-tile-away-score`, `.cdq-tile-clock` in place; no other tile re-renders; no transition runs on per-event updates.
- [ ] Static tiles use the SPEC-CRWDQ-034 card primitive; their `FixtureListStore` subscriptions update status/time in place; the SPEC-CRWDQ-034 `data-status`, badge, logo, time-formatting rules apply unchanged.
- [ ] `FixtureList` re-push that flips a static tile's `status` to `live` updates the pill and `data-status` only; the tile is NOT auto-promoted to a live tile — promotion is backend-driven via `primary_game_id`.
- [ ] D-GRH-13 reconcile: revised `ProgramSlot` with the same `program_slot_id` may change `primary_game_id`; the old live tile demotes to a static card, the new promoted fixture's `<li>` re-mounts as `cdq-tile-live`; the old `GameStateStore` subscription is unsubscribed; dwell timer is NOT reset; journals `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id`.
- [ ] `GameState.status` flipping to `final` mid-slot freezes the score block and replaces LIVE with FINAL; the tile stays in the promoted cell (no auto-demote).
- [ ] Asset cache miss (team logo, sport badge) falls back to text-only per D-GRH-08; the live tile's score block still renders.
- [ ] Supersede: outgoing transition runs on the `<section>`; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile's `FixtureListStore` subscription is unsubscribed exactly once.
- [ ] The live tile renders ONLY score block + LIVE/FINAL pill — no `sport_context` header, no `last_moment` overlay; those belong to the full-surface SPEC-CRWDQ-023 path.
- [ ] Tests cover: happy mount, GameEvent in-place update, static-tile FixtureList re-push, invalid primary_game_id / empty fixture_ids / no-matching-fixture, reconcile-to-new-promoted-game, reconcile-same-promoted-with-fixture-changes, status-flip-to-final mid-slot, asset cache miss fallback, supersede unsubscribe.
- [ ] Tests use real `FixturesTemplate` and real `LiveFixtureTile` instances (INV-FACTORY-16); only the WS source, clock, transition timing, and journal sink are substituted (INV-FACTORY-17).
