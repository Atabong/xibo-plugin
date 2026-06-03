# v1 (SSE) widget — archived docs

This directory holds the prose documentation for the **v1 CROWDAQ widget**
(`modules/crowdaq-widget.xml`): a Twig stencil with an inline `<onRender>`
JavaScript block that opens an `EventSource` (Server-Sent Events) directly
against the CROWDAQ backend from the Xibo Player's Chromium runtime.

## What's here

| File | Describes |
|------|-----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | v1 data flow (backend → SSE → widget), the five SSE event types, the client-side-only render loop, and the widget properties. |
| [`OPERATIONS.md`](OPERATIONS.md) | v1 operator runbook: CMS `player_faults` log queries, the `[crowdaq:<event>]` log reference, player-side debugging, and the two known limitations (CSP whitelist, payload shape mismatch). |
| [`TARGETING.md`](TARGETING.md) | v1 multi-bar targeting via `display:<field>` substitution resolved from `xiboIC.info()` (Path B), and why CMS-side `%displayTag%` substitution (Path A) was ruled out on Xibo CMS 4.4.2. |

## Why archived

v1 speaks **SSE** (`GET /events/{eventId}/stream`, `text/event-stream`,
one-way, five event types: `score-update`, `moment`, `status`, `heartbeat`,
`error`). The current direction — **widget-v2** (`modules/widget-v2/`) — speaks
a **WebSocket + JSONL wire protocol** with a typed envelope, two logical
channels, and a 20-value `message_type` enum. The two transports share no
frame shapes; v2 is not an incremental change to v1, so the v1 prose is
retained here rather than rewritten in place.

For the v2 surface see [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md),
[`docs/WIRE_PROTOCOL.md`](../../WIRE_PROTOCOL.md), and the planned-surface
specs catalog at [`docs/specs/index.md`](../../specs/index.md).

## v1 still physically ships

Archiving is documentation-only. The v1 widget XML
(`modules/crowdaq-widget.xml`), its datatype mirror
(`datatypes/crowdaq-event.xml`), and the SSE data contract
([`docs/contract/`](../../contract/), still at its original path so CI's
contract job keeps finding it) all remain in the repo and in the release zip.
v1 and v2 ship side-by-side as two distinct Xibo widget types; the cutover is
operator-driven via the Xibo layout authoring surface. These docs stay
accurate for any operator still running the v1 widget.
