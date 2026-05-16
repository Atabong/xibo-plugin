---
spec_id: SPEC-CRWDQ-046
title: Widget v2 recap render template
status: draft
parent: S9
area: player-runtime/widget-v2/templates/recap
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
| Source files | `modules/widget-v2/src/render/GameStateStore.ts`, `PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/recap/RecapTemplate.ts`, `modules/widget-v2/src/templates/recap/recap.html`, `modules/widget-v2/src/templates/recap/recap.css`, `modules/widget-v2/tests/templates/recap/*.test.ts` |
| Blocked by | SPEC-CRWDQ-022 (WS client), SPEC-CRWDQ-023 (shared orchestration), SPEC-CRWDQ-045 (backend recap PlannedState emitter) |

## Module

`player-runtime :: widget-v2 :: templates/recap` — the `recap` business-mode template (D-GRH-68: post-game recap is mode #X, where X = `recap`, a normal `business_mode` not an interrupt class). Renders final score + headline moment(s) + winner highlight from the player's existing `GameState[game_id]` — no inlined recap content in the wire frame, per D-GRH-68. Honors transition + `dwell_target_ms` like every other slot. Falls back gracefully if recap-relevant data is unavailable.

## Current shape

- No recap rendering in v1.
- D-GRH-68 finalized recap as a normal `business_mode = "recap"` value rather than a separate "post-game recap layer" or `interrupt_class`. The recap `PlannedState` reuses the same `program_slot_id` that drove the preceding live-game slot, so the template resolves `primary_game_id` from the existing in-memory `ProgramSlot` (D-GRH-21).
- By the time a recap slot becomes active, the backend has already pushed `GameState` with `status: "final"` for the game. The recap template reads `final_score`, `winner` (derivable from scores), and headline moments (events with elevated significance — goals, lead changes, red cards, etc.) from `GameState`. There's no separate recap content frame.

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
4. **Compose final composition.** Read `home_score`, `away_score`, team identifiers from `gameState`. Compute `winner = home_score > away_score ? "home" : away_score > home_score ? "away" : "draw"`.
5. **Headline moments.** Filter `gameState.events` (the per-game event log carried in the `GameState` snapshot, if present) by significance. Significance heuristic for v1: events with `event_type ∈ {"goal", "red_card", "lead_change", "overtime_start", "penalty"}` — the closed set per D-GRH-68's `recap_signals`. Cap at 3 moments, most recent first.
6. **Resolve theme + assets.** Same path as single-game (D-GRH-23, D-GRH-51).
7. **Run transition.** Default `fade_scale_up` if catalog miss.
8. **Mount.** Build the DOM as above.
9. **Apply pending preferences.** Same dwell-boundary contract.
10. **Arm dwell.** Same `DwellTimer.arm(plannedState.dwell_target_ms)`. Per D-GRH-68 default backend authoring is 30 s, but the player honors whatever is on the wire.

### Graceful degradation

If any of the following are missing, render a reduced composition rather than fall through to safe:

- Team logos cache miss → text-only team names.
- `gameState.events` absent or empty → omit the `<ul class="cdq-headline-moments">` block. The final score alone is still useful.
- `sport_context` absent → empty header badge slot.

Only the "no `GameState`" or "null `primary_game_id`" cases fall through to safe. Everything else degrades in place.

### No re-render on late events

Per D-GRH-68 the recap composition is built once at mount. Late `GameEvent` deltas (e.g., a final-score correction via the recording workflow's post-final cleanup window) are journaled as `recap_late_event` for backend diagnostics but do NOT mutate the DOM. The recap is the closing image; flickering it would be worse than displaying a slightly-stale-but-coherent composition.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| DOM | 1 in-process | jsdom. |
| Asset manifest lookup | 2 local-substitutable | `AssetManifestStore` with pre-seeded team logos. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Happy recap: `GameState{status: final, home_score: 3, away_score: 1}` → DOM shows FULL TIME label, `data-winner="home"`, scores 3/1, team logos rendered.
- Draw: `home_score: 2, away_score: 2` → `data-winner="draw"`.
- Headline moments cap: feed `gameState.events` with 5 significant events → exactly 3 most-recent rendered.
- Empty moments: `gameState.events: []` → `<ul.cdq-headline-moments>` omitted from DOM.
- Logo cache miss: `assetManifestStore.resolve("team_logo:home-team-id")` → null → home team renders name text without `<img>`, no error.
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

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-022 — frame dispatch.
- SPEC-CRWDQ-023 — shared orchestration.
- SPEC-CRWDQ-045 — backend `BarPlayerSchedulerService` emits the recap `PlannedState` after `GameLifecycleEvent(live → final)`.

**Blocks (downstream):**

- None — recap is a leaf template.

## Acceptance Criteria

- [ ] `RecapTemplate.mount(host, ctx)` renders `<section class="crowdaq-recap" data-theme data-game-id data-winner="home|away|draw">` with header (FULL TIME label + sport_context), final score block (home/away with logos, names, scores), and optional headline moments list.
- [ ] `data-winner` is derived from `gameState.home_score` vs `gameState.away_score` — `home`, `away`, or `draw`; not read from the wire.
- [ ] Headline moments are filtered to event types `{goal, red_card, lead_change, overtime_start, penalty}` and capped at 3, most recent first; absent events block produces no `<ul>` in DOM.
- [ ] Asset cache miss on team logos falls back to text-only team names; no `<img>` placeholder, no error.
- [ ] Null `primary_game_id` journals `template_input_invalid` and does not mount.
- [ ] `gameStateStore.get(primary_game_id)` miss journals `recap_no_gamestate` and does not mount (escalation owned by safe template).
- [ ] `gameState.status !== "final"` journals `recap_premature` but mount proceeds with available data — no crash on premature recap.
- [ ] Late `GameEvent` deltas for `primary_game_id` after mount journal `recap_late_event` and do NOT mutate the DOM (recap is a frozen closing image per D-GRH-68).
- [ ] No subscription to `GameStateStore` is held by the template instance — `detach()` has no listeners to unwind.
- [ ] Theme + pending-apply contract follows the shared dwell-boundary semantics from SPEC-CRWDQ-023.
- [ ] Tests cover happy path, draw, moments-cap, empty-moments, logo cache miss, null primary, no-gamestate, premature, late event, dwell boundary, supersede, pending apply.
- [ ] No mocks of shared orchestration or `GameStateStore` (INV-FACTORY-16); only asset URL fetch and clock substituted.
