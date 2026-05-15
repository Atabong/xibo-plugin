---
spec_id: SPEC-CRWDQ-034
title: Widget v2 fixtures render template
status: draft
parent: S6
area: player-runtime/widget-v2/templates/fixtures
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
| Source files | `modules/widget-v2/src/render/PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts`, `modules/widget-v2/src/templates/fixtures/fixtures.html`, `modules/widget-v2/src/templates/fixtures/fixtures.css`, `modules/widget-v2/src/render/FixtureListStore.ts`, `modules/widget-v2/src/render/AssetManifestStore.ts`, `modules/widget-v2/tests/templates/fixtures/*.test.ts` |
| Blocked by | SPEC-CRWDQ-022 (WS client), SPEC-CRWDQ-033 (backend `PlannedState{fixtures}` emission) |

## Module

`player-runtime :: widget-v2 :: templates/fixtures` — the `fixtures` business-mode template (D-GRH-30 mode #3). Renders a card-list of upcoming fixtures with home/away team names, scheduled time in the bar-local timezone (D-GRH-73 `timezone`), sport badges resolved from `AssetManifest` (D-GRH-23). `status: "live"` fixture cards (D-GRH-20) get a visual flag. Time formatting honors `business_hours` semantics only insofar as it uses the same `timezone`. No live game data; this mode is the pre-game catalog.

## Current shape

- No fixtures rendering in v1. The MVP widget shows the live score panel only.
- `FixtureList` arrives over the WS as a game-data-channel frame per D-GRH-25 + D-GRH-18. There's no equivalent v1 path — the SSE stream never carried fixture data.
- Sport / league badge assets are not bundled in v1. The legacy widget showed team logos only (via SSE-supplied `logo_url`). v2 introduces an `AssetManifest`-cached badge set (D-GRH-23, D-GRH-08) keyed by sport + league identifier.
- Time zone handling in v1 is UTC display via `toLocaleString()`. v2 uses the bar's `timezone` (D-GRH-73) to format fixture times in bar-local — required because fixture cards show "today 7:30 PM" to bar patrons in their own frame of reference.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/fixtures/FixturesTemplate.ts
export interface FixturesTemplate {
  mount(host: HTMLElement, context: FixturesContext): FixturesInstance;
}

export interface FixturesContext {
  programSlot: ProgramSlot;        // fixture_ids[] non-empty
  themeId: string | null;
  timezone: string;                 // IANA, from active BarPreferences (D-GRH-73)
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesInstance {
  detach(): HTMLElement;
  /** Same D-GRH-13-style reconcile semantics: ProgramSlot revision with same program_slot_id swaps fixture_ids without re-mount. */
  reconcile(newSlot: ProgramSlot): Promise<void>;
}
```

```ts
// modules/widget-v2/src/render/FixtureListStore.ts
export interface FixtureListStore {
  /** Apply a FixtureList frame; per D-GRH-18 the new list REPLACES the cached set. */
  applyList(frame: FixtureListFrame): void;
  /** Resolve a fixture by fixture_id. Returns null if not in the current cached set. */
  resolve(fixtureId: string): Fixture | null;
  /** Subscribe to per-fixture mutations (status flips, scheduled_at edits). Returns unsubscribe. */
  subscribe(fixtureId: string, listener: (fixture: Fixture) => void): () => void;
}

export interface Fixture {
  fixture_id: string;
  game_id: string | null;          // populated when status ∈ {live, final} per D-GRH-20
  sport: string;
  league: string;
  home: { team_id: string };
  away: { team_id: string };
  scheduled_at: string;            // ISO 8601 UTC
  status: 'scheduled' | 'live' | 'final';
}
```

```ts
// modules/widget-v2/src/render/AssetManifestStore.ts
export interface AssetManifestStore {
  applyManifest(frame: AssetManifestFrame): void;
  /** Resolve an asset by content key (e.g., "badge:nfl", "team_logo:<team_id>"). Returns null on cache miss. */
  resolve(key: string): { url: string; contentHash: string } | null;
  /** Background fetch any missing assets in the manifest. No-op on assets already in cache. */
  ensureFetched(): Promise<void>;
}
```

### `fixtures` template DOM shape

```
<section class="crowdaq-fixtures" data-theme data-card-count>
  <header class="cdq-fixtures-header">
    <h2>Coming up</h2>
  </header>
  <ul class="cdq-fixture-list">
    <li class="cdq-fixture-card" data-fixture-id data-status="scheduled|live|final">
      <span class="cdq-sport-badge"><img alt="" src="<asset-url>"></span>
      <div class="cdq-teams">
        <span class="cdq-home"><img alt="" src="<home-logo>" class="cdq-team-logo"><span>HOME</span></span>
        <span class="cdq-vs">vs</span>
        <span class="cdq-away"><img alt="" src="<away-logo>" class="cdq-team-logo"><span>AWAY</span></span>
      </div>
      <time class="cdq-when" datetime="<scheduled_at-iso-utc>"><!-- bar-local formatted --></time>
      <span class="cdq-status" data-status="..."><!-- "Live" badge when applicable --></span>
    </li>
    <!-- ...one card per fixture_id in ProgramSlot.fixture_ids[] order -->
  </ul>
</section>
```

### Activation flow

For `PlannedState` with `mode: "fixtures"` and `program_slot_id: X`:

1. **Resolve `ProgramSlot`.** Shared resolver. `programSlot.fixture_ids[]` MUST be non-empty (empty fixture sets are a backend authoring error — D-GRH-22 says the backend always sends a non-empty slot; if empty, journal `template_input_invalid` and fall through to safe).
2. **Resolve fixtures.** For each `fixture_id` in order, `FixtureListStore.resolve(fixture_id)`. Missing fixtures (cache miss after `FixtureList` re-push) journal `fixture_cache_miss` and render a placeholder card (sport-neutral, "TBA").
3. **Resolve assets.** For each fixture, look up `assetManifestStore.resolve("badge:" + sport + ":" + league)` (sport badge) and `resolve("team_logo:" + team_id)` (home + away). Cache misses fall back to text-only initials per D-GRH-08 (lazy long-TTL pull is already in flight; manifest store handles it).
4. **Format times.** Each `scheduled_at` (ISO 8601 UTC) is formatted via `Intl.DateTimeFormat(undefined, { timeZone: context.timezone, ... })`. Display format: relative-day prefix ("Today", "Tomorrow", or weekday) + bar-local time. Day boundary is bar-local midnight in `context.timezone`.
5. **Status flag.** Cards where `fixture.status === "live"` get `data-status="live"` and a visible "LIVE" pill (per D-GRH-20).
6. **Run transition.** Default `slide_stagger_in` if catalog miss.
7. **Mount + subscribe.** For each rendered card, subscribe to `FixtureListStore.subscribe(fixture_id, ...)`. Subsequent `FixtureList` re-pushes update the in-place DOM (e.g., `status: "scheduled"` → `"live"` flips the pill on; `scheduled_at` edits re-format the time).
8. **Apply pending preferences.** Same boundary contract. If `pendingApply` carries a new `timezone`, the time formatter is rebuilt and all cards re-format on the next animation frame.
9. **Arm dwell.** Same `DwellTimer.arm(plannedState.dwell_target_ms)` semantics.

### Reconcile on `ProgramSlot` revision

D-GRH-13's add/remove story applies to fixtures, too — a revised `ProgramSlot` (same `program_slot_id`, different `fixture_ids[]`) triggers `reconcile(newSlot)`:

- Diff old vs new `fixture_ids`. Card removals: exit transition (`card_slide_out`), unsubscribe. New entries: enter transition (`card_slide_in`), subscribe. Surviving cards reorder via DOM moves.
- Dwell timer NOT reset.
- Journal `fixtures_reconciled` with `added`, `removed`, `reordered`.

### Bar-local time formatting rules

Per D-GRH-17 the fixture displays only home, away, scheduled time, league, sport — no venue, no broadcast channel. The time formatting rule:

| Bar-local date relative to bar-local "now" | Display |
|--------------------------------------------|---------|
| Same calendar day | `"Today 7:30 PM"` |
| Next calendar day | `"Tomorrow 7:30 PM"` |
| 2..6 days ahead | `"Sat 7:30 PM"` |
| ≥ 7 days ahead (within 7-day lookahead window per D-GRH-18) | `"May 21 7:30 PM"` |

Local-format locale is derived from the `Intl.DateTimeFormat` browser default; the bar `language` preference is not in D-GRH-73 scope so we don't override locale. Re-formatting is triggered on `timezone` change at the next dwell boundary (via `pendingApply`).

### `status: live` visual interplay

A fixture flagged `live` indicates the game is being recorded (D-GRH-19) and `game_id` is now non-null. The fixtures template renders the LIVE pill but does NOT pull `GameState` data — it stays a fixture card. Display of the live score is the job of the `fixtures_with_live_game` mode (a separate template not in this slice's scope) or of `single_game`/`multiple_games` once the backend transitions the slot. The fixtures template is the pre-game / mixed-state catalog only.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `DwellTimer`, `TransitionExecutor` | 1 in-process | Real shared instances. |
| `FixtureListStore`, `AssetManifestStore` | 1 in-process | Real instances; driven via frame-injection test driver. |
| DOM | 1 in-process | jsdom. |
| `Intl.DateTimeFormat` | 1 in-process | Real call; jsdom supports IANA TZ. |
| Asset URL fetching | system boundary | Asset URLs are never actually fetched in unit tests; `AssetManifestStore.resolve` returns cached `url` strings; `ensureFetched()` is stubbed to resolve immediately. End-to-end fetching exercised by SPEC-CRWDQ-027 e2e. |
| Time | system boundary | Fake `Date.now()`; clock pinned to a known UTC instant. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Happy mount: `fixture_ids: ["fA","fB","fC"]` all resolve from cache → 3 cards, sport badge + team logos rendered, times formatted in `America/Chicago`.
- Bar-local "Today" vs "Tomorrow" vs weekday vs "May DD": pin clock to known UTC; assert each card's `time` text.
- Live status pill: `fA.status = "live"` → `data-status="live"` and visible LIVE pill on that card only.
- Empty `fixture_ids`: journal `template_input_invalid`; no mount.
- Fixture cache miss: `fixture_ids: ["fA","fGHOST"]` where `fGHOST` not in store → first card renders fully; second card shows "TBA" placeholder; journal `fixture_cache_miss`.
- Asset cache miss for badge: `assetManifestStore.resolve("badge:nfl:NFL")` → null → card shows sport name text fallback per D-GRH-08; `ensureFetched()` invoked once.
- `FixtureList` re-push: `fA.status` flips from `scheduled` → `live`; in-place DOM update, no re-mount, no transition.
- Timezone change at boundary: `pendingApply` arrives with `timezone: "America/New_York"`; dwell boundary; cards re-format. Journal `template_locale_refresh`.
- Reconcile add: `fixture_ids: ["fA","fB"]` → `["fA","fB","fC"]` → exit/enter sequence; dwell NOT reset.
- Reconcile remove: `["fA","fB","fC"]` → `["fA","fC"]` → exit `fB`; survivor `fC` moves.
- Supersede to single_game (different `state_id`): standard supersede path; detach unsubscribes all `FixtureListStore` subscriptions.

## Vocabulary

- `fixtures` mode — D-GRH-30 #3.
- `FixtureList`, `Fixture.status` — D-GRH-18, D-GRH-20.
- `AssetManifest` — D-GRH-23.
- `timezone` — D-GRH-73 IANA-validated bar preference.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-022 — WS + Dispatcher + frame routing for `FixtureList`, `AssetManifest`, `PlannedState`, `ProgramSlot`.
- SPEC-CRWDQ-023 — shared orchestration: `PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`.
- SPEC-CRWDQ-033 — backend `PlannedState{fixtures}` emission with non-empty `fixture_ids[]`.

**Blocks (downstream):**

- SPEC-CRWDQ-041 — `fixtures_with_ads` composite reuses this list and adds the ad panel.

## Acceptance Criteria

- [ ] `FixturesTemplate.mount(host, ctx)` renders `<section class="crowdaq-fixtures">` containing one `<li class="cdq-fixture-card" data-fixture-id data-status>` per `fixture_id` in `ProgramSlot.fixture_ids[]` order.
- [ ] Per D-GRH-17, each card displays home team, away team, scheduled time in bar-local TZ, league, sport — and no venue, no broadcast channel.
- [ ] `scheduled_at` is formatted via `Intl.DateTimeFormat` with `timeZone = context.timezone`; relative-day prefix follows the Today/Tomorrow/weekday/MMM-DD table.
- [ ] Cards with `fixture.status === "live"` carry `data-status="live"` and a visible LIVE pill; `scheduled` / `final` do not.
- [ ] Empty `fixture_ids[]` journals `template_input_invalid` and does not mount (escalation owned by SPEC-CRWDQ-052).
- [ ] Cache miss on a `fixture_id` renders a "TBA" placeholder card and journals `fixture_cache_miss`; cache miss on a badge or team logo asset falls back to text (D-GRH-08) and triggers `assetManifestStore.ensureFetched()` exactly once per mount.
- [ ] In-place updates: a `FixtureList` re-push that flips `status` or edits `scheduled_at` mutates the existing card's DOM without re-mount, no transition runs.
- [ ] `reconcile(newSlot)` diffs `fixture_ids` and adds/removes/reorders cards in place with enter/exit transitions, dwell timer NOT reset.
- [ ] `pendingApply` with a new `timezone` triggers a re-format of all rendered cards at the next dwell boundary; journal `template_locale_refresh`.
- [ ] No `GameState` subscription anywhere in this template — fixtures mode is pre-game catalog only, live-game data is a separate mode.
- [ ] Tests cover all enumerated cases; no mocks of shared orchestration or stores (INV-FACTORY-16); only the clock and asset-fetch boundary are substituted.
