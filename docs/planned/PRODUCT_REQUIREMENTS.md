# CROWDAQ Dynamic Layout Product Requirements Document

Last updated: 2026-05-15

> Status: **planned / target architecture**.
>
> This document defines the future backend-orchestrated dynamic layout platform and should not be read as the description of the currently implemented single-widget SSE system.
>
> For the current implementation, see `../../README.md`, `../current/ARCHITECTURE.md`, `../current/OPERATIONS.md`, `../current/TARGETING.md`, and `../current/contract/`.
>
> See `../index.md` for the documentation map.

## Purpose

This document defines the product requirements for the CROWDAQ dynamic layout system across:

- backend orchestration
- bar player runtime
- central admin UI

It is intended to be the source document used to derive:

- system specs
- implementation specs
- vertical slices
- sequencing plans
- role/permission expansions in later phases

This PRD deliberately captures not only desired features, but also the design rules, control flow, orchestration model, and explicit decisions already made.

Related documents:

- `docs/planned/DYNAMIC_LAYOUT_REQUIREMENTS.md`
- `docs/planned/DYNAMIC_LAYOUT_DECISIONS_LOG.md`
- `docs/current/ARCHITECTURE.md`
- `docs/current/TARGETING.md`
- `docs/current/OPERATIONS.md`

## Product Summary

CROWDAQ should evolve from a single-match Xibo widget into a backend-orchestrated dynamic sports presentation system for bar screens.

The system must:

- choose and orchestrate screen states server-side
- deliver exact planned states to the bar player
- support multiple layout modes and multiple templates per mode
- combine sports content, fixtures, ads, recap layers, and venue messaging
- support resilient offline-safe behavior
- preserve a strong operational model when connectivity or rendering fails

The bar player is not the primary orchestration engine in normal operation. The backend is.

The bar player is primarily:

- a plan execution client
- a cache/runtime
- a local journaler/sync client
- a safe-mode fallback client

## Goals

### Primary goals

- Deliver a premium, dynamic sports screen experience for bars.
- Allow central admin to drive rule-based programming with scoped overrides.
- Support sports-led, fixtures-led, recap-led, and ad-supported experiences.
- Keep the player reliable even during backend or asset failures.
- Capture enough execution telemetry and local journal state to support recovery, auditability, and later analytics.

### Secondary goals

- Support automatic layout variation without requiring heavy manual authoring.
- Make future role expansion possible without locking the system into a central-admin-only design forever.
- Preserve enough structure that specs and vertical slices can be carved out cleanly later.

## Non-Goals For This Build

- Bar-admin schedule control
- Bar-admin ad publishing
- Full multi-role content authoring permissions
- Player-side AI inference or summarization
- Player-side primary orchestration of normal connected operation

## User / Role Model

## In-scope role

### Central Admin

Central admin owns:

- content priority rules
- schedule authoring
- business-mode planning
- template selection rules
- ad windows and ad policies
- scoped overrides
- venue grouping logic
- market/team/sport emphasis
- messaging-lane content injection

## Out-of-scope role for this build

### Bar Admin

Bar admin is not in scope for this build.

Bar admin must not be able to:

- modify the schedule
- control orchestration
- choose sports modes
- select or edit business-mode transitions

Possible future bar-admin scope:

- venue announcement messages
- local specials / happy hour messaging
- limited content injection into a separate messaging lane

That future role model must be designed separately and should not distort v1.

## System Overview

The product consists of three major systems:

1. Backend orchestration system
2. Bar player runtime
3. Central admin authoring UI

### Backend responsibilities

- build the schedule
- choose the content priorities
- choose business modes
- choose exact layout/template
- choose transition variant
- choose dwell target
- merge ad windows into planned states
- emit explicit planned screen states to players
- classify major sports moments
- classify exceptional overrides from trusted sources
- publish schedule-change hashes and updated schedules
- receive player heartbeat and journal sync

### Bar player responsibilities

- receive and execute planned states
- render the exact requested template when available
- cache schedules, ads, and other required assets
- journal execution locally
- sync journal state back to the backend
- enter and exit safe behavior on local failures and connectivity problems
- apply local fallback rules when the exact planned state cannot execute

### Central admin UI responsibilities

- author and manage rule-driven scheduling
- define scopes and overrides
- inject planned changes
- manage content priorities
- manage ad windows and ad policy
- manage layout and template selection where appropriate
- manage venue targeting hierarchy

## Core Product Model

## Business Modes

The official v1 business modes are:

1. `single game`
2. `multiple games`
3. `fixtures`
4. `single game with ads`
5. `multiple games with ads`
6. `fixtures with ads`
7. `fixtures with live game`
8. `fixtures with live game and ads`

These are product/business modes, not individual geometry templates.

### Important mode rules

- Ad-present modes are distinct business modes.
- `recent game summary / highlights / analysis` is not a business mode.
- Recap/highlights are content or temporary layer behavior, not an official mode.

## Geometry / Template Families

Each business mode may have multiple geometry templates.

These templates exist before theme styling is applied.

### Minimum v1 template counts

- `single game`: minimum 3
- `single game with ads`: minimum 3
- `fixtures`: minimum 3
- `fixtures with ads`: minimum 3
- `multiple games`: minimum 3
- `multiple games with ads`: minimum 3
- `fixtures with live game`: minimum 3
- `fixtures with live game and ads`: minimum 3

### Additional template rules

- `single game` may vary strongly in both game-panel and support-panel character.
- `fixtures` should be mostly list/layout variation, with at least one editorial/showcase-oriented template.
- `multiple games` must include:
  - at least one balanced/even template
  - at least one hero-led template
- `fixtures with live game` is fixtures-led by default, but at least one template may elevate the live game much more strongly.
- Every `with ads` business-mode family must include at least one clearly ad-led template.

### Single-game template content requirements

All `single_game` and `single_game_with_ads` templates must include:

- **ScoringTimeline**: chronological scoring event log with run detection
- **ExcitementChart**: excitement curve (0–100 over normalized game time) with key moments strip

For `single_game_with_ads`: ad unit must occupy its own layout region and may not displace either component. All three must coexist in the template geometry.
- `fixtures_with_live_game` featured game panel inherits the full `single_game` panel component set (ScoringTimeline, ExcitementChart, ExcitementMeter, all live-signal components). Fixture cards are additive context — no scoring timeline, no excitement chart, no live signals. Layout must accommodate featured game panel alongside fixture card list. (D-GRH-05)
- Live ticker is an optional operator-configured layout slot. No template requires it. When present, it occupies a dedicated region and does not displace game panel components, fixture cards, or ad units. Ticker content follows bar-level sport/league filter preferences. (D-GRH-06)
- Badge display scales to layout context: full size + full animation in single-game panels; reduced size + suppressible animation in multi-game cards; reduced size + animation suppressed (hard rule) in fixtures+multiple-games contexts. Fixture cards (pre-game) carry no badges. (D-GRH-07)
- Team metadata (name, abbreviation, colors, logo) is a static asset with long TTL. `GameState` carries `team_id` only; player resolves to cached team metadata, fetching from backend on first cache miss. No special protocol message. (D-GRH-08)
- `sport_context` in `GameState` carries a fixed, sport-specific field set (protocol contract per sport, same pattern as named signals). Player templates are sport-aware. Reference schemas: basketball (`period`, `clock`, `possession`, `bonus`), soccer (`half`, `stoppage_time`, `added_time`), baseball (`inning`, `top_bottom`, `outs`, `bases`). (D-GRH-09)
- Badge rendering is payload-driven: player uses `icon`, `color`, `name`, `short_description` from the badge object. Animation style derived from `category` (fixed set: excitement/momentum/clutch/chaos/upset/historical/performance/domination). No local badge catalog required; new badge IDs need no player update. (D-GRH-10)
- Badge definitions, badge icons, and team logos are authored and managed by the backend (intentional backend ownership). Player is consumer only. All asset delivery uses the same mechanism: lazy pull on cache miss, long TTL (extends D-GRH-08). Backend must ensure assets are available before serving payloads that reference them. (D-GRH-11)
- All game data messages (`GameState`, `GameEvent`, `DisplayEvent`) delivered on a single multiplexed JSONL stream. Each message carries `game_id`. Player fans out internally. No N-stream-per-game connections. (D-GRH-12)
- Game card add/remove in multi-game modes: backend sends updated `PlannedState` with new game list. Player recomposes from `PlannedState` — does not self-manage card set. All layout decisions are orchestrator-driven. (D-GRH-13)
- Multi-game card order is backend-decided: `PlannedState.game_ids` is an ordered list; player renders in that order with no local sort. Backend re-sends `PlannedState` when order changes. (D-GRH-14)
- `PlannedState.game_id` (singular) is superseded by `PlannedState.game_ids` (ordered array, always present). Single-game modes send a one-element array. Player iterates uniformly. (D-SCHEMA-20, amends D-SCHEMA-01)
- `multiple_games_with_ads`: ad unit occupies a dedicated layout region always visible alongside the game card grid. Ad does not replace or rotate into any game card slot. Consistent with `single_game_with_ads` coexistence rule. (D-GRH-15)
- Uniform ad coexistence rule across all with-ads modes: ad unit always in dedicated region, never displaces game cards, fixture cards, or game panel components. Applies to `single_game_with_ads`, `multiple_games_with_ads`, `fixtures_with_ads`, and any future with-ads variant. (D-GRH-16)
- Fixture card required fields (v1): home team, away team, scheduled datetime, league, sport (team resolved from asset cache). Venue and broadcast excluded (no value). Odds/prediction signals deferred — no backend prediction infrastructure yet. (D-GRH-17)
- Fixture data delivered as `FixtureList` message on the game data channel (not embedded in `PlannedState`). Backend pushes on change. Lookahead: 7 days. Scope: all fixtures matching bar's sport/league preferences, not day-bounded. Player caches by `fixture_id`; `PlannedState` references by ordered `fixture_ids`. (D-GRH-18)
- **D-GRH-19** (Being recorded / ingest scope): "Being recorded" means CROWDAQ backend is actively capturing the live game's data stream. A game can be live but not recorded — it stays a static fixture entry with no live scores. `game_ids` in `PlannedState` only contains games that are live AND recorded. `multiple_games` mode requires multiple recorded live games. Ingest scope is a backend configuration concern, independent of fixture scheduling. Whether `FixtureList` entries need an explicit live-data-available flag is a pending open question.
- **D-GRH-20** (FixtureList entry status + game_id): Each FixtureList entry carries `status` (`scheduled|live|final`) and `game_id` (null when scheduled, populated when live or final). Player uses `status` to decide whether to render a live-score indicator on a fixture card. Player uses `game_id` to correlate fixture card with active GameState stream. Backend sets `status=live` only when CROWDAQ is actively recording the game (D-GRH-19). Amends D-GRH-18 FixtureList entry schema.
- **D-GRH-21** (2026-05-11): ProgramSlot is authoritative for content selection (game_ids, fixture_ids, primary_game_id). PlannedState references ProgramSlot via program_slot_id only — no game_ids directly on PlannedState. Retracts D-SCHEMA-20.
- **D-GRH-22** (2026-05-11): Backend responsible for full schedule coverage. No unscheduled windows from player perspective. Backend synthesizes gap-filling PlannedState (fixtures, ambient, or safe_info mode) for any uncovered window. Schedule gaps are backend authoring errors, not player edge cases.
- **D-GRH-23** (2026-05-11): All theme assets (fonts, color tokens, textures, badge icons, ad frames) delivered via AssetManifest control channel push. Player caches on receipt, fetches before first render. Runtime-updatable without widget redeploy. Cache invalidation via version bump in AssetManifest.
- **D-GRH-24** (2026-05-11): Override triggers: (1) game lifecycle transition (scheduled→live, live→final), (2) backend excitement threshold crossing, (3) human operator trigger via admin UI. Overrides bypass dwell gate. Backend coalesces rapid signals before emitting — player does not debounce.
- **D-GRH-25** (2026-05-11): Amends D-SCHEMA-19 message taxonomy — adds FixtureList and DisplayEvent to game data channel. Full authoritative post-amendment taxonomy recorded in decisions log.
- **D-GRH-26** (2026-05-11): Ambient = 9th business mode. Gap-filling: sponsor loops, venue branding, neutral branded content. Own template family required. Dwell indefinite (no timer). Content model TBD in D-GRH-27.
- **D-GRH-27** (2026-05-11): Ambient content model = AssetManifest-driven template assets only. No ProgramSlot or AdSlot on ambient PlannedState. dwell_ms null (indefinite). Asset updates via AssetManifest push — no PlannedState change needed. Resolves D-GRH-26 open question.
- **D-GRH-28** (2026-05-11): All template HTML/CSS/JS pre-baked in Xibo widget bundle. New template = widget redeploy via Xibo CMS. Theme assets and branding content delivered separately via AssetManifest (D-GRH-23) — no redeploy needed for asset updates.
- **D-GRH-29** (2026-05-11): Journal writes all events — render activations, ad impressions, overrides, fallback enter/exit, game state/event receipts, asset fetches, connectivity gaps, heartbeat mismatches, config pushes, device registration, journal sync sends. Backend filters/aggregates. Player does not filter.
- **D-GRH-30** (2026-05-11): Mode taxonomy finalized — 9 explicit modes: single_game, multiple_games, fixtures, fixtures_with_ads, single_game_with_ads, multiple_games_with_ads, fixtures_with_live_game, safe, ambient. All modes backend-emitted. Safe mode also player-triggered on connectivity loss (D-SAFE-01 unchanged). Amends D-GRH-26.
- **D-GRH-31** (2026-05-12): DisplayEvent schema defined. Backend prescribes animation via animation_id (catalog name or AssetManifest asset_id). Pre-baked animation catalog in widget; extensible via movement-definition assets in AssetManifest (Lottie/CSS keyframes — not images). Badge cues included (cue_type: badge, badge_id in payload). Player enforces no-flash constraint on all animations. Amends D-GRH-23 to include animation assets in AssetManifest scope.
- **D-GRH-32** — Late-join gamestate recovery: two-phase snapshot + delta; recording container holds live GameState projection; player requests or receives snapshot on connect, then receives GameEvent deltas; GameStateRequest available for explicit pull.
- **D-GRH-33** — Message broker is NATS JetStream (not Kafka); ~60 events/sec workload does not justify Kafka's operational overhead; NATS JetStream provides durable streams, replay, consumer groups, fan-out with single Go binary.
- **D-GRH-34** — Recording layer uses Temporal workflows (one per game_id): durable GameState projection, PublishGameEvent activity publishes to NATS JetStream; Temporal and NATS are separate services; GameStateRequest maps to Temporal Query; supersedes "recording container" terminology in D-GRH-32.
- **D-GRH-35** — GameScheduler service: aggregates bar preferences, filters fixtures, starts Temporal workflows at scheduled_at minus configurable lead time (default 15–30 min); accepts manual operator recording requests; maintains local durable schedule snapshot for DB-outage resilience. Amended by D-GRH-72: recording-trigger path is rule-driven (cover-rule scan), not bar-preferences aggregation.
- **D-GRH-36** — Bar preference change detection: event-driven primary (BarPreferencesChanged via NATS, both players and GameScheduler subscribe) + hash-based reconciliation on startup/DB reconnect; same per-bar hash used for player ConfigPush and GameScheduler consistency check; GameScheduler operates on local state during DB outage. Amended by D-GRH-72: coverage selection is rule-driven; bar-preferences no longer aggregated for recording-fanout.
- **D-GRH-37** — Bar preference profiles stored in central CROWDAQ DB (no dedicated service); thin write hook publishes BarPreferencesChanged to NATS; consumers query DB directly.

> Two-tier model post-D-GRH-71: `BarPreferences` carries static identity (theme, sports, leagues, region, timezone, business hours, local-team list, state, city); `Rule` entities carry conditional behavior (cover/weight/ad_window) layered on top.

- **D-GRH-38** — GameDeliveryService subscribes to all game.*.events subjects and filters per player at delivery; no per-player selective subscriptions.
- **D-GRH-39** — GameDeliveryService maintains in-memory GameState projection per active game_id; primary late-join path is warm cache delivery; Temporal Query is cold-start fallback only; supersedes D-GRH-32 primary snapshot path.
- **D-GRH-40** — BarPlayerSchedulerService generates full pre-computed schedule per bar (24h/week horizon); inputs: bar preferences, fixtures, rules-based local team weighting (numeric score), ad inventory, manual override; full reprocess on any game lifecycle event; delivers ScheduleWindow to players; supersedes "schedule service" references.
- **D-GRH-41** — BarPlayerSchedulerService storage: DB hot tier (yesterday/today/tomorrow, admin-injectable) + disk journal (compressed 30-day archive); Temporal workflow only, no TCP server; delivers ScheduleWindow via GameDeliveryService over single player connection; two-connection model retracted.
- **D-GRH-42** — GameDeliveryService is a Go process (not Temporal); single WebSocket connection per player; JSONL wire format (one JSON object per line, message_type field); multiplexes game data + schedule + all control messages; goroutine per connection; horizontally scaled by bar_id.
- **D-GRH-43** — All player-to-backend communication over Tailscale tailnet (WireGuard); no application-level auth on WebSocket connection; player sends display_id in handshake; GameDeliveryService resolves bar_id from central DB.
- **D-GRH-44** — FixtureSyncService polls external sports API for fixture list + status; two-tier cadence (daily for >24h out, every 60s same-day); publishes FixtureStatusChanged to NATS on transition; normalizes to CROWDAQ schema; vendor TBD.
- **D-GRH-45** — Temporal recording workflow connects independently to live event push stream (WebSocket/SSE) per game_id; separate from FixtureSyncService (different transport + data concern); ingests events, maintains GameState projection, publishes GameEvent to NATS.
- **D-GRH-46** — Live stream disconnection recovery: Temporal retries `ConnectLiveStream` activity with backoff (self-healing); simultaneously signals GameDeliveryService to mark game data stale so bar players show last-known state with "data unavailable" indicator until stream recovers
- **D-GRH-47** — Rules system: condition+action model (condition = match criteria, action = weight delta or layout override); priority-ordered list, first match wins; scope hierarchy global → state/region → bar; bar-level rules override upward; local team assignment expressed as a bar-scoped rule
- **D-GRH-48** — Channel architecture: one physical WebSocket connection per player; "control channel" and "game data channel" are logical distinctions via `message_type` discriminator, not separate physical connections; two-connection model retracted (D-GRH-41); ~180 events/min creates no backpressure justifying dual connections
- **D-GRH-49** — Player reconnect re-sync: server-initiated full re-push on reconnect (ConfigPush + ScheduleWindow + active PlannedStates + GameState snapshots + AssetManifest); player is passive; GameStateRequest handles delta gaps post-reconnect; DeviceRegistration only on first connect, not every reconnect
- **D-GRH-50** — PlannedState transition object: `{ animation_id, duration_ms }`; flat catalog name (same catalog as D-GRH-31 DisplayEvent); no phase breakdown in v1; transition required on every PlannedState; backend always supplies named variant
- **D-GRH-51** — Theme resolution: compiled CSS file per theme_id delivered via AssetManifest; player swaps stylesheet on PlannedState render; backend owns token→CSS compilation; theme_id three-state rule applies (explicit string / null=bar default / __unset__=system default)
- **D-GRH-52** — Journal sync transport: HTTP POST to `/journal/sync` (not WebSocket); gzip-compressed JSONL batch; server ACKs seq range; WebSocket reserved for latency-sensitive orchestration; Tailscale provides auth (D-GRH-43)
- **D-GRH-53** — GameDeliveryService scaling: full NATS subscription on every instance, no bar_id affinity; any instance serves any player; standard connection load balancing; amends "horizontally scaled by bar_id" wording in D-GRH-42
- **D-GRH-54** — BarPlayerSchedulerService build triggers: game lifecycle event, BarCreated (new bar device), BarPreferencesChanged (config change, D-GRH-36), service restart bootstrap scan, daily cron reconciliation; all triggers produce full reprocess; rapid-fire triggers coalesced per bar
- **D-GRH-55** — Ad creative delivery: phase 1 `AdSlot.ad_ref` = AssetManifest `asset_id` (offline-safe, pre-fetched); external URL support deferred to phase 2/3 when bar-level/self-service ads require it; `ad_ref_type` discriminator added when extended
- **D-GRH-56** — OverrideInjection schema: PlannedState fields + `fires_at`; player queues and executes at fires_at; asset pre-fetch via separate AssetManifest with `needed_by` = fires_at; no embedded asset instructions in override message
- **D-GRH-57** — MessagingLane content model: text-only (text, display_form, dwell_ms, valid_from, valid_until); no asset dependency; independent overlay layer, does not affect PlannedState or business mode; central admin authors; same lane_id = replace prior message
- **D-GRH-58** — Player rendering priority stack: OverrideInjection (highest, full-screen, suppresses all MessagingLanes during dwell) > PlannedState (base layer from ScheduleWindow) > MessagingLane (overlay on PlannedState only); suppression binary — no per-override flag; lanes auto-resume after override dwell via validity window
- **D-GRH-59** — Heartbeat: bidirectional app-level; player sends `Heartbeat` (seq) every 30s, server responds `HeartbeatAck` (seq); player reconnects if no ack within 60s; server closes + emits PlayerDisconnected if no heartbeat within 90s; heartbeat carries no payload beyond display_id + seq
- **D-GRH-60** — ConfigPush content: bar profile snapshot (bar_id, display_id, preferences{theme_id, sports, leagues, region}, config_hash); sent on reconnect re-push, DeviceRegistration, and standalone on BarPreferencesChanged; rules not included — server resolves, player consumes resolved output only; config_hash ties to D-GRH-36 drift detection. Extended by D-GRH-73: BarPreferences gains `state` and `city` fields (locked-enum scope keys for region-level rules).
- **D-GRH-61** — DeviceRegistration handshake: player sends `DeviceRegistration` (display_id, player_version, capabilities) on every connect (first + reconnect); server responds with full re-push sequence directly (ConfigPush → ScheduleWindow → AssetManifest → PlannedStates → GameStates); no RegistrationAck; ConfigPush serves as implicit ack; capabilities reserved for future negotiation
- **D-GRH-62** — Ad window timing: AdSlot is first-class PlannedState slot in ScheduleWindow (fires_at, dwell_target_ms, business_mode="ad", ad_ref); ad timing pre-computed server-side by BarPlayerSchedulerService; player executes schedule — no ad-insertion logic, no AdWindowOpen/Close messages
- **D-GRH-63** — GameStateRequest: player-to-server mid-connection seq gap recovery only (not used on reconnect — D-GRH-49 full re-push covers that); player detects seq gap in active game stream, sends GameStateRequest(game_id, since_seq); server responds with GameStateSnapshot (full snapshot in v1); amends D-GRH-49 "post-reconnect" wording
- **D-GRH-64** — PlayerDisconnected: GameDeliveryService emits PlayerDisconnected to NATS on heartbeat timeout or WS close; no active server reconnect; no schedule pause; player self-reconnects (D-GRH-59/D-GRH-61); ops monitoring consumes event for dead-screen alerting
- **D-GRH-65** — NATS delivery semantics: JetStream for ALL subjects (game.*.events → GAME_EVENTS stream; bar.*.control → BAR_CONTROL stream); shared durable competing consumers; Core NATS not used; single operational model; retention game+2h / 24h respectively; clarifies D-GRH-33
- **D-GRH-66** — BarPlayerSchedulerService Temporal topology: singleton workflow (ID: bar-player-scheduler); manages all bars; internal map of bar_id→ScheduleWindow; signals: BarCreated, BarPreferencesChanged, GameLifecycleEvent, DailyCron; Continue-as-New on daily cron pass; Temporal Query GetScheduleWindow(bar_id); clarifies D-GRH-41
- **D-GRH-67** — `PlayerConnected` NATS event emitted on every `DeviceRegistration` receive on `bar.<bar_id>.control`; `reconnect` bool distinguishes first connect from reconnects; symmetric with `PlayerDisconnected` (D-GRH-64); ops monitoring only in v1.

### Automatic template switching

Automatic template switching within the same business mode is allowed.

It should be:

- gated
- dwell-sensitive
- allowed to fully recompose
- influenced by content, ad timing, and schedule rules

Mode changes should generally be more stable than template changes.

## Themes

The overall system should support up to 5 themes.

Themes are system-level presentation systems, not just color swaps.

Themes may influence:

- color
- typography
- spacing density
- panel treatment
- motion tone
- badge styling
- ad framing
- hierarchy emphasis

Theme behavior is important, but detailed theme definition is not the focus of this PRD section.

## Motion and Transition Principles

The system must support rich visual behavior, but:

- no flashing of any type

Allowed visual language includes:

- fades
- slides
- wipes/reveals
- card reshuffles
- morphs/recompositions
- stacked transitions
- transforms
- positioning changes
- layered motion

### Transition requirements

- transitions must exist between all business modes
- multiple transition choices should be supported for the same high-level state change
- backend should deliver exact transition variant in normal planned execution

### Mode-pair transition rules

- All transitions between different business modes are **full recompose**. The DOM/layout is fully rebuilt on every mode change.
- Each business mode is a distinct template family. There is no single mega-template with conditional view-states. `fixtures`, `fixtures_with_ads`, and `fixtures_with_live_game` are separate templates, not view-state forks.
- In-mode template switching (same `business_mode`, different `template_id`) should **preserve shared structural elements** (score panels, team logos, league headers) where possible. Full recompose within a mode only when the two templates share no structural elements.

## Ad Model

## Ad classes

The minimum v1 visual ad taxonomy is:

1. `ambient branding`
2. `competitive in-layout ad unit`
3. `interstitial ad beat`

### Ad class behavior

`ambient branding`
- small sponsor bug / logo / presented-by mark / branded frame treatment
- does not change business mode

`competitive in-layout ad unit`
- meaningfully competes with sports content
- triggers `with ads` business modes

`interstitial ad beat`
- occurs between content states
- outside the business-mode system

### Additional ad rules

- Full-screen or special ad behavior should remain normal ad-window behavior with override metadata, not a separate ad class and not exceptional override.
- Ad windows may merge with scheduled content states.
- If a scheduled change and ad-window entry coincide, backend should normally produce the target state’s `with ads` counterpart.

Example:
- scheduled target: `fixtures`
- ad window opens
- result: `fixtures with ads`

Unless:
- ad metadata requires a specific template
- ad metadata requires a stronger override presentation

## Post-Game Recap Layer

The short post-game result/recap beat is:

- not a business mode
- a reusable transition layer

### Post-game recap layer rules

- shared structural concept across the system
- richer recap card in v1
- dwell target roughly 20-40 seconds
- blocks ads entirely while active
- after completion, control returns to fresh evaluation rather than blindly resuming prior schedule state

It may be bypassed only by truly exceptional higher-priority situations.

## Interrupt / Change Model

## Interrupt classes

Working v1 interrupt classes:

1. `ordinary change`
2. `scheduled change`
3. `enter ad-window`
4. `exit ad-window`
5. `major sports moment`
6. `exceptional override`
7. `enter post-game recap layer`
8. `exit post-game recap layer`

### Meaning of classes

`ordinary change`
- reactive execution/lifecycle changes
- examples:
  - end of game
  - error recovery
  - end of ad-window
  - end of major sports moment
  - return from temporary layer

`scheduled change`
- deliberate programmed change into another planned presentation state

`enter ad-window`
- entry into ad timing window

`exit ad-window`
- exit from ad timing window and hand-back to normal precedence

`major sports moment`
- explicit backend classification in normal operation

`exceptional override`
- explicit backend/trusted-control classification in normal operation
- also allowed locally for local-only failures/connectivity problems

`enter post-game recap layer`
- entry into reusable post-game recap layer

`exit post-game recap layer`
- exit from recap layer and hand-back to normal precedence

## Precedence

The working automatic precedence order is:

1. `exceptional override`
2. `enter ad-window`
3. `major sports moment`
4. `scheduled change`
5. `enter post-game recap layer`
6. `ordinary change`

Excluded from the ranked stack:

- `exit ad-window`
- `exit post-game recap layer`

They hand control back to normal precedence.

## Dwell / Interrupt Rules

### Dwell rules

- Business-mode change minimum dwell: **15 seconds**. Backend will not emit a `PlannedState` with a different `business_mode` until the current mode has been active for at least 15s.
- In-mode template switch minimum dwell: **8 seconds**. Backend will not emit a `PlannedState` with the same `business_mode` but a different `template_id` until 8s have elapsed.
- `with ads` mode template switch gate: **max(8s, ad `min_dwell_ms`)**. No separate fixed floor; the ad `AdSlot.policy.min_dwell_ms` and the 8s minimum both apply — the higher wins.
- Mode changes are more stable than template changes by design.

### Interrupt rules

- Almost nothing should break mode dwell immediately.
- Major sports moments may break mode dwell.
- Interstitial ad beats may break dwell only if schedule explicitly calls for it.
- Timed manual lock holds no matter what.
- Ad-preemption behavior is broad in normal orchestration.

## Exceptional Override Boundaries

`exceptional override` must remain a small explicit class.

It is for:

- sports/programming emergencies
- serious system/error recovery
- trusted compliance/regulatory actions
- operator emergency takeover
- severe local execution failure
- severe connectivity breakdown

It is not for:

- ordinary content highlights
- normal ad behavior

A truly huge sports moment is still `major sports moment`, not `exceptional override`.

## Safe Templates and Fallback Model

## Cross-mode safe templates

The first implementation set of cross-mode safe templates is exactly:

1. `safe info layout`
2. `safe fixtures layout`
3. `safe message/fallback layout`

### Selection rules

Preferred safe order:

1. `safe fixtures layout` if valid cached fixtures exist
2. `safe info layout`
3. `safe message/fallback layout`

### Content rules

`safe fixtures layout`
- cached schedule-based content only

`safe info layout`
- may include neutral operational context such as:
  - date/time
  - venue identity
  - next scheduled block
  - tournament label

`safe message/fallback layout`
- reserved for explicit degraded/interruption communication

### Branding rule

- exceptional-override behavior defaults to zero sponsor/ad presence unless explicitly permitted

### Safe template motion rules

Safe templates (`safe_info_layout`, `safe_fixtures_layout`, `safe_message_fallback_layout`) use conservative motion only:

- Allowed: fade, simple slide
- Not allowed: recompositions, layered motion, stack/collapse transitions, theme-driven animation tone

Safe templates are visually distinguishable from normal operation to aid ops monitoring and avoid masking degraded state.

## Server Orchestration Model

The backend is the normal orchestration engine.

### Backend scheduling model

- schedule is built server side
- transitions from screen to screen are orchestrated server side
- schedule is primarily selection priority of game content
- presentation rules drive how highlighted content is shown

Examples of highlight-driving content:

- Super Bowl
- World Cup
- local-team priority
- tournament-specific focus

### Admin influence

- admin may select layout when possible
- otherwise backend chooses defaults
- backend resolves local-team and market rules server side before delivering a state plan

## Planned State Payload

For each planned screen state, the backend should deliver:

- exact business mode
- exact selected content
- exact layout/template
- explicit state identifier/version
- explicit transition instruction
- exact transition variant
- intended dwell target

The player should execute the exact plan when possible.

## Bar Player Runtime Requirements

## Rendering Priority Stack

Three priority layers, highest to lowest (D-GRH-58):

1. **OverrideInjection** — full-screen, highest priority; suppresses all `MessagingLane` overlays for its entire dwell; suppression binary (no per-override flag); lanes auto-resume after override dwell via validity window
2. **PlannedState** — base layer from `ScheduleWindow`; normal scheduled content
3. **MessagingLane** — overlay on `PlannedState` only; suppressed during any active `OverrideInjection`

## Normal connected behavior

In normal connected operation, the player should:

- execute the backend plan
- not derive the mode itself
- not choose dwell itself
- not invent its own transition in place of the backend transition

## Local fallback behavior

If the planned template cannot execute locally:

1. try another template in the same business mode
2. if valid cached fixtures exist, use `safe fixtures layout`
3. otherwise use `safe info layout`
4. if needed, use `safe message/fallback layout`

This local fallback path applies to:

- missing template on disk
- missing required local assets
- local render/execution failure

The player uses:

- general local fallback rules

It does not depend on:

- server-provided fallback list
- per-state fallback metadata

## Offline / Resilience Model

## Schedule caching

- schedules for the next 24 hours must be downloaded to the player
- backend pushes schedule changes immediately
- backend also sends schedule-hash heartbeat every 5 minutes
- player compares received hash to local hash
- if different, player downloads updated schedule as soon as possible

### Key rule

The 24-hour schedule cache is authoritative enough to keep fixtures-led modes running during backend unavailability.

## Ad asset caching

- ads should be downloaded as soon as they are available
- if schedule cache is valid and needed ad assets/rules are local, the player may run `fixtures with ads` while backend is unreachable

## Local Journal and Sync

## Journal scope

The player must journal locally:

- schedule progression/state transitions
- ad playback/progression milestones
- schedule-cache updates
- ad-asset availability/download events
- granular UI/state execution events

### Ad progression journaling

Coarse milestones only, such as:

- ad scheduled
- ad started
- ad completed
- ad skipped/failed

### Mode/state journaling

More granular UI events should be recorded locally.

## Journal storage model

- append-only
- immutable rows once written
- sync acknowledgement tracked separately
- monotonic local sequence number per row
- unsynced rows survive player restart

## Retention model

Acknowledged local history should be retained using:

- 7-day time window
- 250 MB size ceiling

Important distinction:

- 250 MB cap applies to acknowledged retained history only
- unsynced rows may exceed that limit if needed

## Backfill and sync behavior

- journal sync is pushed on heartbeat
- when connectivity returns, all unsynced rows must be backfilled
- no AI/local summarization is assumed or allowed
- heartbeat sync may send full journal in compressed/batched form

### Recovery priority

When connectivity returns:

1. current schedule/ad/control freshness is prioritized first
2. backlog sync resumes in background
3. backlog sync may be throttled automatically

### Operational health

If unsynced backlog grows very large:

- surface as local/logged health condition
- report upstream when sync returns

## Central Admin Authoring Model

## Authoring philosophy

The system should be:

- rule-driven
- override-capable
- not dependent on heavy manual screen-by-screen authoring

Dynamic template variance should provide visual variety automatically.

Rules should inject:

- variation
- flare
- schedule-aware behavior

Without requiring central admin to hand-author every state transition.

## Scope hierarchy

Central admin should be able to narrow and apply priority/override at scopes such as:

- all
- country
- state
- region
- bar type
- bar

Likely additional useful categories:

- display group / venue group
- city / market cluster
- timezone
- campaign/event window
- sport/league/tournament profile
- compliance tier
- hardware capability tier

> **Phase-1 closed enum (D-GRH-71):** Only `all`, `bar:{id}`, `region:{code}`, `state:{code}`, `city:{slug}` accepted by AdminGatewayService rule writes. Remaining scopes (country, bar_type, display_group, market_cluster, timezone, campaign_window, sport_profile, compliance_tier, hw_tier) deferred to phase 2.

## What central admin should author

Central admin UI should support:

- sport focus
- league / tournament / cup focus
- local-team emphasis
- business-mode preference or forced mode
- template/layout override
- featured game focus
- ad-window scheduling
- ad policy
- recap emphasis
- transition/dwell override
- safe/fallback constraints
- venue messaging-lane content

## Venue messaging

Venue announcements should be modeled as:

- a content type
- delivered through a separate messaging lane

This keeps them distinct from core sports schedule orchestration.

## Automatic Mode Selection Rules

These rules matter as backend planning behavior.

### One live game + valid fixtures

- consult schedule first
- if schedule does not explicitly direct otherwise, default to `fixtures with live game`
- fixture emphasis depends on market and sport relevance

### Multiple live games + valid fixtures

- normally prefer a multi-game family
- unless schedule explicitly says otherwise

### Multiple live games, but only one is high-priority

- system may still behave like single-focus live presentation with fixtures support

### No live games + valid fixtures

- default to `fixtures`

### No live games + no valid fixtures

- prefer `safe info layout`
- then `safe message/fallback layout`

### Multiple live games, even if low-interest

- should still push toward `multiple games`
- should not remain fixtures-led just because the games are low-priority

### One low-priority live game + valid fixtures

- may still prefer `fixtures with live game`

### One live game + no valid fixtures

- prefer `single game`

## Reporting and Execution Truth

Because the player journals execution, the system must be able to answer:

- what planned state was sent
- what state id/version was requested
- what transition variant was requested
- what template actually executed
- whether the player fell back
- why the player fell back
- what local assets were or were not available
- whether backlog existed and when it was synced

## Product Rules Summary

The most important product rules are:

- backend is the orchestrator in normal operation
- player is execution + resilience + local fallback
- business modes are fixed named modes
- recap is a reusable layer, not a mode
- ad-present states are distinct business modes
- multiple templates per mode are required
- ad windows merge into planned states where possible
- player fallback prefers same mode first, then safe templates
- cached fixtures are a major resilience primitive
- local journaling is append-only and durable
- central admin owns the system in this build
- bar admin is out of scope
- schedule is rule-driven with overrides, not hand-authored screen-by-screen by default

## Server-Player Protocol Schema

This section documents the wire protocol between the backend orchestration system and the bar player runtime.

### Wire Format

Both channels use JSONL (newline-delimited JSON). Every message carries a `message_type` discriminator field.

### Channel Architecture

One physical WebSocket connection per player. All messages multiplexed via JSONL `message_type` discriminator. Two **logical** channels:

1. **Control channel** (logical) — schedule orchestration, state delivery, config, overrides, heartbeat, asset manifests, messaging
2. **Game data channel** (logical) — live game state and events only

See D-GRH-48. Two-connection model retracted in D-GRH-41.

### Rolling Schedule Window

Schedules use rolling 24-hour `ScheduleWindow` objects (not calendar-day boundaries). A new window begins before the previous window ends. There are no day-boundary gaps.

### Core Message Types

**Control channel (server → player):**

| Message | Purpose |
|---|---|
| `ScheduleWindow` | Rolling 24h window header with `window_id`, `window_start`, `window_end`, `schedule_hash`, `slot_count` |
| `PlannedState` | Core render instruction with `state_id`, `window_id`, `schedule_slot_index`, `valid_from`, `interrupt_class`, `business_mode`, `template_id`, `theme_id`, `dwell_target_ms`, `transition`, `program_slot_id`, `ad_slot_id` |
| `ProgramSlot` | Programming selection (game IDs, fixture IDs, primary game ID) — referenced by ID from `PlannedState` |
| `AdSlot` | Ad context (ad_class, ad_ref, policy) — referenced by ID from `PlannedState` |
| `OverrideInjection` | Out-of-band interrupt with `fires_at` for lead-time asset download |
| `AssetManifest` | Asset download instructions segmented by slot range, with `needed_by` per asset for eviction priority |
| `MessagingLane` | Venue messaging overlay (text-only in v1); carries `lane_id`, `text`, `display_form`, `dwell_ms`, `valid_from`, `valid_until`; same `lane_id` replaces prior message; independent of schedule and PlannedState (D-GRH-57) |
| `HeartbeatAck` | Server echo of player `Heartbeat`; carries seq; server closes connection and emits `PlayerDisconnected` to NATS if no `Heartbeat` received within 90s (D-GRH-59) |
| `ConfigPush` | Player configuration including `cache_ceiling_bytes` (server-computed from device storage), all heartbeat/sync intervals |
| `SyncRequest` | Server-initiated journal sync trigger |

**Game data channel (server → player):**

| Message | Purpose |
|---|---|
| `GameState` | Full game snapshot with scores, period, clock, signals (sport-specific, server-computed), badges (server-evaluated, priority-sorted, dominant badge flagged), sport_context |
| `GameEvent` | Incremental delta with mandatory monotonic `seq` field |
| `DisplayEvent` | Server-triggered ephemeral alert (excitement tier jump, badge triggered, upset confirmed, overtime, score flash). Fires once; `event_id` used for deduplication. Does not change layout mode. |

**Player → server:**

| Message | Purpose |
|---|---|
| `DeviceRegistration` | Sent on every connect (first and reconnect); server responds with full re-push sequence (ConfigPush → ScheduleWindow → AssetManifest → PlannedStates → GameStates); no RegistrationAck; ConfigPush serves as implicit ack; `capabilities` field reserved for future negotiation (D-GRH-61) |
| `Heartbeat` | App-level liveness ping; carries `display_id` + `seq`; sent every 30s; player reconnects if no `HeartbeatAck` within 60s (D-GRH-59) |
| `GameStateRequest` | Mid-connection seq gap recovery only — not used on reconnect (full re-push via D-GRH-49/D-GRH-61 covers that); player sends on detected seq discontinuity; server responds with `GameStateSnapshot` (full snapshot in v1) (D-GRH-63) |
| `JournalSync` | Append-only JSONL batch POST to server; server responds with ACK confirming seq range |

### Key Protocol Rules

- `PlannedState.theme_id` is three-state: `"string"` (explicit override), `null` (inherit from bar profile), `"__unset__"` (revert to system default)
- `PlannedState` does not carry `expires_at`; schedule continuity is guaranteed by contiguous `schedule_slot_index` ordering
- `OverrideInjection` carries `fires_at` for lead-time asset download; server pushes `AssetManifest` alongside override
- On override completion, player re-evaluates wall clock against active `ScheduleWindow` — no explicit resume pointer needed
- Player maintains in-memory game state from `GameState` + `GameEvent` deltas continuously, regardless of rendering state
- `Heartbeat` is player-initiated (bidirectional): player sends every 30s, server responds `HeartbeatAck`; player reconnects on no ack within 60s; server closes + emits `PlayerDisconnected` to NATS if no heartbeat within 90s (D-GRH-59); hash reconciliation is handled separately via `ConfigPush` and `config_hash` comparison (D-GRH-60, D-GRH-36)
- Journal fallback reason codes are structured: `template_missing`, `render_failure`, `asset_missing`, `connectivity_lost`
- `config_hash` in `ConfigPush` allows config staleness detection via heartbeat comparison
- All intervals (heartbeat, journal sync, etc.) are admin-configurable and delivered via `ConfigPush`
- Signal names per sport are stable protocol contract; weights and computation are backend-internal. Composite `excitement_score` uses 0–100; individual signals use 0.0–1.0.

## Backend Infrastructure

### Message Broker

NATS JetStream for all subjects (D-GRH-33, D-GRH-65). Core NATS not used — single operational model.

Two streams:

| Stream | Subject pattern | Retention |
|---|---|---|
| `GAME_EVENTS` | `game.*.events` | Game lifetime + 2h |
| `BAR_CONTROL` | `bar.*.control` | 24h |

Both use shared durable competing consumers.

### Temporal Workflows

**Recording workflow** (D-GRH-34, D-GRH-45): one Temporal workflow per active `game_id`. Connects independently to live event push stream (WebSocket/SSE per game), maintains `GameState` projection, publishes `GameEvent` to NATS `GAME_EVENTS` stream. Temporal retries `ConnectLiveStream` activity with backoff on disconnection; simultaneously signals GameDeliveryService to mark game data stale (D-GRH-46).

**BarPlayerSchedulerService** (D-GRH-40, D-GRH-41, D-GRH-66): singleton Temporal workflow, ID `bar-player-scheduler`. Manages all bars in a single workflow instance. Internal state: map of `bar_id` → `ScheduleWindow`, rebuilt from DB on restart. Signals: `BarCreated`, `BarPreferencesChanged`, `GameLifecycleEvent`, `DailyCron`. Continue-as-New on daily cron pass or history threshold. Temporal Queries: `GetScheduleWindow(bar_id)`, `ListAllScheduleWindows()`. Singleton appropriate at current fleet size; sharding deferred.

### Ops Events

Two symmetric presence events published to `bar.<bar_id>.control` (BAR_CONTROL stream):

| Event | Trigger | Key Fields |
|---|---|---|
| `PlayerConnected` | Every `DeviceRegistration` receive (D-GRH-67) | `bar_id`, `display_id`, `connected_at`, `player_version`, `reconnect` |
| `PlayerDisconnected` | Heartbeat timeout or WS close (D-GRH-64) | `bar_id`, `display_id`, `disconnected_at`, `reason` |

`reconnect: false` on first-ever registration for `display_id`; `true` on all subsequent connects. Ops monitoring only in v1 — no backend business logic depends on these events.

## Vertical slices — implementation sequence

This section enumerates the thin end-to-end functional cuts that compose CROWDAQ. Each slice delivers observable behavior end-to-end; together S0–S13 cover the full backend-orchestrated bar-signage pipeline. Plane mirror: project `CROWDAQ`, parent epic `CRWDQ-1`.

### Strategy

- **S0** — recording baseline (LIVE, reference only).
- **S1, S2, S3** — three parallelizable tracks layered on S0.
- **S4** — first true end-to-end demo. Integrates S1 + S2 + S3.
- **S5–S13** — fan-out features after S4, picked by product priority.

### Critical path to first end-to-end demo

`S0 (done) → max(S1, S2, S3) → S4 integration glue`

### Slices

#### S0 — Recording baseline (LIVE)

- **Surfaces:** crowdaq-backend Hono HTTP trigger; Temporal `RecordFixtureWorkflow`; JSONL artifact persisted to PVC.
- **Demonstrates:** game ingest from upstream sport feed → durable artifact on disk. No admin path, no player.
- **Depends on:** nothing.
- **Builds:** N/A — already LIVE. Captured for dependency graph completeness.
- **Repos:**
  - `crowdaq-backend` — Hono trigger, Temporal RecordFixtureWorkflow, worker pod.
  - `proxmox-infra` — k8s deployment manifests, PVC for JSONL storage.
- **Status:** DONE.

#### S1 — Coverage authoring → recording fanout

- **Surfaces:** AdminGatewayService skeleton (D-GRH-69); Rule entity persistence with two-tier model (D-GRH-71); GameScheduler coverage driver, rule-driven (D-GRH-72).
- **Demonstrates:** admin writes `cover NFL` rule → GameScheduler scans + spawns RecordFixtureWorkflow per matching fixture. No player.
- **Depends on:** S0.
- **Builds:** AdminGatewayService HTTPS surface, audit log stream, Rule table schema + write path, GameScheduler service, Temporal signal dispatch.
- **Repos:**
  - `crowdaq-backend` — AdminGatewayService (new Go process), Rule entity schema + migrations, GameScheduler service, Temporal signal dispatch, audit-log stream.
  - `proxmox-infra` — k8s deployment manifests for AdminGatewayService + GameScheduler pods, secrets scaffolding.
  - `founding` — CF Tunnel + CF Access policy only if AdminGateway becomes public-facing; default phase-1 is tailnet-only (skip until S12).

#### S2 — Bar onboarding (BarPreferences + ConfigPush)

- **Surfaces:** AdminGatewayService (extended); BarPreferences entity (D-GRH-60 + D-GRH-73); ConfigPush channel.
- **Demonstrates:** admin registers bar, writes BarPreferences → player receives config push + acks. No content rendering.
- **Depends on:** S1.
- **Builds:** BarPreferences table + write path, ConfigPush lane, player config sync handler.
- **Repos:**
  - `crowdaq-backend` — BarPreferences entity + migrations, AdminGatewayService /bar-preferences endpoints, ConfigPush publisher (NATS or WS sender).
  - `xibo-plugin` — player-side ConfigPush consumer in Widget v2, BarPreferences local cache + apply.
  - `proxmox-infra` — NATS subject definitions for `bar.<id>.config` if NATS path chosen, ConfigMap secrets.

#### S3 — Single-game render (no admin path)

- **Surfaces:** BarPlayerSchedulerService skeleton (D-GRH-40); GameDeliveryService (D-GRH-42); Widget v2 single_game render path; wire-protocol envelope (D-GRH-21, D-GRH-62).
- **Demonstrates:** hardcoded BarPreferences + one S0 recording artifact → scheduler emits PlannedState (single_game) → delivery pushes over WS → Widget v2 renders. No admin path.
- **Depends on:** S0.
- **Builds:** BarPlayerSchedulerService, GameDeliveryService, versioned wire-protocol envelope, single_game template.
- **Repos:**
  - `crowdaq-backend` — BarPlayerSchedulerService (Temporal workflow + activities), GameDeliveryService (Go WS server), wire-protocol envelope schema + serializer.
  - `xibo-plugin` — Widget v2 WS client, wire-protocol deserializer, single_game template render path.
  - `proxmox-infra` — k8s manifests for BarPlayerSchedulerService + GameDeliveryService, Ingress/Service definitions, WS upgrade config.
- **Parallelizable with S1, S2.**

#### S4 — Coverage → record → render (end-to-end)

- **Surfaces:** all of S1 + S2 + S3 active together.
- **Demonstrates:** admin authors `cover NFL` rule AND onboards bar → recording fires → scheduler picks up artifact + BarPreferences → ScheduleWindow flows to player → render. First true end-to-end demo.
- **Depends on:** S1, S2, S3.
- **Builds:** integration glue only.
- **Repos:**
  - `crowdaq-backend` — cross-service wiring (Rule → GameScheduler → RecordFixtureWorkflow → BarPlayerSchedulerService → GameDeliveryService), end-to-end e2e tests.
  - `xibo-plugin` — e2e smoke test on player side (real WS, real BarPreferences).
  - `proxmox-infra` — full-stack staging deploy, dashboards verifying flow.

#### S5 — Weight rule + multi-game render

- **Surfaces:** rule action `weight` (D-GRH-71); scheduler ordering by weight; multiple_games template.
- **Demonstrates:** admin authors `weight {team: Eagles, delta: +50}` → scheduler re-orders → player renders 2×2 grid with Eagles first.
- **Depends on:** S4.
- **Builds:** weight rule processor, multi-game template + dwell logic.
- **Repos:**
  - `crowdaq-backend` — weight rule processor in GameScheduler + BarPlayerSchedulerService ordering logic.
  - `xibo-plugin` — multiple_games (2×2 grid) template + dwell handling in Widget v2.

#### S6 — Fixtures mode (pre-game catalog render)

- **Surfaces:** FixtureList 7-day lookahead (D-GRH-18); fixtures template; automatic mode selection.
- **Demonstrates:** no live game → player renders fixtures mode.
- **Depends on:** S3.
- **Builds:** FixtureList sync, fixtures template, first iteration of automatic-mode-selection.
- **Repos:**
  - `crowdaq-backend` — FixtureList entity, upstream feed sync worker, BarPlayerSchedulerService automatic-mode-selection rule (no-live-game → fixtures).
  - `xibo-plugin` — fixtures template + render path in Widget v2.

#### S7 — Slot pin (one-off admin override)

- **Surfaces:** AdminGatewayService slot-pin endpoint (D-GRH-70 path 1); DB hot-tier direct write with `pinned: true`; scheduler pin-skip logic.
- **Demonstrates:** admin pins a row in pre-computed ScheduleWindow → scheduler preserves on reprocess → 24h auto-expiry.
- **Depends on:** S4.
- **Builds:** pin write path, scheduler pin-aware reprocess.
- **Repos:** `crowdaq-backend` only — slot-pin endpoint on AdminGatewayService, DB hot-tier write with pinned flag, BarPlayerSchedulerService pin-aware reprocess logic. Wire-protocol stays unchanged; player doesn't need updates.

#### S8 — Ad inventory + AdSlot render

- **Surfaces:** ad creative upload; AdSlot entity (D-GRH-62); rule action `ad_window` (D-GRH-71); fixtures_with_ads template.
- **Demonstrates:** operator uploads creative + authors `ad_window {mode: force, ...}` → scheduler interleaves AdSlot rows → player renders ad.
- **Depends on:** S4, S6.
- **Builds:** creative blob store, AdSlot interleave logic, ad_window rule processor, ad template.
- **Repos:**
  - `crowdaq-backend` — creative blob upload endpoint, creative store (S3-compatible or PVC), AdSlot entity + scheduler interleave, ad_window rule processor.
  - `xibo-plugin` — ad render template + fixtures_with_ads composite template in Widget v2.
  - `proxmox-infra` — blob storage provisioning (Ceph / MinIO PVC), CDN config if creatives are pre-cached to player.

#### S9 — Post-game recap

- **Surfaces:** RecordFixtureWorkflow completion signal → BarPlayerSchedulerService (D-GRH-68); recap window computation; recap PlannedState + recap template.
- **Demonstrates:** game finishes → signal → scheduler emits recap PlannedState → player renders recap.
- **Depends on:** S4.
- **Builds:** recap signal path, recap window calculator, recap render template.
- **Repos:**
  - `crowdaq-backend` — Temporal signal from RecordFixtureWorkflow → BarPlayerSchedulerService, recap window calculator, recap PlannedState emitter.
  - `xibo-plugin` — recap template + render path in Widget v2.

#### S10 — MessagingLane (out-of-band text overlay)

- **Surfaces:** AdminGatewayService MessagingLane endpoint (D-GRH-57); NATS subject `bar.<bar_id>.control` (D-GRH-65); player overlay renderer.
- **Demonstrates:** admin publishes text overlay → NATS → player renders overlay on top of current PlannedState. No reprocess.
- **Depends on:** S3, S1.
- **Builds:** MessagingLane entity + NATS publish, player overlay layer.
- **Repos:**
  - `crowdaq-backend` — MessagingLane endpoint on AdminGatewayService, NATS publisher for `bar.<id>.control`.
  - `xibo-plugin` — player overlay layer in Widget v2 (renders on top of current PlannedState without reflow).
  - `proxmox-infra` — NATS subject ACLs + JetStream config for control channel.

#### S11 — Safe / ambient fallback

- **Surfaces:** scheduler fallback mode selection; safe + ambient templates.
- **Demonstrates:** no rules cover anything → scheduler emits safe-mode PlannedState → player renders ambient.
- **Depends on:** S3.
- **Builds:** safe template, ambient template, automatic-mode-selection completion (D-GRH-22 gap-fill).
- **Repos:**
  - `crowdaq-backend` — BarPlayerSchedulerService fallback-mode selection logic (D-GRH-22 gap-fill).
  - `xibo-plugin` — safe template + ambient template in Widget v2.

#### S12 — Auth / RBAC hardening

- **Surfaces:** AdminGatewayService real auth (login, session, scopes); RBAC scope model + delegation; audit log actor.
- **Demonstrates:** operator logs in, scoped token writes only within scope, audit log shows actor.
- **Depends on:** S1.
- **Builds:** real auth (e.g., OIDC + session), RBAC scope evaluator, audit log actor field.
- **Repos:**
  - `crowdaq-backend` — real auth middleware in AdminGatewayService (OIDC + session), RBAC scope evaluator, audit-log actor field, scope-token format.
  - `founding` — CF Access policies + CF Tunnel rules if AdminGateway becomes public-facing (instead of tailnet-only).
  - `proxmox-infra` — IdP secrets (OIDC client secret), audit-log retention storage config.

#### S13 — Journal access + metrics

- **Surfaces:** journal read API; metrics emission; dashboard hosting.
- **Demonstrates:** admin queries journal; dashboard shows per-bar render counts, reprocess timings, recording success rate.
- **Depends on:** S4.
- **Builds:** journal query API, metrics instrumentation, dashboard scaffolding.
- **Repos:**
  - `crowdaq-backend` — journal read API on AdminGatewayService, metrics emission (OpenTelemetry / Prometheus exporters) across all services.
  - `proxmox-infra` — Grafana dashboards, Prometheus scrape config, alert rules, log shipping.
  - `xibo-plugin` — player-side metrics ping (render counts, dwell timing) if collected client-side.

### Sequence + dependency graph

```
S0 (DONE)
 │
 ├──► S1 ──┐
 │         ├──► S4 ──┬──► S5
 ├──► S2 ──┤          ├──► S7
 │         │          ├──► S8 (also needs S6)
 ├──► S3 ──┘          ├──► S9
 │   │                ├──► S10
 │   ├──► S6 ─────────┤
 │   └──► S11         └──► S12 (parallel)
 │                    └──► S13 (parallel)
```

Parallelization: S1, S2, S3 are three parallel tracks after S0; converge at S4. S5–S13 fan out after S4.

### Dependency table

| Slice | Depends on | Unlocks |
|-------|-----------|---------|
| S1 | S0 | S2, S4 |
| S2 | S1 | S4 |
| S3 | S0 | S4, S6, S10, S11 |
| S4 | S1, S2, S3 | S5, S7, S9, S10, S13 |
| S5 | S4 | — |
| S6 | S3 | S8 |
| S7 | S4 | — |
| S8 | S4, S6 | — |
| S9 | S4 | — |
| S10 | S3, S1 | — |
| S11 | S3 | — |
| S12 | S1 | — |
| S13 | S4 | — |

### Plane mirror

Each slice corresponds to a Plane epic under parent `CRWDQ-1` (CROWDAQ project). Plane epics carry the same surfaces / demonstrates / depends-on / builds bullets; `blocked_by` relations mirror this dependency table. Plane is the work-tracking surface; this PRD section is the source-of-truth narrative.

## Open Items Remaining After This PRD

The following still need follow-up specs:

- exact named templates inside each business mode
- exact threshold definitions for:
  - ordinary changes
  - major sports moments
  - exceptional override
- exact messaging-lane composition rules
- exact future permissions/content-author model

### Post-Game Recap Trigger

**Resolved (D-GRH-68):** Post-game recap trigger lives on `BarPlayerSchedulerService`. On `RecordFixtureWorkflow` completion → workflow signals scheduler → scheduler computes recap window + emits recap `PlannedState`. No new service.

### Admin UI — design status

Surfaces closed:
- **AdminGatewayService (D-GRH-69)** — single HTTPS write surface; owns auth/RBAC, validation, audit log, multi-protocol downstream dispatch (NATS / DB / Temporal signal).
- **Schedule authoring (D-GRH-70)** — admin does not author from scratch. Two paths: slot-level pin (one-off, 24h auto-expiry) + rule edit (persistent). Last-write-wins, audit-log only, no ETag phase-1.
- **Rules authoring (D-GRH-71)** — two-tier model: `BarPreferences` (static identity) + `Rule` (conditional behavior). Closed enums: scope (`all|bar|region|state|city`), action (`cover|weight|ad_window`), predicate keys (sport, league, team, game_id, day_of_week, time_range, date_range). AND-only, no OR/NOT phase-1.
- **GameScheduler coverage driver (D-GRH-72)** — rule-driven; scans cover rules + fixture catalog, spawns RecordFixtureWorkflow.
- **BarPreferences schema (D-GRH-73)** — extended with `state`, `city`.

Surfaces still open (priority order):
1. Ad inventory management (creative upload, AdSlot policy authoring).
2. Auth/RBAC (login, scopes, scope delegation).
3. Temporal workflow visibility (built-in Temporal Web UI vs custom views).
4. Journal data access (admin reporting against journaled events).
5. Metrics + dashboards (emission targets, dashboard hosting).

Deprioritized: override-injection admin path (D-SCHEMA-08 / D-GRH-56) — no concrete operator workflow surfaced.

## How To Use This PRD Next

This PRD should now be used to derive:

1. backend orchestration spec
2. player runtime spec
3. admin authoring UI spec
4. schedule/cache/journal spec
5. ad-window orchestration spec
6. safe-mode/fallback spec
7. template catalog spec
8. vertical slices for implementation
