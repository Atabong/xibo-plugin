---
spec_id: SPEC-CRWDQ-034
title: Widget v2 fixtures render template
status: impl-ready
owner: player-runtime/widget-v2/templates/fixtures
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-023, SPEC-CRWDQ-064]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-034 — Widget v2 fixtures render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S6 — Fixtures mode (pre-game catalog render) |
| Plane epic | CRWDQ-7 |
| Decisions referenced | D-GRH-08, D-GRH-17, D-GRH-18, D-GRH-20, D-GRH-21, D-GRH-22, D-GRH-23, D-GRH-30, D-GRH-50, D-GRH-73 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed from SPEC-CRWDQ-023); `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064); `modules/widget-v2/src/transport/Dispatcher.ts` (consumed from SPEC-CRWDQ-022) |
| New files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts`, `modules/widget-v2/src/templates/fixtures/fixtures.html`, `modules/widget-v2/src/templates/fixtures/fixtures.css`, `modules/widget-v2/src/render/FixtureListStore.ts`, `modules/widget-v2/tests/templates/fixtures/*.test.ts` |

> **Backend authority note:** The `FixtureList` frame and the `fixtures`
> `PlannedState` / `ProgramSlot` this template consumes are produced by the
> authoritative backend specs `crowdaq-backend/docs/specs/SPEC-CRWDQ-032`
> (FixtureList catalog + sync worker) and `SPEC-CRWDQ-033` (fixtures-mode
> selection). Every claim below about `FixtureListEntry` fields, the
> `feed_status` value range, `fixture_ids` membership, the `fixtures`
> `PlannedState` `transition`, and frame guarantees is cross-checked against
> those specs. The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: templates/fixtures` — the `fixtures` business-mode template (D-GRH-30 mode #3). Renders a card-list of upcoming fixtures with home/away team names, scheduled time in the bar-local timezone (D-GRH-73 `timezone`), and a sport/league badge resolved from the `AssetManifestStore` (D-GRH-23). `feedStatus: "live"` fixture cards (D-GRH-20) get a visual flag. No live game data; this mode is the pre-game catalog.

> **Dependencies.** Built on the shared render orchestration of **SPEC-CRWDQ-023** (`PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`) and the asset cache of **SPEC-CRWDQ-064** (`AssetManifestStore`) — both hard build dependencies in `depends_on`. **SPEC-CRWDQ-032** (`FixtureList` catalog + sync worker) and **SPEC-CRWDQ-033** (`fixtures`-mode selection) are the cross-repo `crowdaq-backend` *producers* of the `FixtureList` frames and `fixtures` `PlannedState`s this template consumes — wire-contract counterparts for shape agreement, not build dependencies, so they are not in `depends_on`.

## Current shape

- No fixtures rendering in v1. The MVP widget shows the live score panel only.
- `FixtureList` arrives over the WS as a game-data-channel frame per D-GRH-18. There is no equivalent v1 path — the SSE stream never carried fixture data.
- Sport / league badge assets are not bundled in v1. v2 introduces an `AssetManifest`-cached badge set (D-GRH-23) keyed by sport + league identifier; the cache itself is owned by SPEC-CRWDQ-064.
- Time-zone handling in v1 is UTC display via `toLocaleString()`. v2 uses the bar's `timezone` (D-GRH-73) to format fixture times in bar-local — fixture cards show "Today 7:30 PM" in the patrons' own frame of reference.

## Backend wire-contract facts (SPEC-CRWDQ-032 / -033 cross-check)

- **`FixtureListEntry` shape** (SPEC-CRWDQ-032) is exactly `{ eventId, sport, leagueId, leagueName, homeTeam, awayTeam, kickoffUtc, feedStatus }`. This template consumes that shape verbatim and redefines nothing.
- **`feedStatus` value range:** SPEC-CRWDQ-032's per-bar `projectFixtureList` filters the published `FixtureList` to `feedStatus ∈ {scheduled, live, final}` — `postponed` / `cancelled` fixtures never reach the player. SPEC-CRWDQ-033's caller-side filter narrows the `ProgramSlot.fixture_ids` subset *further*: it also drops `final` fixtures whose kickoff is older than 12h (stale-final filter). So a recent (`< 12h`) `final` fixture CAN legitimately appear in `fixture_ids` and the player must render it. This template handles exactly the three values `scheduled | live | final`; a `final` card carries no LIVE pill but is otherwise a normal card.
- **`fixtures` `PlannedState` discriminator** is `business_mode === "fixtures"` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`).
- **`fixtures` `PlannedState.transition`** is backend-authored, default `"cut"` (SPEC-CRWDQ-033). The PlannedState-level transition is therefore `"cut"` on the wire; the card-level `card_slide_in` / `card_slide_out` transitions named in this spec are a **separate, player-internal** concept used only inside `reconcile()` — they are not `PlannedStatePayload.transition` values and are never read off the wire.
- **`fixtures` `ProgramSlot`** has `primary_game_id === null`, `game_ids === []`, and a populated `fixture_ids[]` capped at `maxFixturesShown` (default 8), ordered by kickoff ascending (SPEC-CRWDQ-033, verified `src/scheduler/build/fixtures.ts:115-122`). This template reads `fixture_ids[]` and ignores `game_ids` / `primary_game_id` for this mode. Each `fixture_ids[]` entry is a canonical `event_id` (verified `fixtures.ts:75` + `types.ts:68-77` — see RESOLVED note below).
- **`fixture_ids[]` is always non-empty** when a `fixtures` `PlannedState` reaches the player: SPEC-CRWDQ-033's `buildFixtures` is invoked only when the post-filter fixture list is non-empty; if filtering empties it, `selectMode` returns empty mode and no `fixtures` `PlannedState` is written (D-GRH-22). This template's empty-`fixture_ids` handling is therefore a **defensive** path, not an expected one.
- **Re-push frame order** (SPEC-CRWDQ-020, D-GRH-49) delivers `PlannedState` before its referenced `ProgramSlot`. The shared SPEC-CRWDQ-023 `PlannedStateActivator` tolerates this by buffering; this template inherits that order-independence.

> **RESOLVED — `fixture_ids` carries `event_id` (backend code cross-check).**
> Verified against the `crowdaq-backend` source: `buildFixtures`
> (`src/scheduler/build/fixtures.ts:75`) sets
> `fixtureIds = selected.map(f => f.gameId)`, and `FixtureRow.gameId` is
> documented in `src/scheduler/build/types.ts:68-77` as "the canonical
> event_id — 'fixture' is the domain alias for a not-yet-live game". The
> event_id format is `<yyyy-mm-dd>-<home-slug>-<away-slug>`
> (`src/lib/slug.ts:19-24`). The `FixtureRow.gameId` field name is a
> backend-internal alias; the *value* it carries is the canonical
> `event_id`. `ProgramSlot.fixture_ids[]` entries shall therefore be
> treated as `event_id`s, and the player shall match them against its
> cached `FixtureList` by `eventId`. The dead wire-field split: the wire
> `FixtureListPayload.fixtures[]` type (`src/wire/types.ts:176-184`)
> declares both `fixture_id` and `game_id` per entry, but no production
> code populates them — the only `FixtureList` producer
> (`fixture-list-publisher.ts` → `LoggingFixtureListSink`) emits the
> domain `FixtureListEntry`, which carries `eventId` only and has no
> `fixture_id` / `game_id` fields. `event_id` is the sole real fixture
> identifier; the wire `fixture_id` / `game_id` split is dead and shall
> not be relied on by the player.

## Wire contract (consumed, not defined here)

The `FixtureList` frame is produced by **SPEC-CRWDQ-032** (`crowdaq-backend`, `impl-ready`). Its per-fixture entry shape is SPEC-CRWDQ-032's `FixtureListEntry` — this template consumes that shape verbatim and does NOT redefine it:

```ts
// shape owned by SPEC-CRWDQ-032 FixtureListEntry; consumed here
export interface Fixture {
  eventId: string;          // player-facing fixture id (SPEC-CRWDQ-032 event_id)
  sport: string;
  leagueId: number;
  leagueName: string;
  homeTeam: string;         // team display name (SPEC-CRWDQ-032 carries the name, not a team_id)
  awayTeam: string;         // team display name
  kickoffUtc: string;       // ISO 8601 UTC
  feedStatus: 'scheduled' | 'live' | 'final';
}
```

> **Team identity note.** SPEC-CRWDQ-032's `FixtureListEntry` carries team **display-name strings** (`homeTeam` / `awayTeam`), not `team_id`s. D-GRH-08 keys team logos by `team_id` — but the `FixtureList` wire payload supplies no `team_id`, so a fixtures card **cannot** resolve a per-team logo. Per D-GRH-17 (fixture card fields = home team, away team, scheduled time, league, sport — nothing else), this template renders team **names** only; per-team logos are out of scope for fixtures cards. A sport/league **badge** is still rendered (it is keyed by `sport`+`leagueName`, both present). If per-team logos on fixtures cards are later wanted, SPEC-CRWDQ-032's `FixtureListEntry` must first be amended to carry `team_id`s.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts
export interface FixturesTemplate {
  mount(host: HTMLElement, context: FixturesContext): FixturesInstance;
}

export interface FixturesContext {
  programSlot: ProgramSlotPayload;   // fixture_ids[] non-empty; entries are eventIds
  theme: ResolvedTheme;              // SPEC-CRWDQ-023 three-state theme (set/default/unset)
  timezone: string;                  // IANA, from active BarPreferences (D-GRH-73)
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;   // consumed from SPEC-CRWDQ-064
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesInstance extends TemplateInstance {
  /** Called when a new PlannedState (different state_id) supersedes this
   *  one. Returns the DOM node for the outgoing transition. */
  detach(): HTMLElement;
  /** Implements the shared TemplateInstance.reconcile? hook (canonical
   *  signature owned by SPEC-CRWDQ-023). On a 'program_slot' variant —
   *  a D-GRH-13 revised ProgramSlot (same program_slot_id, different
   *  fixture_ids[]) — swaps cards in place without a re-mount.
   *  Resolves when every card add/remove/move has settled. The 'ad_slot'
   *  and 'game_state_revision' variants are no-ops here (the bare
   *  fixtures template carries no ad_slot_id, and never subscribes to
   *  GameStateStore — fixtures is the pre-game catalog). */
  reconcile(event: TemplateReconcileEvent): Promise<void>;
}
```

`TemplateInstance` and `TemplateReconcileEvent` are declared by SPEC-CRWDQ-023 (§ Reconcile dispatch) and consumed here verbatim — this spec does not redeclare them.

```ts
// modules/widget-v2/src/render/FixtureListStore.ts
export interface FixtureListStore {
  /** Apply a FixtureList frame; per D-GRH-18 the new list REPLACES the cached set. */
  applyList(frame: FixtureListFrame): void;
  /** Resolve a fixture by eventId. Returns null if not in the current cached set. */
  resolve(eventId: string): Fixture | null;
  /** Subscribe to per-fixture mutations (feedStatus flips, kickoff edits).
   *  Returns unsubscribe. */
  subscribe(eventId: string, listener: (fixture: Fixture) => void): () => void;
}
```

`ResolvedTheme`, `PendingPreferenceApply`, `ProgramSlotPayload`, and the `PlannedStateActivator` / `ProgramSlotResolver` / `TransitionExecutor` / `DwellTimer` interfaces are defined by SPEC-CRWDQ-023 and consumed verbatim. `AssetManifestStore` is **owned by SPEC-CRWDQ-064** — this template imports and consumes it; it does not define or create it. Methods used here: `get(assetId): CachedAsset | null` (synchronous cache read) and `ensure(assetId): Promise<CachedAsset>` (fetch-on-demand). See SPEC-CRWDQ-064 for the full interface, eviction, persistence, and content-hash verification.

### Asset-id convention for sport badges

The fixtures card shows one sport/league badge per fixture. Its `AssetManifest` `asset_id` follows the convention `badge:<sport>:<leagueName-slug>` (e.g. `badge:football:premier-league`), `leagueName` lower-cased and slugified.

> **OPEN QUESTION (low risk) — badge `asset_id` convention.** This
> `badge:<sport>:<leagueName-slug>` form is a naming contract with the
> `AssetManifest` publisher: the publisher should mint badge `asset_id`s
> with this exact form, or the template's `get` / `ensure` calls miss
> every badge. No backend decision or backend spec reviewed pins this
> `asset_id` scheme — it is a player-side convention proposal pending
> agreement with the `AssetManifest` publisher's owner. This is not a
> backend-code matter (the manifest publisher does not yet emit badges)
> and is low risk: the league-name text fallback (below) keeps a card
> fully legible on a total badge miss, so a divergent convention degrades
> gracefully rather than crashing. The convention can be finalised
> alongside `AssetManifest` publisher work without blocking this template.

### `fixtures` template DOM shape

```
<section class="crowdaq-fixtures" data-theme data-card-count>
  <header class="cdq-fixtures-header"><h2>Coming up</h2></header>
  <ul class="cdq-fixture-list">
    <li class="cdq-fixture-card" data-event-id data-status="scheduled|live|final">
      <span class="cdq-sport-badge"><img alt="" src="<badge-asset-url>"></span>
      <div class="cdq-teams">
        <span class="cdq-home">HOME TEAM NAME</span>
        <span class="cdq-vs">vs</span>
        <span class="cdq-away">AWAY TEAM NAME</span>
      </div>
      <time class="cdq-when" datetime="<kickoffUtc-iso>"><!-- bar-local formatted --></time>
      <span class="cdq-status" data-status="..."><!-- "Live" pill when applicable --></span>
    </li>
    <!-- ...one card per eventId in ProgramSlot.fixture_ids[] order -->
  </ul>
</section>
```

`data-theme` carries the SPEC-CRWDQ-023 resolved theme attribute: the `set` theme id, the literal `__default__` for `{state:'default'}`, or `__unset__` for `{state:'unset'}`. There is no per-team logo `<img>` — the wire payload carries no `team_id` to resolve one (see Team identity note). Team names render as text.

### Activation flow

For a `PlannedStateFrame` whose `payload.business_mode === "fixtures"` and `payload.program_slot_id` is `X`:

1. **Resolve `ProgramSlot`.** Shared `ProgramSlotResolver`. The activator buffers the `PlannedStateFrame` if `X` has not yet resolved (the SPEC-CRWDQ-023 buffer-with-5s-timeout path; the re-push delivers `PlannedState` before `ProgramSlot`). `programSlot.fixture_ids[]` (entries are `eventId`s) MUST be non-empty — per D-GRH-22 and SPEC-CRWDQ-033 the backend only emits a `fixtures` `PlannedState` when the post-filter fixture list is non-empty. An empty `fixture_ids[]` is therefore a backend authoring error (defensive path): journal `template_input_invalid` and do not mount. Escalation to safe is out of scope here; SPEC-CRWDQ-052 owns it.
2. **Resolve fixtures.** For each `eventId` in order, `FixtureListStore.resolve(eventId)`. A cache miss (eventId absent after a `FixtureList` re-push) journals `fixture_cache_miss` and renders a sport-neutral "TBA" placeholder card.
3. **Resolve the badge.** For each fixture, `assetManifestStore.get("badge:" + sport + ":" + slug(leagueName))`. On a synchronous miss the card renders the league name as a text fallback (D-GRH-08 text fallback) and `assetManifestStore.ensure(<same id>)` is called once to fetch it; when the fetch resolves the badge `<img>` is swapped in.
4. **Format times.** Each `kickoffUtc` (ISO 8601 UTC) is formatted via `Intl.DateTimeFormat(undefined, { timeZone: context.timezone, ... })`. Display = relative-day prefix ("Today" / "Tomorrow" / weekday / "MMM DD") + bar-local time. Day boundary is bar-local midnight in `context.timezone`.
5. **Status flag.** Cards with `fixture.feedStatus === "live"` get `data-status="live"` and a visible "LIVE" pill (D-GRH-20).
6. **Run transition.** Shared `TransitionExecutor.run(plannedState.payload.transition, host)` — `plannedState.payload.transition` is the catalog-name string (SPEC-CRWDQ-017), always `"cut"` for `fixtures` from the backend (SPEC-CRWDQ-033). A catalog miss falls back to the default per SPEC-CRWDQ-023's `TransitionExecutor` contract. This is the PlannedState-level transition only; card-level enter/exit transitions are run inside `reconcile()`.
7. **Mount + subscribe.** For each rendered card, `FixtureListStore.subscribe(eventId, ...)`. Subsequent `FixtureList` re-pushes update the DOM in place (a `feedStatus` flip toggles the LIVE pill; a `kickoffUtc` edit re-formats the time). No transition runs on in-place updates.
8. **Apply pending preferences.** Same dwell-boundary contract as SPEC-CRWDQ-023. If `pendingApply` carries a new `timezone`, the time formatter is rebuilt and all cards re-format; journal `template_locale_refresh`. A theme change in `pendingApply` swaps the theme CSS and updates `data-theme`, per the SPEC-CRWDQ-023 § Theme resolution rule.
9. **Arm dwell.** Shared `DwellTimer.arm(plannedState.payload.dwell_target_ms, ...)`. The dwell value is backend-authored (SPEC-CRWDQ-033); the template executes it exactly.

### Reconcile on `ProgramSlot` revision

A revised `ProgramSlot` (same `program_slot_id`, different `fixture_ids[]`) triggers a `TemplateReconcileEvent { kind: 'program_slot', slot: newSlot }` dispatch. As in SPEC-CRWDQ-031, the shared `PlannedStateActivator` (SPEC-CRWDQ-023) detects the upsert targets the *active* slot and routes the event to the active instance's `reconcile?` hook — rather than SPEC-CRWDQ-023's "soft re-render" path. The player makes no assumption about the relative arrival order of an updated `ProgramSlot` and its referencing `PlannedState`: the `ProgramSlotResolver` upserts last-write-wins by `program_slot_id`, and the activator buffers an unresolved `PlannedState`. Resolution: SPEC-CRWDQ-023 § Reconcile dispatch now declares the canonical optional hook and dispatch invariants; `FixturesInstance` implements it, the bare `SingleGameInstance` does not.

`reconcile({ kind: 'program_slot', slot: newSlot })`:
- Diff old vs new `fixture_ids` (eventIds). Removed cards: `card_slide_out` exit transition, unsubscribe from `FixtureListStore`. New entries: `card_slide_in` enter transition, subscribe. Surviving cards reorder via DOM moves.
- Dwell timer NOT reset (D-GRH-13: a card change is not a slot change).
- Journal `fixtures_reconciled` with `added`, `removed`, `reordered` lists; not emitted when the `fixture_ids` set and order are unchanged.

### Bar-local time formatting rules

Per D-GRH-17 the card displays only home, away, scheduled time, league, sport — no venue, no broadcast channel.

| Bar-local date relative to bar-local "now" | Display |
|--------------------------------------------|---------|
| Same calendar day | `"Today 7:30 PM"` |
| Next calendar day | `"Tomorrow 7:30 PM"` |
| 2..6 days ahead | `"Sat 7:30 PM"` |
| ≥ 7 days ahead (within the 7-day lookahead, D-GRH-18) | `"May 21 7:30 PM"` |

Locale comes from the `Intl.DateTimeFormat` browser default; bar `language` is not in D-GRH-73 scope, so locale is not overridden. Re-formatting is triggered on a `timezone` change at the next dwell boundary (via `pendingApply`).

### `feedStatus: live` visual interplay

A fixture flagged `live` indicates the game is being recorded (D-GRH-19). The fixtures template renders the LIVE pill but does NOT pull `GameState` data — it stays a fixture card. Live-score rendering is the job of `fixtures_with_live_game` (SPEC-CRWDQ-066) or `single_game` / `multiple_games` once the backend transitions the slot. The fixtures template is the pre-game / mixed-state catalog only.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `DwellTimer`, `TransitionExecutor` | 1 in-process | Real shared instances from SPEC-CRWDQ-023. |
| `AssetManifestStore` | 1 in-process | Real instance from SPEC-CRWDQ-064; `AssetFetcher` substituted per that spec. |
| `FixtureListStore` | 1 in-process | Real instance; driven via a frame-injection test driver. |
| DOM | 1 in-process | jsdom. |
| `Intl.DateTimeFormat` | 1 in-process | Real call; jsdom supports IANA TZ. |
| Time | system boundary | Fake `Date.now()`; clock pinned to a known UTC instant. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Happy mount: `fixture_ids: ["eA","eB","eC"]` all resolve → 3 cards, team names + sport badge rendered, times formatted in `America/Chicago`.
- Bar-local "Today" / "Tomorrow" / weekday / "MMM DD": pin the clock to a known UTC instant; assert each card's `time` text.
- Live status pill: `eA.feedStatus = "live"` → `data-status="live"` and a visible LIVE pill on that card only.
- Recent-final card: `eA.feedStatus = "final"` (a `< 12h` final that SPEC-CRWDQ-033's stale-final filter still admits) → `data-status="final"`, no LIVE pill, normal team-name + badge + time rendering.
- Empty `fixture_ids` (defensive): journal `template_input_invalid`; no mount.
- Re-push order: a `fixtures` `PlannedState` arrives before its `ProgramSlot` → the activator buffers and mounts on the `ProgramSlot` arrival within 5s (SPEC-CRWDQ-023 buffer path).
- PlannedState transition: `plannedState.payload.transition: "cut"` → `TransitionExecutor` runs the `cut` transition on mount; card-level transitions are not run on mount.
- Fixture cache miss: `fixture_ids: ["eA","eGHOST"]` where `eGHOST` is not in the store → first card renders fully; second shows a "TBA" placeholder; journal `fixture_cache_miss`.
- Badge cache miss: `assetManifestStore.get("badge:football:premier-league")` returns null → card shows the league-name text fallback; `ensure(...)` invoked once; on resolve the badge `<img>` swaps in.
- `FixtureList` re-push: `eA.feedStatus` flips `scheduled` → `live` → in-place DOM update, no re-mount, no transition.
- Timezone change at boundary: `pendingApply` carries `timezone: "America/New_York"` → at the dwell boundary all cards re-format; journal `template_locale_refresh`.
- Reconcile add: `fixture_ids ["eA","eB"]` → `["eA","eB","eC"]` → `card_slide_out`/`card_slide_in` sequence; dwell NOT reset; journal `fixtures_reconciled` with `added:["eC"]`.
- Reconcile remove: `["eA","eB","eC"]` → `["eA","eC"]` → exit `eB`; survivor `eC` moves; journal `removed:["eB"], reordered:["eC"]`.
- Reconcile no-op: an updated `ProgramSlot` with an identical `fixture_ids` set and order → no add/remove/move, no journal entry.
- Supersede to single_game (different `state_id`): standard supersede path; `detach()` unsubscribes all `FixtureListStore` subscriptions.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- `fixtures` mode — D-GRH-30 business mode #3; the `PlannedStatePayload.business_mode` value. Backend `template_id` is `"fixtures-list"` (SPEC-CRWDQ-033).
- `FixtureList`, `feedStatus` — D-GRH-18, D-GRH-20; entry shape owned by SPEC-CRWDQ-032; player-facing value range `scheduled|live|final`.
- `eventId` — the player-facing fixture id (SPEC-CRWDQ-032 `event_id`, format `<yyyy-mm-dd>-<home-slug>-<away-slug>`); the confirmed member type of `ProgramSlot.fixture_ids` (verified against `crowdaq-backend` `src/scheduler/build/fixtures.ts:75` — see the RESOLVED note above).
- `AssetManifestStore` — owned by SPEC-CRWDQ-064.
- `timezone` — D-GRH-73 IANA-validated bar preference.
- `card_slide_in` / `card_slide_out` — local terms: the player-internal enter/exit transitions run by `reconcile()`. They are NOT `PlannedStatePayload.transition` catalog values.

## Acceptance Criteria

- [ ] `FixturesTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures">` with one `<li class="cdq-fixture-card" data-event-id data-status>` per `eventId` in `ProgramSlotPayload.fixture_ids[]` order.
- [ ] Per D-GRH-17, each card displays home team name, away team name, scheduled time in bar-local TZ, league, and sport — and no venue, no broadcast channel, no per-team logo (the `FixtureList` wire payload carries no `team_id`).
- [ ] The `Fixture` type consumed by this template matches SPEC-CRWDQ-032's `FixtureListEntry` exactly (`eventId`, `sport`, `leagueId`, `leagueName`, `homeTeam`, `awayTeam`, `kickoffUtc`, `feedStatus`); it is not redefined.
- [ ] `kickoffUtc` is formatted via `Intl.DateTimeFormat` with `timeZone = context.timezone`; the relative-day prefix follows the Today / Tomorrow / weekday / MMM-DD table.
- [ ] Cards with `feedStatus === "live"` carry `data-status="live"` and a visible LIVE pill; `scheduled` / `final` do not. The template handles exactly the three values `scheduled|live|final` (SPEC-CRWDQ-032 filters `postponed`/`cancelled` out before publish).
- [ ] An empty `fixture_ids[]` journals `template_input_invalid` and does not mount. This is a defensive path — SPEC-CRWDQ-033 guarantees a `fixtures` `PlannedState` is emitted only with a non-empty post-filter fixture list. Escalation is owned by SPEC-CRWDQ-052.
- [ ] The PlannedState-level transition run on mount is `plannedState.payload.transition` (always `"cut"` from the backend for `fixtures`, per SPEC-CRWDQ-033); the card-level `card_slide_in` / `card_slide_out` transitions are run only inside `reconcile()` and are never read off the wire.
- [ ] A cache miss on an `eventId` renders a "TBA" placeholder card and journals `fixture_cache_miss`. A badge `AssetManifestStore.get(...)` miss falls back to league-name text and triggers `AssetManifestStore.ensure(...)` once for that badge.
- [ ] `AssetManifestStore` is consumed from SPEC-CRWDQ-064 — this spec neither defines nor creates it; badge lookups use `get(assetId)` / `ensure(assetId)` with `assetId = "badge:<sport>:<leagueName-slug>"`.
- [ ] In-place updates: a `FixtureList` re-push that flips `feedStatus` or edits `kickoffUtc` mutates the existing card's DOM without a re-mount; no transition runs.
- [ ] `FixturesInstance` implements the shared `TemplateInstance.reconcile?(event: TemplateReconcileEvent)` hook owned by SPEC-CRWDQ-023. On `{ kind: 'program_slot', slot }` it diffs `slot.fixture_ids`, adds/removes/reorders cards in place with `card_slide_in` / `card_slide_out` transitions, does NOT reset the `DwellTimer`, and emits `fixtures_reconciled` only when the `fixture_ids` set or order changed; it is invoked by the shared `PlannedStateActivator`'s active-slot reconcile dispatch (SPEC-CRWDQ-023). The `ad_slot` and `game_state_revision` variants are no-ops.
- [ ] `pendingApply` with a new `timezone` re-formats all rendered cards at the next dwell boundary; journal `template_locale_refresh`.
- [ ] No `GameState` subscription anywhere in this template — fixtures mode is the pre-game catalog only.
- [ ] Tests cover all enumerated cases; no mocks of the shared orchestration, `AssetManifestStore`, or `FixtureListStore` (INV-FACTORY-16); only the clock and the SPEC-CRWDQ-064 `AssetFetcher` boundary are substituted (INV-FACTORY-17).
