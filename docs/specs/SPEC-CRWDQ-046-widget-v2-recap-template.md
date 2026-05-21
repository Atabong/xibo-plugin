---
spec_id: SPEC-CRWDQ-046
title: Widget v2 recap render template
status: draft
owner: player-runtime/widget-v2/templates/recap
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-023, SPEC-CRWDQ-064]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-046 — Widget v2 recap render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S9 — Post-game recap |
| Plane epic | CRWDQ-10 |
| Decisions referenced | D-GRH-21, D-GRH-25, D-GRH-29, D-GRH-30, D-GRH-50, D-GRH-68 |
| Source files | `modules/widget-v2/src/render/GameStateStore.ts`, `PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed from SPEC-CRWDQ-023); `AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064) |
| New files | `modules/widget-v2/src/templates/recap/RecapTemplate.ts`, `modules/widget-v2/src/templates/recap/recap.html`, `modules/widget-v2/src/templates/recap/recap.css`, `modules/widget-v2/tests/templates/recap/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/recap` — the `recap` business-mode template (D-GRH-68: post-game recap is mode #X, where X = `recap`, a normal `business_mode` not an interrupt class). Renders final score + headline moment(s) + winner highlight from the player's existing `GameState[game_id]` — no inlined recap content in the wire frame, per D-GRH-68. Honors transition + `dwell_target_ms` like every other slot. Falls back gracefully if recap-relevant data is unavailable.

## Current shape

- No recap rendering in v1.
- D-GRH-68 finalized recap as a normal `business_mode = "recap"` value rather than a separate "post-game recap layer" or `interrupt_class`. The recap `PlannedState` reuses the same `program_slot_id` that drove the preceding live-game slot, so the template resolves `primary_game_id` from the existing in-memory `ProgramSlot` (D-GRH-21).
- By the time a recap slot becomes active, the backend has already pushed `GameState` with `status: "final"` for the game. The recap template reads `final_score`, `winner` (derivable from scores), and headline moments from the player's existing in-memory state. There's no separate recap content frame.

> **Dependencies.** Built on the shared render orchestration of **SPEC-CRWDQ-023** (`GameStateStore`, `PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`) and the asset cache of **SPEC-CRWDQ-064** (`AssetManifestStore`, for team name/logo) — both hard build dependencies in `depends_on`. **SPEC-CRWDQ-045** (`BarPlayerSchedulerService` recap-window calculator + recap `PlannedState` emitter) is the cross-repo `crowdaq-backend` *producer* of the recap `PlannedState`s this template consumes — a wire-contract counterpart, not a build dependency, so it is not in `depends_on`.

> **Open contract gaps (consumed-side).** This template reads two things the SPEC-CRWDQ-017 wire types do not currently carry:
> 1. **Team identity.** The recap renders team names + logos, which require a team identifier. D-GRH-08 states *"`GameState` references `team_id`"*, but SPEC-CRWDQ-017's `GameStatePayload` field list omits `home_team_id` / `away_team_id`. This spec consumes `gameState.home_team_id` / `gameState.away_team_id` on the assumption that SPEC-CRWDQ-017 is amended to list them (a D-GRH-08 mandate). Team display name + logo are resolved from `AssetManifestStore` by `team_id` (D-GRH-08 — team name/logo/colors are AssetManifest-delivered assets, not wire fields).
> 2. **Headline-moment history.** SPEC-CRWDQ-017's `GameStatePayload` has no `events` array. The recap's headline moments are read from a bounded per-game significant-`GameEvent` history that `GameStateStore` accumulates during the live game — this requires SPEC-CRWDQ-023's `GameStateStore` to expose a `significantEvents(gameId)` accessor (SPEC-CRWDQ-023 follow-up).

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/recap/RecapTemplate.ts
export interface RecapTemplate {
  mount(host: HTMLElement, context: RecapContext): RecapInstance;
}

export interface RecapContext {
  programSlot: ProgramSlot;        // same slot as the preceding live-game slot; primary_game_id is the recap target
  themeId: string | null;
  gameStateStore: GameStateStore;
  assetManifestStore: AssetManifestStore;  // SPEC-CRWDQ-064 — team name/logo resolution
  pendingApply: PendingPreferenceApply | null;
}

export interface RecapInstance {
  detach(): HTMLElement;
}
```

The template does NOT subscribe to `GameStateStore` per-event updates — recap is a frozen-final snapshot. It reads `GameState` once at mount, then runs out the dwell on a static composition. Late `GameEvent` deltas for the same `game_id` (rare — a final-score correction) are journaled but do NOT re-render the recap.

### DOM shape

```
<section class="crowdaq-recap" data-theme data-game-id data-winner="home|away|draw">
  <header class="cdq-recap-header">
    <span class="cdq-recap-label">FULL TIME</span>
    <span class="cdq-sport-context"><!-- sport, league badge --></span>
  </header>
  <div class="cdq-final-score">
    <div class="cdq-team cdq-team-home" data-team-id>
      <img class="cdq-team-logo" alt="" src="..." />
      <span class="cdq-team-name">HOME</span>
      <span class="cdq-team-score">N</span>
    </div>
    <div class="cdq-team cdq-team-away" data-team-id>
      <img class="cdq-team-logo" alt="" src="..." />
      <span class="cdq-team-name">AWAY</span>
      <span class="cdq-team-score">M</span>
    </div>
  </div>
  <ul class="cdq-headline-moments">
    <li class="cdq-moment" data-event-type><!-- moment description --></li>
    <!-- 0..3 entries -->
  </ul>
</section>
```

### Activation flow

For `PlannedState` with `mode: "recap"` and `program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Same shared resolver. `primary_game_id` MUST be non-null — recap requires a target game. Null → journal `template_input_invalid` and fall through to safe.
2. **Read `GameState`.** `gameStateStore.get(primary_game_id)`. Cache miss (no in-memory state — shouldn't happen because the game was just live; D-GRH-49 re-push guarantees it on reconnect, D-GRH-12 multiplex on steady-state) → journal `recap_no_gamestate` and fall through to safe.
3. **Validate final state.** `gameState.status === "final"`. If not (recap fired before final flip — backend authoring bug) → journal `recap_premature` but proceed; we'll show whatever state we have. Don't crash on backend timing edge cases.
4. **Compose final composition.** Read `home_score`, `away_score`, and `home_team_id` / `away_team_id` from `gameState` (see Open contract gaps). Resolve each team's display name + logo from `AssetManifestStore` by `team_id` (D-GRH-08). Compute `winner = home_score > away_score ? "home" : away_score > home_score ? "away" : "draw"`.
5. **Headline moments.** Read the per-game significant-event history from `GameStateStore.significantEvents(primary_game_id)` (SPEC-CRWDQ-017's `GameStatePayload` has no `events` field — the history is accumulated by `GameStateStore` from `GameEvent` deltas during the live game; see Open contract gaps). Filter by `GameEvent.kind ∈ {"goal", "card", "var", "penalty", "period"}` (the SPEC-CRWDQ-017 `GameEventKind` members mapping to D-GRH-68's `recap_signals`). Cap at 3 moments, most recent first.
6. **Resolve theme + assets.** Same path as single-game (D-GRH-23, D-GRH-51).
7. **Run transition.** Default `fade_scale_up` if catalog miss.
8. **Mount.** Build the DOM as above.
9. **Apply pending preferences.** Same dwell-boundary contract.
10. **Arm dwell.** Same `DwellTimer.arm(plannedState.dwell_target_ms)`. Per D-GRH-68 default backend authoring is 30 s, but the player honors whatever is on the wire.

### Graceful degradation

If any of the following are missing, render a reduced composition rather than fall through to safe:

- Team-asset cache miss → the team renders its `team_id` as a placeholder label (team name itself is an AssetManifest asset per D-GRH-08), no logo.
- `GameStateStore.significantEvents(...)` returns an empty history → omit the `<ul class="cdq-headline-moments">` block. The final score alone is still useful.
- `sport_context` absent → empty header badge slot.

Only the "no `GameState`" or "null `primary_game_id`" cases fall through to safe. Everything else degrades in place.

### No re-render on late events

Per D-GRH-68 the recap composition is built once at mount. Late `GameEvent` deltas (e.g., a final-score correction via the recording workflow's post-final cleanup window) are journaled as `recap_late_event` for backend diagnostics but do NOT mutate the DOM. The recap is the closing image; flickering it would be worse than displaying a slightly-stale-but-coherent composition.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| DOM | 1 in-process | jsdom. |
| `AssetManifestStore` (SPEC-CRWDQ-064) | 1 in-process | Real instance, pre-seeded with team assets; `AssetFetcher` substituted per SPEC-CRWDQ-064. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Happy recap: `GameState{status: final, home_score: 3, away_score: 1}` → DOM shows FULL TIME label, `data-winner="home"`, scores 3/1, team logos rendered.
- Draw: `home_score: 2, away_score: 2` → `data-winner="draw"`.
- Headline moments cap: `GameStateStore.significantEvents` returns 5 significant events → exactly 3 most-recent rendered.
- Empty moments: `GameStateStore.significantEvents` returns `[]` → `<ul.cdq-headline-moments>` omitted from DOM.
- Team-asset cache miss: `assetManifestStore.get("team:home-team-id")` → null → home team renders its `team_id` as a placeholder label, no `<img>`, no error.
- `primary_game_id` null: journal `template_input_invalid`; no mount.
- `gameState` cache miss: journal `recap_no_gamestate`; no mount (escalates to safe via downstream owner).
- `gameState.status !== "final"`: journal `recap_premature`; mount proceeds with whatever data exists.
- Late `GameEvent` after mount: journal `recap_late_event`; no DOM mutation.
- Pending preference apply at boundary: theme swap occurs; recap composition not re-mounted.
- Supersede: outgoing transition runs; instance detaches; no subscription to unwind (recap doesn't subscribe).
- Dwell boundary: timer fires after `dwell_target_ms` (30 s default); journal `dwell_boundary_reached`; composition stays rendered until next `PlannedState`.

## Vocabulary

- `recap` — `business_mode` enum value added by D-GRH-68.
- `winner` — derived from `home_score` vs `away_score`; not a wire field.
- `headline moment` — significant entry from `GameState.events` filtered by closed event-type set.

## Acceptance Criteria

- [ ] `RecapTemplate.mount(host, ctx)` renders `<section class="crowdaq-recap" data-theme data-game-id data-winner="home|away|draw">` with header (FULL TIME label + sport_context), final score block (home/away with logos, names, scores), and optional headline moments list.
- [ ] `data-winner` is derived from `gameState.home_score` vs `gameState.away_score` — `home`, `away`, or `draw`; not read from the wire.
- [ ] Headline moments are read from `GameStateStore.significantEvents(primary_game_id)`, filtered to `GameEvent.kind ∈ {goal, card, var, penalty, period}`, capped at 3, most recent first; an empty history produces no `<ul>` in DOM.
- [ ] Asset cache miss on team logos falls back to text-only team names; no `<img>` placeholder, no error.
- [ ] Null `primary_game_id` journals `template_input_invalid` and does not mount.
- [ ] `gameStateStore.get(primary_game_id)` miss journals `recap_no_gamestate` and does not mount (escalation owned by safe template).
- [ ] `gameState.status !== "final"` journals `recap_premature` but mount proceeds with available data — no crash on premature recap.
- [ ] Late `GameEvent` deltas for `primary_game_id` after mount journal `recap_late_event` and do NOT mutate the DOM (recap is a frozen closing image per D-GRH-68).
- [ ] No subscription to `GameStateStore` is held by the template instance — `detach()` has no listeners to unwind.
- [ ] Theme + pending-apply contract follows the shared dwell-boundary semantics from SPEC-CRWDQ-023.
- [ ] Tests cover happy path, draw, moments-cap, empty-moments, logo cache miss, null primary, no-gamestate, premature, late event, dwell boundary, supersede, pending apply.
- [ ] No mocks of shared orchestration or `GameStateStore` (INV-FACTORY-16); only asset URL fetch and clock substituted.
