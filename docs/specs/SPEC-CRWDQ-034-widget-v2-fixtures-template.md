---
spec_id: SPEC-CRWDQ-034
title: Widget v2 fixtures render template
status: draft
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
| Decisions referenced | D-GRH-08, D-GRH-17, D-GRH-18, D-GRH-20, D-GRH-21, D-GRH-22, D-GRH-23, D-GRH-25, D-GRH-30, D-GRH-50, D-GRH-73 |
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed from SPEC-CRWDQ-023); `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064); `modules/widget-v2/src/transport/Dispatcher.ts` (consumed from SPEC-CRWDQ-022) |
| New files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts`, `modules/widget-v2/src/templates/fixtures/fixtures.html`, `modules/widget-v2/src/templates/fixtures/fixtures.css`, `modules/widget-v2/src/render/FixtureListStore.ts`, `modules/widget-v2/tests/templates/fixtures/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/fixtures` — the `fixtures` business-mode template (D-GRH-30 mode #3). Renders a card-list of upcoming fixtures with home/away team names, scheduled time in the bar-local timezone (D-GRH-73 `timezone`), and a sport/league badge resolved from the `AssetManifestStore` (D-GRH-23). `feed_status: "live"` fixture cards (D-GRH-20) get a visual flag. No live game data; this mode is the pre-game catalog.

> **Dependencies.** Built on the shared render orchestration of **SPEC-CRWDQ-023** (`PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`) and the asset cache of **SPEC-CRWDQ-064** (`AssetManifestStore`) — both hard build dependencies in `depends_on`. **SPEC-CRWDQ-032** (`FixtureList` catalog + sync worker) and **SPEC-CRWDQ-033** (`fixtures`-mode selection) are the cross-repo `crowdaq-backend` *producers* of the `FixtureList` frames and `fixtures` `PlannedState`s this template consumes — wire-contract counterparts for shape agreement, not build dependencies, so they are not in `depends_on`.

## Current shape

- No fixtures rendering in v1. The MVP widget shows the live score panel only.
- `FixtureList` arrives over the WS as a game-data-channel frame per D-GRH-25 + D-GRH-18. There is no equivalent v1 path — the SSE stream never carried fixture data.
- Sport / league badge assets are not bundled in v1. v2 introduces an `AssetManifest`-cached badge set (D-GRH-23) keyed by sport + league identifier; the cache itself is owned by SPEC-CRWDQ-064.
- Time-zone handling in v1 is UTC display via `toLocaleString()`. v2 uses the bar's `timezone` (D-GRH-73) to format fixture times in bar-local — fixture cards show "Today 7:30 PM" in the patrons' own frame of reference.

## Wire contract (consumed, not defined here)

The `FixtureList` frame is produced by **SPEC-CRWDQ-032** (`crowdaq-backend`, `impl-ready`). Its per-fixture entry shape is SPEC-CRWDQ-032's `FixtureListEntry` — this template consumes that shape verbatim and does NOT redefine it:

```ts
// shape owned by SPEC-CRWDQ-032 FixtureListEntry; consumed here
export interface Fixture {
  eventId: string;          // player-facing fixture id (SPEC-CRWDQ-032 — the id players use)
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

> **feed_status range.** SPEC-CRWDQ-032's per-bar `projectFixtureList` filters the published list to `feed_status ∈ {scheduled, live, final}` — `postponed` / `cancelled` fixtures never reach the player. This template therefore handles exactly those three values.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts
export interface FixturesTemplate {
  mount(host: HTMLElement, context: FixturesContext): FixturesInstance;
}

export interface FixturesContext {
  programSlot: ProgramSlot;          // fixture_ids[] non-empty; entries are eventIds
  themeId: string | null;
  timezone: string;                  // IANA, from active BarPreferences (D-GRH-73)
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;   // consumed from SPEC-CRWDQ-064
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesInstance {
  detach(): HTMLElement;
  /** D-GRH-13-style reconcile: a revised ProgramSlot (same program_slot_id,
   *  different fixture_ids[]) swaps cards in place without a re-mount. */
  reconcile(newSlot: ProgramSlot): Promise<void>;
}
```

```ts
// modules/widget-v2/src/render/FixtureListStore.ts
export interface FixtureListStore {
  /** Apply a FixtureList frame; per D-GRH-18 the new list REPLACES the cached set. */
  applyList(frame: FixtureListFrame): void;
  /** Resolve a fixture by eventId. Returns null if not in the current cached set. */
  resolve(eventId: string): Fixture | null;
  /** Subscribe to per-fixture mutations (feed_status flips, kickoff edits).
   *  Returns unsubscribe. */
  subscribe(eventId: string, listener: (fixture: Fixture) => void): () => void;
}
```

`AssetManifestStore` is **owned by SPEC-CRWDQ-064** — this template imports and consumes it; it does not define or create it. Methods used here: `get(assetId): CachedAsset | null` (synchronous cache read) and `ensure(assetId): Promise<CachedAsset>` (fetch-on-demand). See SPEC-CRWDQ-064 for the full interface, eviction, persistence, and content-hash verification.

### Asset-id convention for sport badges

The fixtures card shows one sport/league badge per fixture. Its `AssetManifest` `asset_id` follows the convention `badge:<sport>:<leagueName-slug>` (e.g. `badge:football:premier-league`), `leagueName` lower-cased and slugified. This convention is a contract with the `AssetManifest` publisher (backend): the publisher MUST mint badge `asset_id`s with this exact form, or the template's `get`/`ensure` calls miss every badge. The convention is recorded here because no decision pins it; flag for backend confirmation.

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

There is no per-team logo `<img>` — the wire payload carries no `team_id` to resolve one (see Team identity note). Team names render as text.

### Activation flow

For a `PlannedState` with `mode: "fixtures"` and `program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Shared resolver. `programSlot.fixture_ids[]` (entries are `eventId`s) MUST be non-empty — per D-GRH-22 the backend always sends a non-empty gap-filling slot; if empty, journal `template_input_invalid` and fall through to safe (escalation owned by SPEC-CRWDQ-052).
2. **Resolve fixtures.** For each `eventId` in order, `FixtureListStore.resolve(eventId)`. A cache miss (eventId absent after a `FixtureList` re-push) journals `fixture_cache_miss` and renders a sport-neutral "TBA" placeholder card.
3. **Resolve the badge.** For each fixture, `assetManifestStore.get("badge:" + sport + ":" + slug(leagueName))`. On a synchronous miss the card renders the league name as a text fallback (D-GRH-08 text fallback) and `assetManifestStore.ensure(<same id>)` is called once to fetch it; when the fetch resolves the badge `<img>` is swapped in.
4. **Format times.** Each `kickoffUtc` (ISO 8601 UTC) is formatted via `Intl.DateTimeFormat(undefined, { timeZone: context.timezone, ... })`. Display = relative-day prefix ("Today" / "Tomorrow" / weekday / "MMM DD") + bar-local time. Day boundary is bar-local midnight in `context.timezone`.
5. **Status flag.** Cards with `fixture.feedStatus === "live"` get `data-status="live"` and a visible "LIVE" pill (D-GRH-20).
6. **Run transition.** Shared `TransitionExecutor.run(plannedState.transition, host)` — `plannedState.transition` is the catalog-name string (SPEC-CRWDQ-017); default `slide_stagger_in` on a catalog miss.
7. **Mount + subscribe.** For each rendered card, `FixtureListStore.subscribe(eventId, ...)`. Subsequent `FixtureList` re-pushes update the DOM in place (a `feedStatus` flip toggles the LIVE pill; a `kickoffUtc` edit re-formats the time). No transition runs on in-place updates.
8. **Apply pending preferences.** Same dwell-boundary contract as SPEC-CRWDQ-023. If `pendingApply` carries a new `timezone`, the time formatter is rebuilt and all cards re-format; journal `template_locale_refresh`.
9. **Arm dwell.** Shared `DwellTimer.arm(plannedState.dwell_target_ms, ...)`.

### Reconcile on `ProgramSlot` revision

A revised `ProgramSlot` (same `program_slot_id`, different `fixture_ids[]`) triggers `reconcile(newSlot)`. As in SPEC-CRWDQ-031, the shared `PlannedStateActivator` (SPEC-CRWDQ-023) detects the upsert targets the *active* slot and routes it to the active instance's `reconcile(newSlot)` hook — rather than SPEC-CRWDQ-023's "soft re-render" path. This presumes SPEC-CRWDQ-023's `PlannedStateActivator` supports an optional `reconcile?(slot)` dispatch on its template-instance contract (`FixturesInstance` implements it). (SPEC-CRWDQ-023 follow-up: its generic template-instance interface must add the optional `reconcile?` hook.)

`reconcile`:
- Diff old vs new `fixture_ids` (eventIds). Removed cards: exit transition (`card_slide_out`), unsubscribe. New entries: enter transition (`card_slide_in`), subscribe. Surviving cards reorder via DOM moves.
- Dwell timer NOT reset (D-GRH-13: card change is not a slot change).
- Journal `fixtures_reconciled` with `added`, `removed`, `reordered`.

### Bar-local time formatting rules

Per D-GRH-17 the card displays only home, away, scheduled time, league, sport — no venue, no broadcast channel.

| Bar-local date relative to bar-local "now" | Display |
|--------------------------------------------|---------|
| Same calendar day | `"Today 7:30 PM"` |
| Next calendar day | `"Tomorrow 7:30 PM"` |
| 2..6 days ahead | `"Sat 7:30 PM"` |
| ≥ 7 days ahead (within the 7-day lookahead, D-GRH-18) | `"May 21 7:30 PM"` |

Locale comes from the `Intl.DateTimeFormat` browser default; bar `language` is not in D-GRH-73 scope, so locale is not overridden. Re-formatting is triggered on a `timezone` change at the next dwell boundary (via `pendingApply`).

### `feed_status: live` visual interplay

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
- Empty `fixture_ids`: journal `template_input_invalid`; no mount.
- Fixture cache miss: `fixture_ids: ["eA","eGHOST"]` where `eGHOST` is not in the store → first card renders fully; second shows a "TBA" placeholder; journal `fixture_cache_miss`.
- Badge cache miss: `assetManifestStore.get("badge:football:premier-league")` returns null → card shows the league-name text fallback; `ensure(...)` invoked once; on resolve the badge `<img>` swaps in.
- `FixtureList` re-push: `eA.feedStatus` flips `scheduled` → `live` → in-place DOM update, no re-mount, no transition.
- Timezone change at boundary: `pendingApply` carries `timezone: "America/New_York"` → at the dwell boundary all cards re-format; journal `template_locale_refresh`.
- Reconcile add: `fixture_ids ["eA","eB"]` → `["eA","eB","eC"]` → exit/enter sequence; dwell NOT reset; journal `fixtures_reconciled` with `added:["eC"]`.
- Reconcile remove: `["eA","eB","eC"]` → `["eA","eC"]` → exit `eB`; survivor `eC` moves; journal `removed:["eB"], reordered:["eC"]`.
- Supersede to single_game (different `state_id`): standard supersede path; detach unsubscribes all `FixtureListStore` subscriptions.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- `fixtures` mode — D-GRH-30 #3.
- `FixtureList`, `feed_status` — D-GRH-18, D-GRH-20; entry shape owned by SPEC-CRWDQ-032.
- `eventId` — the player-facing fixture id (SPEC-CRWDQ-032).
- `AssetManifestStore` — owned by SPEC-CRWDQ-064.
- `timezone` — D-GRH-73 IANA-validated bar preference.

## Acceptance Criteria

- [ ] `FixturesTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures">` with one `<li class="cdq-fixture-card" data-event-id data-status>` per `eventId` in `ProgramSlot.fixture_ids[]` order.
- [ ] Per D-GRH-17, each card displays home team name, away team name, scheduled time in bar-local TZ, league, and sport — and no venue, no broadcast channel, no per-team logo (the `FixtureList` wire payload carries no `team_id`).
- [ ] The `Fixture` type consumed by this template matches SPEC-CRWDQ-032's `FixtureListEntry` exactly (`eventId`, `sport`, `leagueId`, `leagueName`, `homeTeam`, `awayTeam`, `kickoffUtc`, `feedStatus`); it is not redefined.
- [ ] `kickoffUtc` is formatted via `Intl.DateTimeFormat` with `timeZone = context.timezone`; the relative-day prefix follows the Today / Tomorrow / weekday / MMM-DD table.
- [ ] Cards with `feedStatus === "live"` carry `data-status="live"` and a visible LIVE pill; `scheduled` / `final` do not. The template handles exactly the three values `scheduled|live|final` (SPEC-CRWDQ-032 filters `postponed`/`cancelled` out before publish).
- [ ] Empty `fixture_ids[]` journals `template_input_invalid` and does not mount (escalation owned by SPEC-CRWDQ-052).
- [ ] A cache miss on an `eventId` renders a "TBA" placeholder card and journals `fixture_cache_miss`. A badge `AssetManifestStore.get(...)` miss falls back to league-name text and triggers `AssetManifestStore.ensure(...)` once for that badge.
- [ ] `AssetManifestStore` is consumed from SPEC-CRWDQ-064 — this spec neither defines nor creates it; badge lookups use `get(assetId)` / `ensure(assetId)` with `assetId = "badge:<sport>:<leagueName-slug>"`.
- [ ] In-place updates: a `FixtureList` re-push that flips `feedStatus` or edits `kickoffUtc` mutates the existing card's DOM without a re-mount; no transition runs.
- [ ] `reconcile(newSlot)` diffs `fixture_ids`, adds/removes/reorders cards in place with enter/exit transitions, and does NOT reset the `DwellTimer`; it is invoked by the shared `PlannedStateActivator`'s active-slot `reconcile` dispatch (SPEC-CRWDQ-023).
- [ ] `pendingApply` with a new `timezone` re-formats all rendered cards at the next dwell boundary; journal `template_locale_refresh`.
- [ ] No `GameState` subscription anywhere in this template — fixtures mode is the pre-game catalog only.
- [ ] Tests cover all enumerated cases; no mocks of the shared orchestration, `AssetManifestStore`, or `FixtureListStore` (INV-FACTORY-16); only the clock and the SPEC-CRWDQ-064 `AssetFetcher` boundary are substituted (INV-FACTORY-17).
