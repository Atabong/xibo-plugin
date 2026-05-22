---
spec_id: SPEC-CRWDQ-066
title: Widget v2 fixtures_with_live_game template
status: draft
owner: player-runtime/widget-v2/templates/mixed-state
depends_on: [SPEC-CRWDQ-023, SPEC-CRWDQ-034, SPEC-CRWDQ-064]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-066 — Widget v2 fixtures_with_live_game template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S6 — Fixtures mode (mixed-state extension); ranges into S7 — Mixed-state semantics |
| Plane epic | CRWDQ-7 |
| Decisions referenced | D-GRH-08, D-GRH-12, D-GRH-13, D-GRH-17, D-GRH-18, D-GRH-20, D-GRH-21, D-GRH-30, D-GRH-50, D-GRH-51, D-GRH-73 |
| Source files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts` (composed), `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` (re-used as inline live tile), `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `FixtureListStore.ts`, `GameStateStore.ts` (consumed); `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064) |
| New files | `modules/widget-v2/src/templates/mixed-state/FixturesWithLiveGameTemplate.ts`, `modules/widget-v2/src/templates/mixed-state/LiveFixtureTile.ts`, `modules/widget-v2/src/templates/mixed-state/fixtures-with-live-game.css`, `modules/widget-v2/tests/templates/mixed-state/*.test.ts` |

> **Backend authority note:** `fixtures_with_live_game` is a valid member
> of the closed 9-member `BusinessMode` enum (confirmed in
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-011`). The `FixtureList` and
> `GameState` wire shapes this template consumes are governed by
> `SPEC-CRWDQ-032` and `SPEC-CRWDQ-017`. Every claim below about field
> shapes is cross-checked against those specs. See the OPEN QUESTIONS
> below for two consumed-side wire gaps and one backend-producer gap that
> the backend specs do not currently resolve.

## Module

`player-runtime :: widget-v2 :: templates/mixed-state` — the `fixtures_with_live_game` business-mode template (one of the nine `business_mode` values in the closed SPEC-CRWDQ-011 / SPEC-CRWDQ-017 enum). Renders a pre-game fixture grid (SPEC-CRWDQ-034 shape) where exactly one fixture tile is promoted to a live game render (SPEC-CRWDQ-023 shape). The promoted tile is driven by `GameState` for the matching `game_id` and receives `GameEvent` deltas; the other tiles stay static fixture cards (`FixtureListStore`-driven).

This is the canonical "mixed-state" composite: the `fixtures_with_live_game` mode is what S7 ("mixed-state semantics") opens, and this spec is the player-side rendering of it.

> **OPEN QUESTION — no backend producer for `fixtures_with_live_game`.**
> `fixtures_with_live_game` is a valid `BusinessMode` enum member
> (SPEC-CRWDQ-011), but NO backend spec currently *emits* a
> `fixtures_with_live_game` `PlannedState`. SPEC-CRWDQ-019 produces
> `single_game`, SPEC-CRWDQ-030 `multiple_games`, SPEC-CRWDQ-033
> `fixtures`, SPEC-CRWDQ-051 `safe_info`/`ambient`, SPEC-CRWDQ-039 the
> `_with_ads` composites. None produce `fixtures_with_live_game`. Worse,
> the `ProgramSlot` shape this template requires — a non-null
> `primary_game_id` AND a non-empty `fixture_ids[]` — is never produced
> together by any current backend build path: SPEC-CRWDQ-033's
> `buildFixtures` always sets `primary_game_id: null`, and
> SPEC-CRWDQ-019/-030 always set `fixture_ids: []`. A backend spec that
> emits `fixtures_with_live_game` (with the combined `ProgramSlot` shape)
> must be authored before this template has anything to render. Confirm
> the backend producer + the exact `ProgramSlot` shape with the backend
> owner; this spec assumes the shape described in `FixturesWithLiveGameContext`.

> **OPEN QUESTION — `Fixture.game_id` is not on the wire.** Promoted-fixture
> identification matches `fixture.game_id === programSlot.primary_game_id`.
> D-GRH-20 is cited as the `FixtureList` entry "gaining a `game_id` field",
> but SPEC-CRWDQ-032's `FixtureListEntry` is `{ eventId, sport, leagueId,
> leagueName, homeTeam, awayTeam, kickoffUtc, feedStatus }` — it has NO
> `game_id`. (This compounds the `fixture_ids` member-identity ambiguity
> already flagged by SPEC-CRWDQ-034: SPEC-CRWDQ-033 sets `fixture_ids` from
> `FixtureRow.gameId` while SPEC-CRWDQ-032 keys the `FixtureList` on
> `event_id`.) `fixtures_with_live_game` is unbuildable without a way to
> map a fixture to its `game_id`: SPEC-CRWDQ-032's `FixtureListEntry` MUST
> add `game_id` (the D-GRH-20 mandate). This spec reads `Fixture.game_id`
> on that assumption; confirm with the backend owner.

> **OPEN QUESTION — team identity on `GameState`.** The live tile renders
> team logos by `team_id`. D-GRH-08 states "`GameState` references
> `team_id`", but SPEC-CRWDQ-017's `GameStatePayload` field list omits
> `home_team_id` / `away_team_id`. This spec reads
> `gameState.home_team_id` / `away_team_id` on the assumption SPEC-CRWDQ-017
> is amended — the same gap flagged by SPEC-CRWDQ-046. Team display name +
> logo are `AssetManifest`-delivered assets keyed by `team_id` (D-GRH-08).
> Confirm with the backend owner.

## Current shape

- SPEC-CRWDQ-034 renders pure fixture cards with no live game data — it explicitly notes "Live-score rendering is the job of `fixtures_with_live_game` (SPEC-CRWDQ-066)". This spec is that template.
- SPEC-CRWDQ-023 renders `single_game` standalone (full-surface). The `LiveFixtureTile` introduced here adapts the `SingleGameTemplate` to a constrained tile-sized container — the tile is a smaller render of the same `GameStateStore`-driven content, with the score block as the primary affordance.
- D-GRH-21 establishes `ProgramSlot.game_ids[]` as the ordered list of games referenced by a slot. For `fixtures_with_live_game`, the live game's `game_id` is `primary_game_id`. The remaining tiles correspond to `ProgramSlot.fixture_ids[]` (the static fixtures).
- D-GRH-18 establishes `FixtureList` as a wire frame. The same store SPEC-CRWDQ-034 already consumes covers the static tiles here.
- D-GRH-12's "single multiplexed stream" guarantees that `GameState` for the promoted tile arrives over the same WS the dispatcher already routes — no new transport.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/mixed-state/FixturesWithLiveGameTemplate.ts
export interface FixturesWithLiveGameTemplate {
  mount(host: HTMLElement, ctx: FixturesWithLiveGameContext): FixturesWithLiveGameInstance;
}

export interface FixturesWithLiveGameContext {
  /**
   * ProgramSlot carries BOTH a non-empty fixture_ids[] AND a non-null
   * primary_game_id. The fixture matching primary_game_id is the
   * promoted live tile; the remaining fixture_ids render static.
   * Backend authoring is assumed to guarantee primary_game_id
   * corresponds to one of the fixtures in the slot (matched via
   * fixture.game_id === primary_game_id, per D-GRH-20). See the
   * no-backend-producer OPEN QUESTION — this ProgramSlot shape is not
   * yet emitted by any backend build path.
   */
  programSlot: ProgramSlotPayload;
  /** SPEC-CRWDQ-023 three-state resolved theme (set/default/unset). */
  theme: ResolvedTheme;
  timezone: string;
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  gameStateStore: GameStateStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesWithLiveGameInstance {
  detach(): HTMLElement;
  /**
   * D-GRH-13 reconcile path: the promoted game_id may change (the game
   * ended; the backend re-promotes another live fixture) without a slot
   * supersede. Resolves when the tile swap and any static add/remove
   * have settled.
   */
  reconcile(newSlot: ProgramSlotPayload): Promise<void>;
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

`ResolvedTheme`, `PendingPreferenceApply`, `ProgramSlotPayload`, `Fixture`, and the `PlannedStateActivator` / `ProgramSlotResolver` / `FixtureListStore` / `GameStateStore` interfaces are defined by SPEC-CRWDQ-023 / -034 and consumed verbatim. `AssetManifestStore` is owned by SPEC-CRWDQ-064.

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

For a `PlannedStateFrame` whose `payload.business_mode === "fixtures_with_live_game"` and `payload.program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Shared `ProgramSlotResolver`. The activator buffers the `PlannedStateFrame` until `X` resolves (the SPEC-CRWDQ-023 buffer-with-5s-timeout path). `programSlot.fixture_ids[]` MUST be non-empty AND `programSlot.primary_game_id` MUST be non-null. Either constraint violation → journal `template_input_invalid` and escalate to safe (via `SafeStateController.escalateFromTemplate`, SPEC-CRWDQ-052 Path C).
2. **Identify the promoted fixture.** Find the `fixture` in `fixture_ids` such that `FixtureListStore.resolve(fixture_id).game_id === programSlot.primary_game_id` (`Fixture.game_id` — see the OPEN QUESTION; D-GRH-20 mandates it on the `FixtureList` entry). If no fixture matches (a backend authoring error — the live game must correspond to one of the listed fixtures), journal `template_input_invalid` and escalate to safe.
3. **Resolve fixtures.** For each `fixture_id`, `FixtureListStore.resolve(fixture_id)`. The same cache-miss handling as SPEC-CRWDQ-034 (placeholder card, journal `fixture_cache_miss`).
4. **Resolve assets.** Same path as SPEC-CRWDQ-034 (sport badges, team logos).
5. **Format times** for the STATIC tiles only. The promoted tile shows a score block, not a `kickoffUtc` time. The same formatter rules as SPEC-CRWDQ-034.
6. **Run transition.** `TransitionExecutor.run(plannedState.payload.transition, host)` — the wire catalog-name string; a catalog miss falls back per the SPEC-CRWDQ-023 `TransitionExecutor` contract. (The exact backend-authored `transition` value is not pinned — no backend producer exists yet; the template runs whatever is on the wire.)
7. **Mount the section + list.** For each fixture in order:
   - If `fixture_id === promotedFixtureId`: mount `LiveFixtureTile.mount(tileHost, { gameId: primary_game_id, fixture, gameStateStore, assetManifestStore })`. The tile subscribes to `GameStateStore.subscribe(primary_game_id, listener)`.
   - Else: mount a SPEC-CRWDQ-034 static fixture card (reuse the existing card-rendering primitive from SPEC-CRWDQ-034).
8. **Apply pending preferences** + **Arm dwell.** The same shared SPEC-CRWDQ-023 boundaries.

### Live tile rendering

The `LiveFixtureTile` is a small, focused render:

- Reads `GameState.home_score`, `GameState.away_score`, `GameState.clock`, `GameState.period` — the flat top-level fields of SPEC-CRWDQ-017's `GameStatePayload` (NOT nested `home.score` objects).
- Renders home + away team logos via `AssetManifestStore.get("team:" + team_id)`, where the `team_id`s come from `GameState.home_team_id` / `GameState.away_team_id` (see the team-identity OPEN QUESTION — SPEC-CRWDQ-017's `GameStatePayload` does not yet list these fields). Team display name + logo are `AssetManifest`-delivered assets (D-GRH-08), not wire fields.
- Initial DOM populated from the current `GameStateStore.get(primary_game_id)` snapshot. Per D-GRH-21 + the SPEC-CRWDQ-023 ordering rule, by the time `PlannedState{fixtures_with_live_game}` arrives, the backend has already pushed `GameState` for `primary_game_id` over the game-data channel.
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
   - Unsubscribe the old `LiveFixtureTile` (detach, no transition — a small cross-fade only).
   - Find the new promoted fixture's `<li>` in the rendered list.
   - Replace its inner content with a `LiveFixtureTile` mount.
   - The OLD promoted slot demotes to a static fixture: render the SPEC-CRWDQ-034 static card content in its `<li>` (its status may now be `final`).
4. If `fixture_ids` changed (added/removed entries), apply SPEC-CRWDQ-034's reconcile path to the static portion.
5. The dwell timer is NOT reset (D-GRH-13: a card change is not a slot change).
6. Journal `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id` (or `null` if no demote).

> **OPEN QUESTION — `reconcile?` dispatch hook.** The active-slot `reconcile`
> dispatch this template relies on requires SPEC-CRWDQ-023 to declare an
> optional `reconcile?(slot)` member on its template-instance contract,
> which it does not currently do. This is the same cross-spec coordination
> gap flagged by SPEC-CRWDQ-031, -034, and -041; it must be agreed with the
> SPEC-CRWDQ-023 owner before these specs are implemented.

### Status flip mid-slot (live → final)

If the promoted game's `GameState.status` transitions to `final` via a `GameEvent`, the tile's score block freezes on the final values and the LIVE pill is replaced by `FINAL`. The tile remains the visually promoted cell until the next `PlannedState` arrives — the player does NOT auto-demote on a status change. Status semantics belong to the backend, which will rotate the slot via a new `PlannedState` or update `ProgramSlot.primary_game_id`.

### Fixture frame edits mid-slot

If `FixtureList` re-pushes change a static tile's `feedStatus` (`scheduled` → `live`), the static tile updates its pill and `data-status` attribute. It does NOT auto-promote to a live tile — promotion is backend-driven via `primary_game_id`.

### Supersede

The standard SPEC-CRWDQ-023 supersede path: outgoing transition, detach, new activation. `detach()` unsubscribes the `LiveFixtureTile`'s `GameStateStore` subscription AND every static tile's `FixtureListStore` subscription.

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

- **Happy mount.** `programSlot = { fixture_ids: [fA, fB, fC], primary_game_id: G1 }`; `fA.game_id === G1, feedStatus: live`; `fB, fC: scheduled`. Pre-seed `GameStateStore.get(G1) = { home_score: 14, away_score: 7, period: "Q3", clock: "8:12" }`. Mount. Assert: `<li data-fixture-id="fA" data-status="live" data-game-id="G1" class="cdq-fixture-card cdq-tile-live">` is present; `.cdq-tile-home-score` = "14", `.cdq-tile-away-score` = "7"; LIVE pill on fA only; fB and fC are static fixture cards with bar-local times.
- **GameEvent updates the live tile in place.** Mount as above; send a `GameEvent` for G1 raising `home_score` to 21. Assert: `.cdq-tile-home-score` mutates to "21"; no other tile re-renders; no transition runs.
- **FixtureList re-push updates a static tile.** Mount as above; re-push `FixtureList` with `fB.feedStatus: "live"`. Assert: fB's `data-status` flips to `"live"`, the LIVE pill renders; fB does NOT auto-promote to a live tile (the `<li>` still uses the static-card layout, no `cdq-tile-live` class).
- **primary_game_id not in any fixture.** `programSlot = { fixture_ids: [fA, fB], primary_game_id: G_GHOST }`. Assert: journal `template_input_invalid`; no mount; escalate to safe.
- **primary_game_id null.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Empty fixture_ids.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Reconcile to a new promoted game.** Mount with promoted = fA/G1. Send a revised `ProgramSlot` (same `program_slot_id`) with `primary_game_id: G2` where `fB.game_id === G2`. Assert: the fA tile demotes to a static card (now rendering `fA.feedStatus`, e.g. `final`); the fB tile promotes to `cdq-tile-live` with `data-game-id="G2"`; the old `GameStateStore` subscription for G1 is unsubscribed; a new subscription on G2; the dwell timer is NOT reset; journal `live_tile_reconciled` with the right payload.
- **Reconcile: same promoted game, fixture_ids changed.** Same `primary_game_id`, `fD` added and `fC` removed. Assert: no structural change to the live tile; the SPEC-CRWDQ-034 reconcile path runs for the static portion.
- **GameState status → final mid-slot.** Mount with G1 live. Send a `GameEvent` flipping `G1.status = "final"`. Assert: the tile pill changes from LIVE to FINAL; the score block freezes; the tile stays in the promoted cell (no auto-demote).
- **Asset cache miss for a team logo (live tile).** `assetManifestStore.get("team:" + home_team_id)` returns null. Assert: a text-only team-name fallback per D-GRH-08; the tile still renders the score.
- **Supersede.** Send a new `PlannedState` (different `state_id`). Assert: the outgoing transition runs on the section; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile unsubscribes from `FixtureListStore`.

## Vocabulary

- `fixtures_with_live_game` — a `business_mode` value in the closed 9-member enum (SPEC-CRWDQ-011 / SPEC-CRWDQ-017). No backend producer exists yet — see the OPEN QUESTION.
- `primary_game_id`, `fixture_ids[]` — D-GRH-21 `ProgramSlot` fields.
- `Fixture.game_id` — the assumed `FixtureList` entry field needed to map a fixture to its live game (D-GRH-20; not yet on the wire — see the OPEN QUESTION).
- "promoted tile", "demote" — internal terms defined in this spec.

## Acceptance Criteria

- [ ] `FixturesWithLiveGameTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures-with-live-game">` with a `.cdq-fixture-list` containing one `<li class="cdq-fixture-card cdq-tile-live" data-game-id>` for the promoted fixture and a SPEC-CRWDQ-034 static card for each remaining `fixture_id`.
- [ ] `PlannedStateActivator` dispatches `business_mode: "fixtures_with_live_game"` to this template; activation reuses `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`.
- [ ] Promoted-fixture identification matches `fixture.game_id === programSlot.primary_game_id`; if no fixture matches, the template journals `template_input_invalid` and escalates to safe.
- [ ] Constraint violations (`primary_game_id == null`, `fixture_ids.length === 0`) journal `template_input_invalid` and do not mount.
- [ ] The live tile subscribes to `GameStateStore.subscribe(primary_game_id, ...)`; `GameEvent` deltas mutate `.cdq-tile-home-score`, `.cdq-tile-away-score`, `.cdq-tile-clock` in place; no other tile re-renders; no transition runs on per-event updates.
- [ ] Static tiles use the SPEC-CRWDQ-034 card primitive; their `FixtureListStore` subscriptions update status/time in place; the SPEC-CRWDQ-034 `data-status`, badge, logo, and time-formatting rules apply unchanged.
- [ ] A `FixtureList` re-push that flips a static tile's `feedStatus` to `live` updates the pill and `data-status` only; the tile is NOT auto-promoted to a live tile — promotion is backend-driven via `primary_game_id`.
- [ ] D-GRH-13 reconcile: a revised `ProgramSlot` with the same `program_slot_id` may change `primary_game_id`; the old live tile demotes to a static card, the new promoted fixture's `<li>` re-mounts as `cdq-tile-live`; the old `GameStateStore` subscription is unsubscribed; the dwell timer is NOT reset; journals `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id`.
- [ ] `GameState.status` flipping to `final` mid-slot freezes the score block and replaces LIVE with FINAL; the tile stays in the promoted cell (no auto-demote).
- [ ] An asset cache miss (team logo, sport badge) falls back to text-only per D-GRH-08; the live tile's score block still renders.
- [ ] Supersede: the outgoing transition runs on the `<section>`; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile's `FixtureListStore` subscription is unsubscribed exactly once.
- [ ] The live tile renders ONLY a score block + LIVE/FINAL pill — no `sport_context` header, no `last_moment` overlay; those belong to the full-surface SPEC-CRWDQ-023 path.
- [ ] `ctx.theme` is the SPEC-CRWDQ-023 three-state `ResolvedTheme`.
- [ ] Tests cover: happy mount, GameEvent in-place update, static-tile FixtureList re-push, invalid primary_game_id / empty fixture_ids / no-matching-fixture, reconcile-to-new-promoted-game, reconcile-same-promoted-with-fixture-changes, status-flip-to-final mid-slot, asset cache miss fallback, supersede unsubscribe.
- [ ] Tests use real `FixturesTemplate` and real `LiveFixtureTile` instances (INV-FACTORY-16); only the WS source, clock, transition timing, and journal sink are substituted (INV-FACTORY-17).
