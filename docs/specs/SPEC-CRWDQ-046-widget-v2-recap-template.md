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
| Decisions referenced | D-GRH-08, D-GRH-21, D-GRH-23, D-GRH-29, D-GRH-30, D-GRH-50, D-GRH-51, D-GRH-68 |
| Source files | `modules/widget-v2/src/render/GameStateStore.ts`, `PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed from SPEC-CRWDQ-023); `AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064) |
| New files | `modules/widget-v2/src/templates/recap/RecapTemplate.ts`, `modules/widget-v2/src/templates/recap/recap.html`, `modules/widget-v2/src/templates/recap/recap.css`, `modules/widget-v2/tests/templates/recap/*.test.ts` |

> **Backend authority note:** The recap `PlannedState` / `ProgramSlot` this
> template consumes are produced by the authoritative backend spec
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-045` (recap window calculator +
> recap `PlannedState` emitter), over the wire-protocol envelope of
> `SPEC-CRWDQ-017`. Every claim below about the recap frame shape, the
> `program_slot_id`, the headline-moment source, and what data the player
> reads from the wire vs from its in-memory state is cross-checked against
> SPEC-CRWDQ-045. The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: templates/recap` — the `recap` business-mode template. Per D-GRH-68, `recap` is a normal `business_mode` value (`business_mode === "recap"`), not an `interrupt_class`; the recap `PlannedState`'s `interrupt_class` is `"scheduled"` (SPEC-CRWDQ-045). Renders final score + a single headline moment (when supplied) + winner highlight. The final score is read from the player's existing in-memory `GameState[primary_game_id]`; the headline moment is read from the recap `PlannedState`'s render-hint payload. Honors transition + `dwell_target_ms` like every other slot. Falls back gracefully if recap-relevant data is unavailable.

## Current shape

- No recap rendering in v1.
- D-GRH-68 finalized recap as a normal `business_mode = "recap"` value rather than a separate "post-game recap layer" or `interrupt_class`.
- Per SPEC-CRWDQ-045 `buildRecap`, a recap slot is a freshly emitted `PlannedState` (`business_mode: "recap"`, `template_id: "recap-default"`, `transition: "cut"`, `interrupt_class: "scheduled"`, `ad_slot_id: null`) paired with a **freshly created `ProgramSlot`** — `program_slot_id` is a new UUID v4, `primary_game_id = game.gameId`, `game_ids = [game.gameId]`, `fixture_ids = []`. The recap does NOT reuse the preceding live-game slot's `program_slot_id`; the player resolves the recap's own `ProgramSlot` via the normal `ProgramSlotResolver` path.
- By the time a recap slot becomes active, the backend has already pushed `GameState` with `status: "final"` for the game. The recap template reads `home_score` / `away_score` / `status` from the player's existing in-memory `GameState` (D-GRH-12 multiplex on steady-state; D-GRH-49 re-push on reconnect).

> **Dependencies.** Built on the shared render orchestration of **SPEC-CRWDQ-023** (`GameStateStore`, `PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`) and the asset cache of **SPEC-CRWDQ-064** (`AssetManifestStore`, for team name/logo) — both hard build dependencies in `depends_on`. **SPEC-CRWDQ-045** (`BarPlayerSchedulerService` recap-window calculator + recap `PlannedState` emitter) is the cross-repo `crowdaq-backend` *producer* of the recap `PlannedState`s this template consumes — a wire-contract counterpart, not a build dependency, so it is not in `depends_on`.

## Backend wire-contract facts (SPEC-CRWDQ-045 / -017 cross-check)

- The recap `PlannedState` discriminator is `business_mode === "recap"` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`).
- The recap `PlannedState` carries `template_id: "recap-default"`, `transition: "cut"`, `interrupt_class: "scheduled"`, `ad_slot_id: null`, and a backend-authored `dwell_target_ms` (SPEC-CRWDQ-045; default 30 s, env-configurable).
- The recap's `ProgramSlot` is freshly minted by `buildRecap` — `primary_game_id = game.gameId`, `game_ids = [game.gameId]`, `fixture_ids = []`. It is resolved by the player via `ProgramSlotResolver`.
- The **headline moment** is carried in the recap `PlannedState` payload's **render-hint blob** (SPEC-CRWDQ-045 — "carries `game.recapWindowHint.headlineMoment` into the `PlannedState` render-hint blob when present"). It is the SPEC-CRWDQ-045 `HeadlineMoment` shape: `{ kind: 'goal' | 'card' | 'turning_point', atClock: string, detail: Record<string, unknown> }`. The backend supplies **at most one** headline moment; when no qualifying moment was found, the render-hint is omitted.
- The recap `PlannedState` does NOT carry the final score on the wire — the player reads `home_score` / `away_score` / `status` from its in-memory `GameState`.

> **OPEN QUESTION — team identity on the recap.** The recap renders team
> names + logos, which require a team identifier. D-GRH-08 states
> "`GameState` references `team_id`" and team name/logo/colours are
> `AssetManifest`-delivered assets keyed by `team_id`. But SPEC-CRWDQ-017's
> `GameStatePayload` field list (`game_id`, `sport`, `home_score`,
> `away_score`, `period`, `clock`, `signals`, `badges`, `sport_context`)
> does NOT include `home_team_id` / `away_team_id`. The backend
> `GameLifecycleEvent` carries `homeTeam` / `awayTeam` as display-name
> strings (SPEC-CRWDQ-045) but those go to the scheduler, not to the player,
> and SPEC-CRWDQ-045's recap render-hint blob is documented as carrying only
> the `headlineMoment`. There is therefore currently NO wire path delivering
> team identity to the recap template. This must be resolved before
> implementation — either (a) SPEC-CRWDQ-017 `GameStatePayload` is amended
> to carry `home_team_id` / `away_team_id` per the D-GRH-08 mandate, or
> (b) SPEC-CRWDQ-045's recap render-hint blob is extended to carry team
> name(s)/id(s). This spec assumes option (a) and reads
> `gameState.home_team_id` / `gameState.away_team_id`; if (b) is chosen the
> resolution source changes. Confirm with the backend owner.

> **OPEN QUESTION — multiple headline moments.** The backend supplies at
> most ONE `headlineMoment` per recap (SPEC-CRWDQ-045). D-GRH-68's original
> framing ("no inlined recap content in the wire frame") is superseded by
> SPEC-CRWDQ-045's render-hint carriage of that one moment. If the recap UX
> wants a list of moments (e.g. all goals), the player would have to
> accumulate a per-game significant-`GameEvent` history during the live
> game — which would require a SPEC-CRWDQ-023 `GameStateStore` follow-up to
> expose a `significantEvents(gameId)` accessor. This spec does NOT take
> that on: it renders the single backend-supplied moment. Whether a
> multi-moment recap is wanted is a product decision for the backend/design
> owners; until decided, the recap shows one moment or none.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/recap/RecapTemplate.ts
export interface RecapTemplate {
  mount(host: HTMLElement, context: RecapContext): RecapInstance;
}

export interface RecapContext {
  programSlot: ProgramSlotPayload;   // the recap's own ProgramSlot; primary_game_id is the recap target
  theme: ResolvedTheme;              // SPEC-CRWDQ-023 three-state theme (set/default/unset)
  gameStateStore: GameStateStore;
  assetManifestStore: AssetManifestStore;  // SPEC-CRWDQ-064 — team name/logo resolution
  /**
   * The headline moment from the recap PlannedState's render-hint blob,
   * or null when the backend supplied none. SPEC-CRWDQ-045 HeadlineMoment.
   */
  headlineMoment: HeadlineMoment | null;
  pendingApply: PendingPreferenceApply | null;
}

/** SPEC-CRWDQ-045 HeadlineMoment — carried in the recap PlannedState render-hint. */
export interface HeadlineMoment {
  kind: 'goal' | 'card' | 'turning_point';
  atClock: string;
  detail: Record<string, unknown>;
}

export interface RecapInstance {
  detach(): HTMLElement;
}
```

The template does NOT subscribe to `GameStateStore` per-event updates — recap is a frozen-final snapshot. It reads `GameState` once at mount, then runs out the dwell on a static composition. Late `GameEvent` deltas for the same `game_id` (rare — a final-score correction) are journaled but do NOT re-render the recap.

`ResolvedTheme`, `PendingPreferenceApply`, `ProgramSlotPayload`, and `GameStateStore` are defined by SPEC-CRWDQ-023 and consumed verbatim. `AssetManifestStore` is owned by SPEC-CRWDQ-064.

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
  <div class="cdq-headline-moment" data-moment-kind>
    <!-- single moment description; the whole block is absent when headlineMoment is null -->
  </div>
</section>
```

### Activation flow

For a `PlannedStateFrame` whose `payload.business_mode === "recap"` and `payload.program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Same shared `ProgramSlotResolver`. The activator buffers the `PlannedStateFrame` if `X` has not yet resolved (the SPEC-CRWDQ-023 buffer-with-5s-timeout path; the recap's `ProgramSlot` is freshly emitted by `buildRecap` alongside the `PlannedState`). `programSlot.primary_game_id` MUST be non-null — recap requires a target game. Null → journal `template_input_invalid` and fall through to safe (escalation owned by SPEC-CRWDQ-052).
2. **Read `GameState`.** `gameStateStore.get(primary_game_id)`. A cache miss (no in-memory state — should not happen because the game was just live; D-GRH-49 re-push guarantees it on reconnect, D-GRH-12 multiplex on steady-state) → journal `recap_no_gamestate` and fall through to safe.
3. **Validate final state.** `gameState.status === "final"`. If not (recap fired before the final flip — a backend authoring/timing bug) → journal `recap_premature` but proceed; render whatever state exists. Do not crash on backend timing edge cases.
4. **Compose final composition.** Read `home_score`, `away_score`, and `home_team_id` / `away_team_id` from `gameState` (see the team-identity OPEN QUESTION). Resolve each team's display name + logo from `AssetManifestStore` by `team_id` (D-GRH-08). Compute `winner = home_score > away_score ? "home" : away_score > home_score ? "away" : "draw"`.
5. **Headline moment.** Render the single `context.headlineMoment` (the SPEC-CRWDQ-045 `HeadlineMoment` from the recap `PlannedState` render-hint blob) when it is non-null: a `<div class="cdq-headline-moment" data-moment-kind="goal|card|turning_point">` with text derived from `kind` + `atClock` + `detail`. When `headlineMoment` is null, the block is omitted entirely.
6. **Resolve theme + assets.** Same SPEC-CRWDQ-023 § Theme resolution path (D-GRH-23, D-GRH-51).
7. **Run transition.** `TransitionExecutor.run(plannedState.payload.transition, host)` — the backend supplies `"cut"` for recap (SPEC-CRWDQ-045); a catalog miss falls back per the SPEC-CRWDQ-023 `TransitionExecutor` contract.
8. **Mount.** Build the DOM as above.
9. **Apply pending preferences.** Same SPEC-CRWDQ-023 dwell-boundary contract.
10. **Arm dwell.** `DwellTimer.arm(plannedState.payload.dwell_target_ms, ...)`. Per SPEC-CRWDQ-045 the backend default is 30 s, but the player honors whatever `dwell_target_ms` is on the wire.

### Graceful degradation

If any of the following are missing, render a reduced composition rather than fall through to safe:

- Team-asset cache miss → the team renders its `team_id` as a placeholder label (the team name itself is an `AssetManifest` asset per D-GRH-08), no logo `<img>`.
- `context.headlineMoment` is null → omit the `<div class="cdq-headline-moment">` block. The final score alone is still useful.
- `sport_context` absent → empty header badge slot.

Only the "no `GameState`" or "null `primary_game_id`" cases fall through to safe. Everything else degrades in place.

### No re-render on late events

Per D-GRH-68 the recap composition is built once at mount. Late `GameEvent` deltas (e.g. a final-score correction via the recording workflow's post-final cleanup window) are journaled as `recap_late_event` for backend diagnostics but do NOT mutate the DOM. The recap is the closing image; flickering it would be worse than displaying a slightly-stale-but-coherent composition.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| DOM | 1 in-process | jsdom. |
| `AssetManifestStore` (SPEC-CRWDQ-064) | 1 in-process | Real instance, pre-seeded with team assets; `AssetFetcher` substituted per SPEC-CRWDQ-064. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Happy recap: `GameState{status: final, home_score: 3, away_score: 1}` + a `headlineMoment{kind:'goal'}` in context → DOM shows the FULL TIME label, `data-winner="home"`, scores 3/1, team logos, and one `.cdq-headline-moment` block with `data-moment-kind="goal"`.
- Draw: `home_score: 2, away_score: 2` → `data-winner="draw"`.
- Null headline moment: `context.headlineMoment === null` → `.cdq-headline-moment` block omitted from DOM.
- Team-asset cache miss: `assetManifestStore.get("team:home-team-id")` → null → the home team renders its `team_id` as a placeholder label, no `<img>`, no error.
- `primary_game_id` null: journal `template_input_invalid`; no mount.
- `gameState` cache miss: journal `recap_no_gamestate`; no mount (escalates to safe via SPEC-CRWDQ-052).
- `gameState.status !== "final"`: journal `recap_premature`; mount proceeds with whatever data exists.
- Late `GameEvent` after mount: journal `recap_late_event`; no DOM mutation.
- Re-push order: a recap `PlannedState` arrives before its freshly minted `ProgramSlot` → the activator buffers and mounts on the `ProgramSlot` arrival within 5 s.
- Pending preference apply at boundary: theme swap occurs; the recap composition is not re-mounted.
- Supersede: the outgoing transition runs; the instance detaches; no subscription to unwind (recap does not subscribe to `GameStateStore`).
- Dwell boundary: timer fires after `dwell_target_ms` (30 s default); journal `dwell_boundary_reached`; the composition stays rendered until the next `PlannedState`.

## Vocabulary

- `recap` — a `business_mode` enum value (D-GRH-68); the recap `PlannedState`'s `interrupt_class` is `"scheduled"` and its `template_id` is `"recap-default"` (SPEC-CRWDQ-045).
- `winner` — derived in-widget from `gameState.home_score` vs `gameState.away_score`; not a wire field.
- `headline moment` — the single optional `HeadlineMoment` (`{kind, atClock, detail}`, SPEC-CRWDQ-045) carried in the recap `PlannedState`'s render-hint blob; `kind` ∈ `{goal, card, turning_point}`.

## Acceptance Criteria

- [ ] `RecapTemplate.mount(host, ctx)` renders `<section class="crowdaq-recap" data-theme data-game-id data-winner="home|away|draw">` with a header (FULL TIME label + sport_context), a final-score block (home/away with logos, names, scores), and an optional single headline-moment block.
- [ ] `data-winner` is derived from `gameState.home_score` vs `gameState.away_score` — `home`, `away`, or `draw`; not read from the wire.
- [ ] The headline moment is read from `context.headlineMoment` (the recap `PlannedState` render-hint blob, SPEC-CRWDQ-045 `HeadlineMoment`); when it is null the `.cdq-headline-moment` block is omitted. The template renders the single backend-supplied moment and does NOT accumulate or reconstruct a moment history from `GameEvent` deltas.
- [ ] The recap's `ProgramSlot` is resolved via the shared `ProgramSlotResolver` as a freshly emitted slot (a new `program_slot_id`, `primary_game_id = game_id`, `game_ids = [game_id]`, `fixture_ids = []`); the template does not assume the recap reuses the preceding live-game `program_slot_id`.
- [ ] An asset-cache miss on team logos falls back to text-only team labels (the `team_id` placeholder); no `<img>` placeholder, no error.
- [ ] A null `primary_game_id` journals `template_input_invalid` and does not mount.
- [ ] A `gameStateStore.get(primary_game_id)` miss journals `recap_no_gamestate` and does not mount (escalation owned by SPEC-CRWDQ-052).
- [ ] `gameState.status !== "final"` journals `recap_premature` but mount proceeds with the available data — no crash on a premature recap.
- [ ] Late `GameEvent` deltas for `primary_game_id` after mount journal `recap_late_event` and do NOT mutate the DOM (recap is a frozen closing image per D-GRH-68).
- [ ] No subscription to `GameStateStore` is held by the template instance — `detach()` has no listeners to unwind.
- [ ] Theme + pending-apply contract follows the shared dwell-boundary semantics from SPEC-CRWDQ-023; `ctx.theme` is the SPEC-CRWDQ-023 `ResolvedTheme`.
- [ ] Tests cover happy path, draw, null headline moment, logo cache miss, null primary, no-gamestate, premature, late event, re-push order buffering, dwell boundary, supersede, pending apply.
- [ ] No mocks of the shared orchestration or `GameStateStore` (INV-FACTORY-16); only the asset URL fetch boundary and the clock are substituted (INV-FACTORY-17).
