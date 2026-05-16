# CROWDAQ Docs Index

Last updated: 2026-05-10

## Purpose

This file explains which documents describe:

- the current implemented system
- the planned/target architecture
- the current formal contracts

The repository currently contains both:

1. a real implemented Phase-1 single-widget SSE system
2. planning documents for a future backend-orchestrated dynamic layout platform

These are related, but they are not the same thing.

## Current Implementation Docs

These documents describe the currently implemented or currently intended Phase-1 widget system:

- `README.md`
- `docs/current/ARCHITECTURE.md`
- `docs/current/OPERATIONS.md`
- `docs/current/TARGETING.md`
- `docs/current/contract/openapi.yaml`
- `docs/current/contract/events/*`
- `modules/crowdaq-widget.xml`

Interpretation:

- single Xibo widget
- player-side SSE consumption
- current widget event contract
- current multi-bar targeting approach
- current operational/debug model

## Planned / Target Architecture Docs

These documents describe the target dynamic layout platform and future orchestration direction:

- `docs/planned/DYNAMIC_LAYOUT_REQUIREMENTS.md`
- `docs/planned/DYNAMIC_LAYOUT_DECISIONS_LOG.md`
- `docs/planned/PRODUCT_REQUIREMENTS.md`

Interpretation:

- backend-driven orchestration
- business modes and template families
- ad-window orchestration
- post-game recap layer
- safe templates
- local journaling/sync model
- central-admin rule/override authoring

These documents are planning documents, not implementation truth for the current widget.

## Supporting Context Docs

These are useful context/reference docs, but not implementation contracts for `xibo-plugin` itself:

- `docs/planned/chatgpt-share-game-data-question-design-summary.md`
- `docs/planned/game-right-here-product-owner-digest.md`

## Contract Status

`docs/current/contract/` is currently authoritative for the existing implemented/current widget contract.

It is not yet the contract for the future backend-orchestrated dynamic layout platform described in the PRD.

That means:

- `docs/current/contract/` is current for the Phase-1 SSE widget
- `docs/current/contract/` is not yet updated for planned dynamic layout orchestration payloads

When future orchestration contracts are authored, they should be added deliberately rather than silently replacing the meaning of the current SSE contract.

## Reading Order

If you want the current implemented system:

1. `README.md`
2. `docs/current/ARCHITECTURE.md`
3. `docs/current/TARGETING.md`
4. `docs/current/OPERATIONS.md`
5. `docs/current/contract/`

If you want the future system direction:

1. `docs/planned/PRODUCT_REQUIREMENTS.md`
2. `docs/planned/DYNAMIC_LAYOUT_DECISIONS_LOG.md`
3. `docs/planned/DYNAMIC_LAYOUT_REQUIREMENTS.md`

## Short Version

Use the implementation docs for what exists now.

Use the PRD/planning docs for what the system is intended to become.
