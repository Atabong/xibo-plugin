# Game Right Here Product Owner Digest

Last updated: 2026-05-07

## Purpose

This document explains what `game-right-here` already is, what is actually implemented, how the important concepts work, and where the product can evolve next.

It is written for a product owner, not just for engineers. The goal is to make it easy to:

- understand the current product surface
- understand the underlying product logic
- separate real functionality from demo scaffolding
- identify where new features or adjacent ideas could come from

## Important Context

- Repo: `C:\Users\Atabong\Documents\GitHub\game-right-here`
- Existing idea/context summary: `docs/chatgpt-share-game-data-question-design-summary.md`
- Related architecture context outside this repo:
  - frontend: `C:\Users\Atabong\Documents\GitHub\xibo-plugin`
  - frontend docs: `C:\Users\Atabong\Documents\GitHub\xibo-plugin\docs`
  - backend: `C:\Users\Atabong\Documents\GitHub\xibo`
  - infrastructure: `C:\Users\Atabong\Documents\GitHub\proxmox-infra`
  - additional infra context: `C:\Users\Atabong\Documents\GitHub\xibo\infra`

Although this repo is currently basketball-oriented, the broader product direction discussed elsewhere is:

- soccer first for the Xibo/public-screen experience
- then expansion to other sports
- with this repo serving as a strong reference implementation for the engagement model

## Executive Summary

`Game Right Here` is already more than a scoreboard. The implemented product is a real-time "what should I watch right now?" system for tournament basketball.

Its central idea is:

- ingest live or mock game data
- compute a real-time excitement score
- classify games into narrative archetypes using badges
- surface the most watch-worthy games, teams, regions, and tournament stories
- explain why a game matters through charts, stats, runs, pressure, upsets, and story summaries

The app is strongest today as:

- a viewing prioritization product
- a storytelling layer over live sports
- a demoable analytics concept
- a foundation for cross-sport attention orchestration

## Product Positioning

The current product implicitly answers these user questions:

1. Which game should I turn on right now?
2. Why is this game worth watching?
3. What kind of game is it becoming?
4. Which teams have been the most entertaining this tournament?
5. How is the bracket evolving, and what might happen next?

That makes the product feel like a mix of:

- live watch guide
- drama detector
- tournament storyteller
- bracket context engine
- demo platform for sports engagement concepts

## Core Product Concepts

### 1. Excitement Is Computed, Not Assumed

The app does not treat score margin alone as "excitement." It computes excitement from several live signals:

- scoring pace
- lead volatility
- closeness of the game
- game clock leverage
- upset dynamics
- overtime state
- rhythm/trading baskets
- volatility of scoring control

This is the most important product concept in the repo.

### 2. Games Get a Narrative Identity

Games are not only scored numerically. They are classified into narrative types with badges such as:

- `Game Right Here`
- `Upset Alert`
- `Overtime Thriller`
- `Momentum Swing`
- `Lead Change Frenzy`
- `Blowout Collapse`
- `Game of Runs`
- `Buzzer Beater Watch`

This turns raw analytics into language a casual viewer can understand quickly.

### 3. The Product Is About Attention Allocation

The dashboard is not neutral. It tries to direct viewer attention:

- sort games by excitement
- highlight the featured live game
- flag heat-wave situations when multiple games are hot
- surface upset counters and region heat
- make one game feel urgent enough to switch to

This is strategically relevant to the larger "public screen / engagement engine" direction.

### 4. The Tournament Is Treated as a Story System

The product does not stop at one game. It tracks:

- team-level excitement across the tournament
- bracket evolution
- projected winners and champion paths
- region and conference "heat"
- cumulative drama rather than isolated scores

This gives the product a portfolio view of the event.

## What Is Implemented Today

### Dashboard (`/`)

The main dashboard is the broadest product surface in the repo.

Implemented behaviors and surfaces include:

- hero banner that features the best live game, or best recent final if nothing is live
- auto-refresh every 10 seconds
- grouping of games into time-of-day sessions
- sorting by excitement, time, or upset potential
- live/final/scheduled game cards
- session-level excitement bars
- featured live game banner
- live ticker/leaderboard behavior
- upset counter
- "Heat Wave" alert when 3 or more live games are simultaneously hot
- region heat map
- biggest upsets by seed
- team excitement leaderboard
- conference heat map
- watch list / favorites support
- badge legend and badge-forward UI

What this means in product terms:

- the homepage already acts like a real-time watch guide
- the product has multiple "lenses" for discovering interesting games
- the product is not dependent on one single widget to communicate value

### Game Detail (`/game/[id]`)

The game detail page is one of the strongest pieces of implemented product thinking.

Implemented sections include:

- score display and live state
- active badges under "What Happened Here"
- excitement-over-time chart
- current excitement meter
- pivotal moment callout based on the biggest excitement jump
- player box score
- team tournament form panel
- deep analytics panel
- scoring runs panel
- lead-change timeline
- scoring event timeline
- momentum analysis
- pressure index
- shot mix by half
- contextual stats like round, seed matchup, lead changes, ties, excitement percentile
- AI-generated game story summary
- odds and betting outcome recap for finals
- share button

What this means in product terms:

- each game can be explained as a story, not just displayed as a score
- the page supports both casual and analytical viewers
- the system is already close to a reusable "game explanation template"

### Bracket (`/bracket`)

Implemented bracket features include:

- bracket tree display
- mapping actual/final/live games into bracket nodes
- winner propagation
- clickable paths into game details
- projected champion display
- projected winner highlighting
- stats summary for total teams, rounds, live games, and upsets

Product meaning:

- the bracket is not static decoration
- it is becoming a predictive navigation surface

### Forecast (`/forecast`)

Implemented forecast features include:

- simulated win probabilities
- simulated moneyline, spread, and total
- explanation text for why a team is favored
- projected champion
- projected path through future rounds
- tournament form leaderboard
- future-round filtering

Important product note:

- these are simulated lines, not a sportsbook integration
- the value is explanatory context and future-outcome framing

### Teams (`/teams`)

Implemented features include:

- team excitement leaderboard
- search and team selection
- top performers spotlight
- clutch leaders
- upset drama leaders
- slide-in team detail panel
- support for ranking by average or cumulative excitement through the API

Product meaning:

- the app can pivot from "best game now" to "most entertaining teams overall"
- this is useful for editorial packaging, sponsorship, and audience personalization later

### About Badges (`/about-badges`)

This page acts as a product glossary and trust-building artifact.

Implemented content includes:

- badge categories
- explanations of what each category means
- badge-by-badge descriptions
- excitement labels from quiet to thrilling
- score breakdown explanation
- game-right-here threshold explanation

Product meaning:

- the product explains its own logic
- that lowers the risk of the system feeling arbitrary or "AI magic"

### Admin / Demo (`/admin`, `/admin/demo`)

The repo includes strong internal/demo tooling.

Implemented admin/demo concepts include:

- architecture overview page
- demo control panel
- simulation speed controls
- forced scenario toggles
- close game mode
- underdog/upset mode
- overtime mode
- game-of-runs mode
- game-right-here mode
- event log for simulated play
- API reference for demo behavior

Product meaning:

- the app is deliberately designed to be demoed, sold, and explained
- this is useful for stakeholder alignment and future pitch/partner workflows

## How The Core Computation Works

### Excitement Score

The app computes a real-time excitement score from 0 to 100.

Current weights in code:

- `scoreChangeRate`: 18%
- `leadChangeRate`: 18%
- `onePossessionPressure`: 18%
- `clockLeverage`: 15%
- `tradingBaskets`: 10%
- `overtimeBonus`: 10%
- `upsetPressure`: 9%
- `runVolatilityScore`: 2%

The current threshold for the highest watch-state is:

- `Game Right Here` at 85+

### Factor meanings in plain language

`scoreChangeRate`
- Measures how quickly points are being scored in the recent window.
- High value means the game is active and producing events.

`leadChangeRate`
- Measures how often the lead is changing recently.
- High value means the game is unstable and dramatic.

`onePossessionPressure`
- Measures how close the score is.
- A game within 5 points gets maximum pressure.
- Late-game closeness is amplified.

`clockLeverage`
- Measures how much the remaining time matters.
- Late second half and overtime increase leverage sharply.

`upsetPressure`
- Measures whether a meaningful underdog story is developing.
- Seed gap and current scoreboard both matter.

`overtimeBonus`
- Adds drama credit for overtime, scaled by closeness.

`tradingBaskets`
- Detects rhythmic back-and-forth scoring.
- This captures the feeling of both teams answering each other.

`runVolatilityScore`
- Measures how often scoring control flips.
- It is lightly weighted, but adds texture to the game shape.

### Output shaping

The weighted sum is not used raw. The score is curved with a power function:

- `Math.pow(weighted, 0.7) * 100`

Why this matters:

- the curve makes strong real games reach visibly high scores more often
- it makes the product feel more alive and editorially useful

### Rolling Excitement Curve

The app does not compute one single number for a game. It computes a sequence of excitement points over time:

- one point per scoring-state change / snapshot
- each point includes the overall score plus metadata for contributing factors

This powers:

- the excitement chart
- pivotal moment detection
- spike annotations
- game percentile/contextual stats
- explanations of how the game evolved

### Badge System

The badge engine is a second major layer, separate from the numeric score.

The repo currently supports a large set of badge archetypes across categories including:

- excitement
- momentum
- clutch
- upset
- chaos
- performance
- domination

Important product behaviors:

- all badge evaluators are run
- results are sorted by priority
- one badge is marked as dominant
- secondary badges are also shown

Why this matters:

- the score says how hot a game is
- the badge says what kind of hot it is

That is an important distinction for product design.

### Deep Game Stats

The app computes richer stats beyond excitement:

- lead changes
- tie count
- percent of game within one possession
- max lead by each team
- biggest deficit overcome
- per-half scoring breakdown
- clutch scoring
- clutch rating
- momentum balance
- shot composition
- pace rating
- current win probability
- win probability curve
- excitement percentile
- bracket impact percentage
- average answer time between runs and responses

Product meaning:

- this supports premium explanations, recap generation, alerts, ranking logic, and editorial tools
- it also provides raw material for future cross-sport equivalents

### Team Excitement Computation

At the team level, the app computes:

- average excitement
- cumulative excitement
- peak game excitement
- clutch index
- upset drama index
- games played

This gives the product a way to describe not just "who is good," but "who produces entertaining games."

### Forecast Computation

The forecast engine is simple but useful.

It uses:

- seed strength baselines
- team form based on average excitement in completed games
- average scoring margin

Adjustments are capped, then converted into:

- win probability
- American moneyline
- spread
- estimated total

Product meaning:

- this is not trying to be Vegas
- it is creating an interpretable "what the tournament seems to be saying" layer

### AI Narrative Layer

The app has an AI story endpoint for games:

- route: `/api/game-story/[id]`
- model provider: Anthropic / Claude when API key is present
- fallback behavior: deterministic plain recap when no key exists

The story layer uses:

- game result
- lead-change and run data
- top scorers
- late key plays
- badges
- betting outcome context

Product meaning:

- the app already contains a working pattern for machine-generated explanation
- this is highly relevant to the broader "engagement unit" or "attention packet" direction

## Data And System Architecture

### Data Source Model

The app uses a pluggable data adapter pattern.

Primary source types in the repo:

- mock adapter
- ESPN adapter

The mock adapter is especially important. It is not trivial placeholder data. It includes:

- a broad NCAA team set
- scheduled games
- final games
- curated scoring timelines
- crafted scenarios that trigger different badges
- bracket data

This means the product has a strong demonstration dataset and not just an empty shell.

The ESPN adapter currently provides:

- tournament schedule
- live-ish game data
- single-game details
- player stats
- scoring timeline

Important limitation:

- bracket structure still depends on mocked bracket data
- fully live bracket reconstruction is not yet the source of truth

### API Enrichment Pattern

The app enriches games when they are fetched.

For non-scheduled games, the system:

1. fetches the game and scoring timeline
2. normalizes timestamps
3. builds score snapshots
4. computes rolling excitement
5. computes badges
6. computes deeper stats
7. returns the enriched game object

Product meaning:

- the intelligence layer is already centralized
- multiple UI surfaces can reuse the same enriched game contract

### Refresh Behavior

Current refresh cadences visible in the product:

- dashboard refreshes every 10 seconds
- game detail refreshes every 15 seconds
- live ESPN adapter behavior uses caching

This is enough for a convincing near-real-time experience, even if it is not websocket-based.

## What Feels Production-Ready vs Scaffolded

### Strong / Well-Realized Areas

- real-time excitement scoring concept
- rich dashboard storytelling
- game detail storytelling and analytics
- badge taxonomy and presentation
- team excitement lens
- bracket + forecast experience as product surfaces
- demo tooling and stakeholder explainability
- mock data depth

### Partially Realized / Transitional Areas

- ESPN integration exists, but some surrounding tournament context still relies on mock structures
- notification subscriptions exist, but persistence is in-memory and delivery is mocked
- AI story generation is real when configured, but optional and not the backbone of the experience
- tournament discovery and some enrichment plumbing are thinner than the main analytics/UI layers

### Clearly Future-Oriented Areas

- true push notifications / delivery infrastructure
- live websocket updates
- personalization
- monetization logic
- multi-sport generalization
- audience-aware orchestration for public screens

## What The Product Owner Should Take Away

This repo is not just a prototype of a formula. It already demonstrates several distinct product theses:

### Thesis 1: Viewers need an attention router

The app proves there is a meaningful product around deciding which live game deserves attention now.

### Thesis 2: Sports excitement is explainable

The badge system and deep stats show the product can explain why something matters, not just rank it.

### Thesis 3: Tournament products benefit from narrative packaging

The strongest moments in the app are where analytics become story:

- `Game Right Here`
- `Upset Alert`
- `Pivotal Moment`
- team excitement ranking
- game recap bullets

### Thesis 4: This can become a generalized engagement engine

The same primitives can evolve into:

- public-screen prompts
- social overlays
- contextual ad timing
- editorial alerts
- watch-party modes
- cross-sport match-state storytelling

## Good Product Expansion Ideas

These are ideas that fit naturally with what is already implemented.

### 1. Attention Packets

Turn the current game-intelligence output into a reusable packet:

- urgency
- narrative type
- supporting evidence
- confidence
- duration
- display mode
- audience fit

This connects directly to the Xibo/public-screen direction.

### 2. Why Now Alerts

For every top game, generate one short reason to switch:

- "12 seed now leads with 1:42 left"
- "third lead change in two minutes"
- "two-possession game in OT"

The repo already has most of the required inputs.

### 3. Editor / Producer Mode

Create a control-room surface showing:

- top current game
- next likely hot game
- current region heat
- upset watch
- best games for casual vs serious viewers

The current dashboard is close to this already.

### 4. Audience-Aware Ranking

Eventually adjust excitement by audience context:

- team affinity
- geography
- venue
- watch-party composition
- tournament bracket ownership
- fantasy or betting relevance

This fits the external product direction very well.

### 5. Sport-Agnostic Signal Layer

Abstract current basketball logic into sport-agnostic concepts:

- closeness
- time leverage
- comeback pressure
- upset pressure
- event burst
- answer/counter-response rhythm

That would help bridge this repo into soccer-first deployment.

### 6. Story Memory

Preserve narrative continuity across a tournament or matchday:

- same Cinderella team
- repeat clutch performer
- conference overperforming
- chaos session
- redemption rematch

The current system already generates many of the necessary building blocks.

## Questions A Product Owner Could Use Next

1. Which part of the current product is the actual wedge: consumer app, operator tool, or public-screen intelligence layer?
2. Which outputs matter most in MVP: rankings, alerts, stories, or on-screen prompts?
3. Which features are basketball-specific and which are truly portable to soccer?
4. Which current signals are essential, and which are ornamental?
5. Should the next milestone deepen the current consumer UI, or extract a reusable intelligence API for another frontend?

## Recommended Near-Term Product Framing

If this repo is used as a reference for future work, the cleanest framing is:

`Game Right Here` is a real-time sports excitement intelligence system that identifies the most watch-worthy live moments, explains why they matter, and packages tournament drama into actionable viewer-facing signals.

For internal planning, treat the repo as:

- a proven concept for excitement scoring
- a mature reference for badge-based narrative classification
- a strong demo environment
- an early model for a future multi-sport engagement/orchestration engine

## Bottom Line

The product already demonstrates a strong idea:

- not "show me scores"
- but "tell me what matters right now, why it matters, and what kind of drama I am looking at"

That is the core value of the app today, and it is the most important concept to preserve as this work evolves into soccer-first and eventually multi-sport experiences.
