# CROWDAQ Xibo Plugin — Architecture

_Status: data-contract iter. Diagrams are still textual; a rendered version
will land in the `Author architecture diagram (D2 -> Kroki -> wiki)`
iteration._

> **Source of truth for the CROWDAQ → widget wire protocol:**
> [`docs/contract/openapi.yaml`](contract/openapi.yaml) and the
> per-event JSON Schemas under [`docs/contract/events/`](contract/events/).
> This document describes the surrounding architecture; anywhere it
> contradicts the formal spec, the formal spec wins.
>
> - SSE endpoint: `GET /events/{eventId}/stream` — see `openapi.yaml`.
> - Event schemas:
>   [`score-update.json`](contract/events/score-update.json) (primary
>   snapshot the widget renders),
>   [`moment.json`](contract/events/moment.json),
>   [`status.json`](contract/events/status.json),
>   [`heartbeat.json`](contract/events/heartbeat.json),
>   [`error.json`](contract/events/error.json).

---

## High-level data flow

```
+--------------------+      SSE       +--------------------+
|  CROWDAQ backend   |  (text/event-  |  CROWDAQ widget    |
|  (in-cluster pod,  |  stream, one-  |  (Twig stencil +   |
|  founding-crowdaq  |  way, HTTP)    |  inline onRender   |
|  namespace, Flux-  | -------------> |  JS opening the    |
|  managed)          |                |  EventSource in    |
+--------------------+                |  the player's      |
          ^                           |  Chromium runtime) |
          |                           +---------+----------+
          |  Tailscale ACL                      |
          |  tag:bar-player                     |  served as part of the
          |  -> tag:crowdaq-api                 |  layout HTML when the
          |                                     |  Xibo Player pulls it
          |                                     v
          |                           +--------------------+
          +-- display_id --->          |  Xibo CMS (k8s)   |
                                       |  xibo namespace,  |
                                       |  xibo-cms pod,    |
                                       |  4.4.2 image,     |
                                       |  mounts the       |
                                       |  plugin under     |
                                       |  /custom/crowdaq/ |
                                       +---------+---------+
                                                 |
                                                 v
                                       +--------------------+
                                       |  Xibo Player on    |
                                       |  bar PC (Debian,   |
                                       |  tailnet-joined,   |
                                       |  polls CMS, opens  |
                                       |  SSE stream from   |
                                       |  widget HTML)      |
                                       +---------+---------+
                                                 |
                                                 v
                                       +--------------------+
                                       |  Bar TV / display  |
                                       +--------------------+
```

---

## Decision references

All of these are **DECIDED** in Notion (see the "Done" section of
`CROWDAQ_Xibo_Delivery_Infra.md` in the `xibo` repo):

- **Decide CROWDAQ backend hosting + data contract** —
  `34a6405c-416e-81b5-ba13-e18e173a1079`.
- **Decide CROWDAQ plugin phase-1 scope** —
  `34a6405c-416e-81b2-95a7-d26ce1dab2ba`.
- **Decide final domain for Xibo CMS** —
  `34a6405c-416e-81c8-9397-d78587e1a266`.
- **Decide multi-tenant tag/folder schema for bars** —
  `34a6405c-416e-8192-b105-d864af5a0a10`.

### Backend hosting

CROWDAQ runs as an in-cluster pod in a new `founding-crowdaq` namespace,
Flux-managed. It is reachable over the tailnet from:

- the Xibo CMS pod (`xibo` namespace) via the Tailscale operator, and
- each bar's Xibo Player (joined to the tailnet).

### Wire protocol

**Server-Sent Events** (`text/event-stream`), one-way server -> widget.
HTTP-native, reconnect-friendly, no WebSocket upgrade required, passes
through Traefik and the tailnet without special handling.

### Auth / display resolution

The widget calls `GET /stream?display_id=<xibo_display_id>`. The backend
resolves `display_id -> bar slug` via the Xibo CMS API and streams that
bar's events. Network access is gated by the Tailscale ACL
(`tag:bar-player -> tag:crowdaq-api`). No shared secret in phase 1;
signed JWT is an optional phase-2 upgrade.

### Event schema (per SSE event)

The authoritative CROWDAQ → widget contract is the OpenAPI + JSON
Schema bundle under [`docs/contract/`](contract/). Five SSE event types
are emitted on the single `/events/{eventId}/stream` endpoint:

| Event name | Schema | Purpose |
|---|---|---|
| `score-update` | [`score-update.json`](contract/events/score-update.json) | Full match snapshot; primary tick rendered into the DOM. |
| `moment` | [`moment.json`](contract/events/moment.json) | Standalone notable-moment announcement (goal, card, VAR). |
| `status` | [`status.json`](contract/events/status.json) | Event-lifecycle transitions (pre-game → live → final …). |
| `heartbeat` | [`heartbeat.json`](contract/events/heartbeat.json) | Keepalive ping; flips the status pill between `live` and `stale`. |
| `error` | [`error.json`](contract/events/error.json) | Stream-level error; client should log + let EventSource retry. |

The `score-update` shape is mirrored in two additional machine-readable
places in this repo, both of which MUST stay 1:1 with
`score-update.json`:

- `datatypes/crowdaq-event.xml` — declared to Xibo's data-provider
  registry and referenced by `modules/crowdaq-widget.xml` via
  `<dataType>crowdaq-event</dataType>`. Field-by-field mapping is
  documented in that file's header.
- `modules/crowdaq-widget.xml` `<sampleData>` block — one canonical
  sample event used by the CMS layout editor and by the stencil when no
  live feed is yet connected.

```json
{
  "match_id": "worldcup-2026-semi-br-ar",
  "event_id": "worldcup-2026-semi-br-ar",
  "clock": {"minute": 78, "stoppage": 2, "period": "2H"},
  "score": {"home": 1, "away": 1},
  "teams": {
    "home": {"name": "Brazil",    "abbreviation": "BRA", "logo_url": "https://.../bra.svg"},
    "away": {"name": "Argentina", "abbreviation": "ARG", "logo_url": "https://.../arg.svg"}
  },
  "excitement": {"level": 0.82, "trend": "rising"},
  "last_moment": {
    "type": "goal",
    "team": "home",
    "minute": 78,
    "text": "Goal! Brazil equalise in the 78th minute — stadium erupts."
  },
  "next_update_hint_ms": 500
}
```

Field-level notes:

| Field | Type | Notes |
|---|---|---|
| `match_id` | string | Stable league/tournament-scoped id. |
| `event_id` | string | CROWDAQ-side id. Equals `match_id` in phase 1. |
| `clock.minute` | int | 1-indexed match minute. |
| `clock.stoppage` | int | Added minutes for the current period. |
| `clock.period` | string | One of `1H`, `HT`, `2H`, `ET1`, `ET2`, `PEN`, `FT`. |
| `score.home` / `score.away` | int | Current goals. |
| `teams.{home,away}.name` | string | Full team name. |
| `teams.{home,away}.abbreviation` | string | 2–4 char code (FIFA / league convention). |
| `teams.{home,away}.logo_url` | string | Optional crest URL; widget hides logos cleanly when empty. |
| `excitement.level` | 0.0–1.0 | Widget renders as `level * 10` in the UI. |
| `excitement.trend` | string | `rising`, `falling`, or `flat`. |
| `last_moment.type` | string | `goal`, `card`, `var`, `penalty`, `substitution`, `kickoff`, `end`, … |
| `last_moment.team` | string | `home`, `away`, or `neutral`. |
| `last_moment.minute` | int | Minute the moment occurred in. |
| `last_moment.text` | string | Human-readable description; truncated by `maxMomentLength`. |
| `next_update_hint_ms` | int | Advisory only; widget treats SSE push cadence as truth. |

`last_moment` is the single latest notable event — the stream is
append-only server-side, but the widget renders the most recent state
only (phase 1 has no scrollback / history).

---

## Widget render loop

1. Xibo CMS resolves the plugin manifest from `modules/crowdaq-widget.xml`.
2. On each player render, the inline `<stencil><twig>` block renders the
   initial DOM using the widget properties (theme, eventId, flags).
3. `<onRender>` JS runs against that DOM:
   - If cached / sample data is available, paint it first so the screen
     is never blank. Cached / sample data MUST validate against
     `docs/contract/events/score-update.json`.
   - Open an `EventSource` to
     `GET /events/<eventId>/stream` (see `docs/contract/openapi.yaml`).
   - Route events by their SSE `event:` name to the right handler:
     - `score-update` → rewrite the score / excitement / last-moment DOM.
     - `moment` → overlay a celebration card for a few seconds (phase-2
       polish; MVP widget renders last-moment via `score-update` only).
     - `status` → swap top-level render mode (pre-game placard, live,
       final-score card).
     - `heartbeat` → flip status pill between `live` and `stale`.
     - `error` → flag `reconnecting` / `disconnected` and let
       `EventSource`'s native reconnect handle the rest.
4. On next player refresh, step 2 runs again; JS state is discarded.

Refresh cadence:

- SSE is the primary path — push-driven, no widget-side interval.
- `refreshInterval` (seconds, widget property, default 30) is only used
  when SSE is unavailable (disabled runtime, blocked at a firewall,
  etc.). In that branch the widget will poll `GET /snapshot?...` at the
  configured cadence. Phase-1 wiring for that fallback lands in the
  **MVP CROWDAQ widget rendering** iter.

---

## Widget properties

See `modules/crowdaq-widget.xml` for the authoritative definitions. The
manifest currently exposes these operator-visible widget-level properties:

| id | Type | Default | Purpose |
|---|---|---|---|
| `eventId` | text | _(empty)_ | Pin the widget to a specific CROWDAQ event. Empty ⇒ backend picks the best live event for the display. |
| `refreshInterval` | number | 30 | Fallback poll cadence (seconds) when SSE is unavailable. Min 5. |
| `theme` | dropdown | `dark` | Palette: `dark` or `light`. |
| `showTeamLogos` | checkbox | `true` | Whether to render `<img>` crests when the feed includes `logo_url`. |
| `showLastMoment` | checkbox | `true` | Whether to render the last-moment text row. |
| `maxMomentLength` | number | 80 | Character cap for the last-moment text; longer strings end with `…`. Only visible when `showLastMoment` is on. |

---

## Responsibilities

| Layer              | Repo / location                    | Owns |
|--------------------|------------------------------------|------|
| CROWDAQ backend    | `founding` repo (k8s manifests)    | SSE endpoint, match ingest, excitement scoring |
| Xibo CMS infra     | `xibo` repo                        | MySQL, XMR, CMS Deployment, k8up backups, Flux binding |
| Bar PC bootstrap   | `xibo` repo (`infra/bar-pc/`)      | Debian bootstrap, tailnet join, player install |
| CROWDAQ plugin     | **this repo**                      | XML manifest, inline Twig stencil, CROWDAQ datatype declaration |

---

## Open questions (manifest iter)

1. **Backend base URL injection.** `<onRender>` currently reads
   `window.crowdaqBackendBase` — the MVP-widget iter must decide whether
   this is a CMS-level module setting (written into `<settings>` in the
   manifest) or a hostname baked into the bar-player bootstrap (lives
   in `infra/bar-pc/` in the `xibo` repo).
2. **Display id surfacing.** `xiboIC.get(id, 'displayId')` is the best
   current guess for how the player exposes its display id to the
   widget — to be confirmed against the actual xibo-cms player runtime.
3. **Back-channel (widget → CROWDAQ).** Phase 1 is one-way SSE. If the
   widget ever needs to emit viewer-side signals (e.g. display taps),
   that's a phase-2 upgrade and will likely introduce a PHP data
   provider under `src/` (currently empty — see `src/README.md`).
4. **Packaging.** Does Xibo CMS accept a single zip drop into `custom/`,
   or does it need to be unpacked into a specific subdirectory? The
   release iter must confirm against the real CMS Deployment.
