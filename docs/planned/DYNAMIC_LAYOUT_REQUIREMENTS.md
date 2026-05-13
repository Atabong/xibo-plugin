# CROWDAQ Dynamic Layout Requirements

Last updated: 2026-05-07

> Status: **planned / exploratory requirements**.
>
> This document captures future-direction layout requirements and should not be treated as the source of truth for the currently implemented widget runtime.
>
> See `../index.md` for the documentation map.

## Purpose

This document collects requirements for extending the current `xibo-plugin` from a single-feed widget into a richer layout system for bar TVs.

It is intentionally product-first. It captures:

- what the experience needs to do
- what operators/admins need to control
- what content states must be supported
- what motion/visual constraints exist
- what needs to be configurable now vs later

This document will evolve into a technical design once the product requirements are stable.

## Current Plugin Context

The current plugin is a single Xibo custom widget that:

- renders one event/feed at a time
- uses inline Twig + inline `onRender` JavaScript
- streams content over SSE
- supports only a small widget-level property set
- is currently optimized for a focused single-match presentation

Relevant existing docs:

- `docs/current/ARCHITECTURE.md`
- `docs/current/TARGETING.md`
- `docs/current/OPERATIONS.md`

## Product Goal

Extend the plugin so it can drive a dynamic, attention-grabbing but non-disruptive sports presentation system for bar screens.

The layout system should be able to adapt between:

- one featured game
- multiple live games
- fixtures only
- fixtures plus ads
- single game plus ads
- multiple games plus ads

The result should feel premium, alive, and editorially intentional, without resorting to flashing effects.

## Non-Negotiable UX Constraint

No flashing of any type.

Implication:

- no rapid blinking
- no strobe-like highlight pulses
- no abrupt alternating color fills
- no visual treatment that risks discomfort or distraction fatigue

Acceptable alternatives:

- smooth fades
- sliding transitions
- scale and depth transitions
- gentle movement
- layered reveals
- parallax-like motion
- soft glow, halo, and shadow shifts
- typography transitions
- position transforms

## Core Experience Requirements

## Layout State Support

The plugin/layout system must support these presentation states:

1. Single game
2. Multiple games
3. Fixtures
4. Fixtures with ads
5. Single game with ads
6. Multiple games with ads

This should be treated as a first-class layout-state system, not as one-off template hacks.

## Multiple Transition Options Per State Change

Transitions between states should have multiple choices that accomplish the same high-level outcome.

Examples:

- single game -> multiple games
- multiple games -> single featured game
- fixtures -> fixtures with ads
- game-only -> game-plus-ads
- ad-present -> ad-absent
- one theme -> another theme

Requirement:

- the system should not rely on a single hard-coded animation path
- operators/designers should eventually be able to choose from multiple transition styles for the same state change

Examples of transition families to support:

- fade + scale
- slide + stagger
- wipe / reveal
- card reshuffle
- stack collapse / expand
- split-panel transition
- ticker dock / undock
- lower-third rise / settle

## Rich Visual Capabilities

The layout system should support:

- content positioning
- text transitions
- transformations
- movement
- layered content depth
- emphasis states
- visual hierarchy changes
- attention cues that do not flash

The system should be able to visually emphasize:

- the hottest game
- a newly important moment
- a promoted fixture
- a sponsor/ad unit
- a tournament or league-specific priority

## Theme Support

The overall system should support up to 5 themes.

Themes should be treated as structured presentation systems, not just color swaps.

A theme may influence:

- typography
- color palette
- surfaces / gradients / textures
- animation tone
- spacing density
- panel shapes
- badge styling
- ad framing
- scoreboard treatment
- fixture card treatment

Initial target:

- support several themes, up to 5 total

## Admin / Operator Requirements

## Per-Bar Preferences

For each bar, admin/operator should be able to manage preferences including:

- theme
- ad selection
- region information
- which sports will be shown
- which leagues will be shown
- which tournaments will be shown

This implies the system needs a bar-level preference model rather than only layout-level global settings.

## Per-Game / Data Configuration

For each game, admin should be able to control:

- what game data will be computed per game
- what leagues will be recorded
- related data collection / processing scope

This requirement likely expands beyond pure presentation and touches backend/configuration design.

For now this is captured as a product requirement and should later be split into:

- presentation configuration
- ingest / recording configuration
- analytics/computation configuration

## Ads Roadmap

Current requirement:

- bar admins can manage ad selection

Not in initial phase:

- bars publishing brand new ads themselves

Future requirement:

- bars will eventually be able to publish new ads

This implies a staged capability model:

1. centrally managed ads only
2. bar-level ad selection from an approved inventory
3. future self-service ad publishing

## Functional Requirement Areas

## Layout Orchestration

The system needs a layout orchestration layer that can:

- choose a presentation mode
- choose what content blocks are visible
- choose where blocks are placed
- choose how blocks enter/exit
- choose how ads are inserted
- choose which game is primary vs secondary

## Content Composition

The system should eventually support content blocks such as:

- featured game panel
- multi-game grid
- fixture list
- fixture hero
- ad panel
- sponsor bug / badge
- ticker
- lower-third or side rail
- moments / alerts module
- league/tournament header

## Prioritization / Selection

The extended plugin will need a way to decide:

- which game gets the hero position
- which games appear as secondary cards
- when to switch from one layout state to another
- when ads are allowed to occupy premium space
- when fixtures outrank live content

This will likely depend on:

- live vs pre-game vs post-game state
- excitement / importance signals
- bar preferences
- sport/league/tournament filters
- ad inventory rules

## Initial Design Principles

1. Motion should feel premium, not noisy.
2. Layout changes should feel intentional and explainable.
3. Ads should feel integrated, not bolted on.
4. The same content outcome should support multiple visual treatments.
5. Theme should be a system-level choice, not a CSS afterthought.
6. Per-bar targeting should extend naturally from the current targeting model.
7. The system should scale from today’s single-widget model toward a multi-block layout model.

## Early Technical Direction To Explore

These are not final decisions, but they are likely design paths to research next:

- a state-driven layout engine inside the widget
- a block/slot model for content regions
- a theme token system
- a transition catalog with named variants
- bar-level profile resolution layered on top of current display targeting
- server-provided layout payloads vs client-computed layout choices
- ad-slot abstractions rather than hard-coded ad placements

## Open Questions

1. Should all six layout states live inside one super-widget, or should some be separate widgets/layouts coordinated by Xibo?
2. How much of layout selection should happen in the backend versus in player-side widget logic?
3. Should per-bar preferences live in Xibo display metadata, plugin properties, backend config, or a combination?
4. What is the minimum theme system needed for v1 versus the full 5-theme target?
5. What ad inventory model is needed for centrally managed ads before self-service publishing exists?
6. How should fixtures and ads coexist when there are also live games competing for attention?
7. What game-data computations are presentation-critical versus backend-only?

## Next Steps

1. Turn these requirements into a capability matrix:
   layout state x theme x ad mode x sport scope x admin control
2. Define the information architecture for bar-level preferences.
3. Define the layout block model.
4. Define the transition catalog.
5. Define the theme system.
6. Separate current-phase requirements from future-phase requirements.

## Short Version

The plugin needs to evolve from a single-match SSE widget into a configurable dynamic layout system for bar screens. It must support six major display states, multiple transition styles for the same state change, up to five themes, per-bar preferences, controlled ad integration, and future expansion into deeper per-game computation and self-service ad workflows, all while avoiding any flashing effects.
