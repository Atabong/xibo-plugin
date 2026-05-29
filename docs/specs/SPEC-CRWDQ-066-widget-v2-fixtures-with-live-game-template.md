---
spec_id: SPEC-CRWDQ-066
title: Widget v2 fixtures_with_live_game template
status: design-ready
owner: player-runtime/widget-v2/templates/mixed-state
depends_on: [SPEC-CRWDQ-023, SPEC-CRWDQ-034, SPEC-CRWDQ-064]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-066 — Widget v2 fixtures_with_live_game template

> **NOTE — backend integration dependency (non-blocking).** This template
> can be implemented and contract-tested against the SPEC-CRWDQ-017 wire
> types now. It cannot be E2E-verified (SPEC-CRWDQ-027 smoke) until the
> backend adds the `fixtures_with_live_game` mode + a producer for the
> dual-id `ProgramSlot` — see the backend-dependency note in OPEN QUESTION
> (1). The two consumed-side wire questions (fixture↔game identity, team
> identity) ARE resolved below.

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S6 — Fixtures mode (mixed-state extension); ranges into S7 — Mixed-state semantics |
| Plane epic | CRWDQ-7 |
| Decisions referenced | D-GRH-08, D-GRH-12, D-GRH-13, D-GRH-17, D-GRH-18, D-GRH-20, D-GRH-21, D-GRH-30, D-GRH-50, D-GRH-51, D-GRH-73 |
| Source files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts` (composed), `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` (re-used as inline live tile), `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `FixtureListStore.ts`, `GameStateStore.ts` (consumed); `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064) |
| New files | `modules/widget-v2/src/templates/mixed-state/FixturesWithLiveGameTemplate.ts`, `modules/widget-v2/src/templates/mixed-state/LiveFixtureTile.ts`, `modules/widget-v2/src/templates/mixed-state/fixtures-with-live-game.css`, `modules/widget-v2/tests/templates/mixed-state/*.test.ts` |

> **Backend authority note — backend integration dependency (non-blocking).**
> As of this writing `fixtures_with_live_game` is NOT yet a backend
> business mode. Verified against the `crowdaq-backend` source:
> `PlannedState.businessMode` (`src/scheduler/build/types.ts:159-166`) is
> a closed 8-member union — `single_game | multiple_games |
> multiple_games_with_ads | fixtures | fixtures_with_ads | recap |
> safe_info | ambient` — and `fixtures_with_live_game` is not among them.
> `selectMode` (`src/scheduler/build/mode-select.ts:39-44`) does not return
> it, and the dual-id `ProgramSlot` this template needs is not yet emitted
> by any builder (see OPEN QUESTION (1)). This template can still be
> implemented and contract-tested against the wire shape now; the backend
> mode + producer must land before it can be exercised at runtime / E2E.
> The `FixtureList` / `GameState` wire facts below are cross-checked
> against the backend source.

## Module

`player-runtime :: widget-v2 :: templates/mixed-state` — the `fixtures_with_live_game` business-mode template (one of the nine `business_mode` values in the closed SPEC-CRWDQ-011 / SPEC-CRWDQ-017 enum). Renders a pre-game fixture grid (SPEC-CRWDQ-034 shape) where exactly one fixture tile is promoted to a live game render (SPEC-CRWDQ-023 shape). The promoted tile is driven by `GameState` for the matching `game_id` and receives `GameEvent` deltas; the other tiles stay static fixture cards (`FixtureListStore`-driven).

This is the canonical "mixed-state" composite: the `fixtures_with_live_game` mode is what S7 ("mixed-state semantics") opens, and this spec is the player-side rendering of it.

> **OPEN QUESTION (1) — BACKEND DEPENDENCY (non-blocking):
> `fixtures_with_live_game` is not yet a backend mode and its `ProgramSlot`
> shape is not yet emitted (backend code cross-check).** Verified against
> the `crowdaq-backend` source:
>
> 1. `fixtures_with_live_game` is NOT a `PlannedState.businessMode` value.
>    The union is a closed 8-member set (`src/scheduler/build/types.ts:159-166`):
>    `single_game | multiple_games | multiple_games_with_ads | fixtures |
>    fixtures_with_ads | recap | safe_info | ambient`. `selectMode`
>    (`src/scheduler/build/mode-select.ts:39-44`) returns only
>    `single_game | multiple_games | fixtures | safe_info | ambient`. No
>    builder emits `fixtures_with_live_game`.
> 2. The `ProgramSlot` shape this template requires — a non-null
>    `primary_game_id` AND a non-empty `fixture_ids[]` *at the same time* —
>    is not produced by any current builder. `buildSingleGame`
>    (`single-game.ts:92-99`) and `buildMultiGame` (`multi-game.ts:121-128`)
>    set `fixtureIds: []`; `buildFixtures` (`fixtures.ts:115-122`) and
>    `buildFallback` (`fallback.ts:118-125`) set `primaryGameId: null`.
>    Every builder sets exactly one of the two — never both. No current
>    code path produces the dual-id slot.
>
> Resolution: implement this template against the SPEC-CRWDQ-017 wire
> contract now and contract-test it with the `ProgramSlot` / `GameState` /
> `FixtureList` inputs driven by a fixture; the backend producer must land
> before it can be exercised at runtime / E2E (SPEC-CRWDQ-027 smoke). That
> backend work is (a) a `fixtures_with_live_game` member on the
> `businessMode` union, (b) a `selectMode` branch that returns it, and
> (c) a builder that emits the combined-shape `ProgramSlot`. The design
> below is the shape to build against today.

> **OPEN QUESTION (2) — RESOLVED: fixture↔game identity is `event_id`
> (backend code cross-check).** A separate `Fixture.game_id` field is not
> needed. Verified against the `crowdaq-backend` source: `fixture_ids[]`
> entries are canonical `event_id`s (`buildFixtures`,
> `src/scheduler/build/fixtures.ts:75`, maps `FixtureRow.gameId`, which
> `types.ts:68-77` documents as the canonical `event_id`), and
> `GameStatePayload.game_id` (`src/wire/types.ts:135-145`) is likewise the
> canonical `event_id`. So a live game and its fixture share one
> identifier — the `event_id`. The promoted-fixture match is therefore a
> direct `fixtureId === primary_game_id` comparison against the
> `fixture_ids[]` list; the `FixtureListEntry` `eventId` is the same value
> again. No `game_id` field needs to be added to `FixtureListEntry`. (This
> resolution is consistent with SPEC-CRWDQ-034's resolved `fixture_ids`
> identity note.) This sub-question is closed; OPEN QUESTION (1) remains
> the blocker.

> **OPEN QUESTION (3) — RESOLVED: team identity comes from the
> `FixtureList`, not `GameState` (backend code cross-check).** Verified
> against the `crowdaq-backend` source: `GameStatePayload`
> (`src/wire/types.ts:135-145`) carries `game_id`, `sport`, `home_score`,
> `away_score`, `period`, `clock`, `signals`, `badges`, `sport_context` —
> and NO team identity (no `home_team_id` / `away_team_id`, no team
> names). Team **names** come only from the fixture record — the domain
> `FixtureListEntry` `homeTeam` / `awayTeam`
> (`src/domain/fixtures/fixture-list-projection.ts:29-38`). The live tile
> already has the matching `fixture` in `LiveFixtureTileContext` (it is
> the promoted fixture), so the tile shall read team **names** from
> `fixture.homeTeam` / `fixture.awayTeam`. No player-facing wire payload
> carries a `team_id`, so per-team logos keyed by `team_id` cannot be
> resolved — the live tile renders team **names** (text), not logos. (Same
> resolution as SPEC-CRWDQ-046.) This sub-question is closed; OPEN
> QUESTION (1) remains the blocker.

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

export interface FixturesWithLiveGameInstance extends TemplateInstance {
  detach(): HTMLElement;
  /**
   * Implements the shared TemplateInstance.reconcile? hook (canonical
   * signature owned by SPEC-CRWDQ-023). On a 'program_slot' variant the
   * D-GRH-13 reconcile path runs: the promoted game_id may change (the
   * game ended; the backend re-promotes another live fixture) without a
   * slot supersede; the old live tile demotes to a static card, the new
   * promoted fixture's <li> re-mounts as cdq-tile-live. Resolves when
   * the tile swap and any static add/remove have settled. 'ad_slot' is
   * a no-op (this template carries no ad_slot_id). 'game_state_revision'
   * is a no-op (the LiveFixtureTile already reacts via its
   * GameStateStore subscription).
   */
  reconcile(event: TemplateReconcileEvent): Promise<void>;
}
```

`TemplateInstance` and `TemplateReconcileEvent` are declared by SPEC-CRWDQ-023 (§ Reconcile dispatch) and consumed here verbatim.

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
        <span class="cdq-tile-home"><span class="cdq-team-name">HOME TEAM NAME</span><span class="cdq-tile-home-score">0</span></span>
        <span class="cdq-tile-clock">Q3 8:12</span>
        <span class="cdq-tile-away"><span class="cdq-tile-away-score">0</span><span class="cdq-team-name">AWAY TEAM NAME</span></span>
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
2. **Identify the promoted fixture.** Find the `fixture_id` in `fixture_ids[]` equal to `programSlot.primary_game_id` — both are canonical `event_id`s (OPEN QUESTION (2), resolved), so the match is a direct string comparison; no `Fixture.game_id` field is involved. If no `fixture_id` matches (a backend authoring error — the live game must correspond to one of the listed fixtures), journal `template_input_invalid` and escalate to safe.
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

- Reads `GameState.home_score`, `GameState.away_score`, `GameState.clock`, `GameState.period` — the flat top-level fields of `GameStatePayload` (`crowdaq-backend` `src/wire/types.ts:135-145`; NOT nested `home.score` objects).
- Renders home + away team **names** as text, read from `ctx.fixture.homeTeam` / `ctx.fixture.awayTeam` (the promoted fixture's `FixtureListEntry`). `GameState` carries no team identity and no player-facing wire payload carries a `team_id` (OPEN QUESTION (3), resolved), so per-team logos cannot be resolved — the tile renders team names only.
- Initial DOM populated from the current `GameStateStore.get(primary_game_id)` snapshot. Per D-GRH-21 + the SPEC-CRWDQ-023 ordering rule, by the time `PlannedState{fixtures_with_live_game}` arrives, the backend has already pushed `GameState` for `primary_game_id` over the game-data channel.
- Subsequent `GameEvent` deltas mutate the score/clock/period text nodes in place. No transition runs on per-event updates.
- The tile does NOT render `sport_context` (no period_clock overlay, no venue badge) — those are full-surface-only.
- The tile does NOT render `last_moment` — full-surface-only.

### Reconcile

The `primary_game_id` can change mid-slot (D-GRH-13) when:
- The current promoted game ends and the backend rotates to another live fixture in the same set.
- The backend reorders `fixture_ids` or swaps `primary_game_id`.

`reconcile({ kind: 'program_slot', slot: newSlot })`:
1. Find the new promoted fixture: locate the `fixture_id` equal to `newSlot.primary_game_id` in `newSlot.fixture_ids` (a direct `event_id` string match — OPEN QUESTION (2), resolved).
2. If the new promoted fixture is the same as the current → no structural change; the existing `LiveFixtureTile`'s `GameStateStore` subscription is already on the right `game_id`. Continue.
3. If the new promoted fixture is different:
   - Unsubscribe the old `LiveFixtureTile` (detach, no transition — a small cross-fade only).
   - Find the new promoted fixture's `<li>` in the rendered list.
   - Replace its inner content with a `LiveFixtureTile` mount.
   - The OLD promoted slot demotes to a static fixture: render the SPEC-CRWDQ-034 static card content in its `<li>` (its status may now be `final`).
4. If `fixture_ids` changed (added/removed entries), apply SPEC-CRWDQ-034's reconcile path to the static portion.
5. The dwell timer is NOT reset (D-GRH-13: a card change is not a slot change).
6. Journal `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id` (or `null` if no demote).

Resolution: SPEC-CRWDQ-023 § Reconcile dispatch now declares the canonical optional `reconcile?(event: TemplateReconcileEvent)` hook and dispatch invariants on the shared `TemplateInstance` contract; `FixturesWithLiveGameInstance` implements it. This is the same cross-spec resolution that lands for SPEC-CRWDQ-031, -034, -041, and -065. The backend dependency in OPEN QUESTION (1) — the missing `fixtures_with_live_game` backend producer — remains a non-blocking integration gate: implement against the wire contract now; the backend producer must land before runtime/E2E.

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

- **Happy mount.** `programSlot = { fixture_ids: [fA, fB, fC], primary_game_id: fA }` (the promoted `fixture_id` equals `primary_game_id`, both the `event_id` `fA`); `fA.feedStatus: live`; `fB, fC: scheduled`. Pre-seed `GameStateStore.get(fA) = { home_score: 14, away_score: 7, period: "Q3", clock: "8:12" }`. Mount. Assert: `<li data-fixture-id="fA" data-status="live" data-game-id="fA" class="cdq-fixture-card cdq-tile-live">` is present; `.cdq-tile-home-score` = "14", `.cdq-tile-away-score` = "7"; team names from the fixture record; LIVE pill on fA only; fB and fC are static fixture cards with bar-local times.
- **GameEvent updates the live tile in place.** Mount as above; send a `GameEvent` for `fA` raising `home_score` to 21. Assert: `.cdq-tile-home-score` mutates to "21"; no other tile re-renders; no transition runs.
- **FixtureList re-push updates a static tile.** Mount as above; re-push `FixtureList` with `fB.feedStatus: "live"`. Assert: fB's `data-status` flips to `"live"`, the LIVE pill renders; fB does NOT auto-promote to a live tile (the `<li>` still uses the static-card layout, no `cdq-tile-live` class).
- **primary_game_id not in any fixture.** `programSlot = { fixture_ids: [fA, fB], primary_game_id: e_GHOST }` (an `event_id` absent from `fixture_ids`). Assert: journal `template_input_invalid`; no mount; escalate to safe.
- **primary_game_id null.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Empty fixture_ids.** Constraint violation. Assert: journal `template_input_invalid`; no mount.
- **Reconcile to a new promoted game.** Mount with promoted = fA. Send a revised `ProgramSlot` (same `program_slot_id`) with `primary_game_id: fB` (the `event_id` of the fB fixture). Assert: the fA tile demotes to a static card (now rendering `fA.feedStatus`, e.g. `final`); the fB tile promotes to `cdq-tile-live` with `data-game-id="fB"`; the old `GameStateStore` subscription for fA is unsubscribed; a new subscription on fB; the dwell timer is NOT reset; journal `live_tile_reconciled` with the right payload.
- **Reconcile: same promoted game, fixture_ids changed.** Same `primary_game_id`, `fD` added and `fC` removed. Assert: no structural change to the live tile; the SPEC-CRWDQ-034 reconcile path runs for the static portion.
- **GameState status → final mid-slot.** Mount with fA live. Send a `GameEvent` flipping `fA`'s game to `status = "final"`. Assert: the tile pill changes from LIVE to FINAL; the score block freezes; the tile stays in the promoted cell (no auto-demote).
- **Sport-badge cache miss.** `assetManifestStore.get(<sport/league badge id>)` returns null. Assert: the badge falls back to league-name text per D-GRH-08; the tile still renders the score. (There is no per-team logo to miss — the live tile renders team names only.)
- **Supersede.** Send a new `PlannedState` (different `state_id`). Assert: the outgoing transition runs on the section; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile unsubscribes from `FixtureListStore`.

## Vocabulary

- `fixtures_with_live_game` — not yet a backend `business_mode` value (the backend union is currently a closed 8-member set; verified `crowdaq-backend` `src/scheduler/build/types.ts:159-166`). No backend producer exists yet — implement against the wire contract now; the backend mode + producer must land before runtime/E2E. See OPEN QUESTION (1).
- `primary_game_id`, `fixture_ids[]` — D-GRH-21 `ProgramSlot` fields. Both `primary_game_id` and each `fixture_ids[]` entry are canonical `event_id`s; a live game and its fixture share that one identifier.
- "promoted tile", "demote" — internal terms defined in this spec.

## Acceptance Criteria

- [ ] `FixturesWithLiveGameTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures-with-live-game">` with a `.cdq-fixture-list` containing one `<li class="cdq-fixture-card cdq-tile-live" data-game-id>` for the promoted fixture and a SPEC-CRWDQ-034 static card for each remaining `fixture_id`.
- [ ] `PlannedStateActivator` dispatches `business_mode: "fixtures_with_live_game"` to this template; activation reuses `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`.
- [ ] Promoted-fixture identification matches a `fixture_id` in `fixture_ids[]` equal to `programSlot.primary_game_id` (both canonical `event_id`s — a direct string match); if no `fixture_id` matches, the template journals `template_input_invalid` and escalates to safe.
- [ ] Constraint violations (`primary_game_id == null`, `fixture_ids.length === 0`) journal `template_input_invalid` and do not mount.
- [ ] The live tile subscribes to `GameStateStore.subscribe(primary_game_id, ...)`; `GameEvent` deltas mutate `.cdq-tile-home-score`, `.cdq-tile-away-score`, `.cdq-tile-clock` in place; no other tile re-renders; no transition runs on per-event updates.
- [ ] Static tiles use the SPEC-CRWDQ-034 card primitive; their `FixtureListStore` subscriptions update status/time in place; the SPEC-CRWDQ-034 `data-status`, badge, logo, and time-formatting rules apply unchanged.
- [ ] A `FixtureList` re-push that flips a static tile's `feedStatus` to `live` updates the pill and `data-status` only; the tile is NOT auto-promoted to a live tile — promotion is backend-driven via `primary_game_id`.
- [ ] `FixturesWithLiveGameInstance` implements the shared `TemplateInstance.reconcile?(event: TemplateReconcileEvent)` hook owned by SPEC-CRWDQ-023. On `{ kind: 'program_slot', slot }` the D-GRH-13 reconcile runs: a revised `ProgramSlot` with the same `program_slot_id` may change `primary_game_id`; the old live tile demotes to a static card, the new promoted fixture's `<li>` re-mounts as `cdq-tile-live`; the old `GameStateStore` subscription is unsubscribed; the dwell timer is NOT reset; journals `live_tile_reconciled` with `previous_game_id`, `new_game_id`, `demoted_fixture_id`. The `ad_slot` and `game_state_revision` variants are no-ops.
- [ ] `GameState.status` flipping to `final` mid-slot freezes the score block and replaces LIVE with FINAL; the tile stays in the promoted cell (no auto-demote).
- [ ] The live tile renders team names as text from the promoted fixture's `FixtureListEntry` (`GameState` carries no team identity, no wire payload carries a `team_id`); a sport-badge asset cache miss falls back to league-name text per D-GRH-08, and the live tile's score block still renders.
- [ ] Supersede: the outgoing transition runs on the `<section>`; `LiveFixtureTile.detach()` unsubscribes from `GameStateStore`; every static tile's `FixtureListStore` subscription is unsubscribed exactly once.
- [ ] The live tile renders ONLY a score block + LIVE/FINAL pill — no `sport_context` header, no `last_moment` overlay; those belong to the full-surface SPEC-CRWDQ-023 path.
- [ ] `ctx.theme` is the SPEC-CRWDQ-023 three-state `ResolvedTheme`.
- [ ] Tests cover: happy mount, GameEvent in-place update, static-tile FixtureList re-push, invalid primary_game_id / empty fixture_ids / no-matching-fixture, reconcile-to-new-promoted-game, reconcile-same-promoted-with-fixture-changes, status-flip-to-final mid-slot, sport-badge cache miss fallback, supersede unsubscribe.
- [ ] Tests use real `FixturesTemplate` and real `LiveFixtureTile` instances (INV-FACTORY-16); only the WS source, clock, transition timing, and journal sink are substituted (INV-FACTORY-17).
