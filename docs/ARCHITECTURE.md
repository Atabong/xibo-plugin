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
     `GET <apiBaseUrl>/events/<eventId>/stream` (see
     `docs/contract/openapi.yaml`). `apiBaseUrl` comes from the
     per-widget property of the same name; if the property is empty,
     the widget falls back to `window.crowdaqBackendBase` (set by the
     bar-PC bootstrap). If both are empty, the widget shows a
     "Configure apiBaseUrl" lifecycle banner and stops.
   - Route events by their SSE `event:` name to the right handler:
     - `score-update` → rewrite the score / excitement / last-moment
       DOM. Flash a green scale on the side whose score went up.
     - `moment` → replace the last-moment text line with the new
       `description` (truncated by `maxMomentLength`).
     - `status` → toggle a lifecycle banner overlay (pre-game,
       halftime, extra time, penalties, final, cancelled, postponed).
       The banner hides when `state === 'live'`.
     - `heartbeat` → reset the stale timer only.
     - `error` → display a small red error pill with the code/message
       and trigger a bounded reconnect.
4. On next player refresh, step 2 runs again; JS state (reconnect
   attempt counter, stale timer, score cache) is discarded.

Reconnect & stale rules:

- EventSource failures schedule a bounded reconnect using the backoff
  sequence `1s / 2s / 5s / 15s / 30s` (capped). After **5 failed
  attempts** the widget stops retrying, flips to `offline`, and fades
  the full-widget stale overlay.
- A successful reopen resets the attempt counter to 0 and clears any
  error pill.
- Stale indicator: any event (including `heartbeat`) resets a timer
  of `2 * refreshInterval` seconds. When it fires, the widget adds
  the `crowdaq-stale` class to the root and shows a faded overlay
  until the next event arrives.
- Cleanup: the widget listens for `beforeunload` / `pagehide` and
  closes the `EventSource` plus clears its timers.

Refresh cadence:

- SSE is the primary (and only) data path in phase 1. `refreshInterval`
  is only used as the stale-detection interval (`2 * refreshInterval`).
- A `/snapshot` fallback endpoint remains in the backlog
  (`docs/contract/openapi.yaml` documents only the SSE endpoint today);
  the MVP widget does not poll.

---

## Runtime rendering

The MVP widget keeps the CMS-side work minimal: the inline `<twig>`
block renders a placeholder DOM populated with **stable
`data-crowdaq-*` attributes** (not classes), and the `<onRender>` JS
selects and mutates those elements directly.

```
+---------------------+        CDATA <onRender>  IIFE entry
|  <twig> DOM          |  -->  (function () { ... })();
|  data-crowdaq-root   |
|  data-crowdaq-*      |        Property hydration:
|   (score, team,      |          apiBaseUrl  ← property → window.crowdaqBackendBase
|    excitement,       |          eventId     ← property
|    moment, status,   |          refreshInterval / flags / lengths
|    error pill, stale |
|    overlay)          |        Paint sampleData / cached items[0].
+----------+----------+        Open EventSource(url).
           |
           v
+----------+----------+        addEventListener(name, handler):
|  EventSource(url)    |          score-update → onScoreUpdate(payload)
|  url =               |          moment       → onMoment(payload)
|  apiBaseUrl          |          status       → onStatus(payload)
|  + /events/          |          heartbeat    → onHeartbeat()
|  + eventId           |          error        → onStreamError(payload)
|  + /stream           |
+----------+----------+        Every event resets resetStaleTimer().
           |
           v                   onerror → scheduleReconnect()
+---------------------+          delays [1,2,5,15,30]s, cap 5 attempts
|  DOM mutations       |
|  via data-crowdaq-*  |        beforeunload / pagehide → cleanup()
+---------------------+          (close EventSource, clear timers)
```

Event → selector mapping (what each handler touches):

| Event         | Source schema                              | DOM element(s) (data-crowdaq-*)                                                                                                                                                                                                            |
|---------------|--------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `score-update` | `docs/contract/events/score-update.json`   | `team-a-logo` / `team-a`, `team-b-logo` / `team-b`, `team-a-score`, `team-b-score` (with `.crowdaq-delta-flash` flash), `excitement-fill`, `excitement-value`, `excitement-trend`, `moment-text` (from `last_moment.text`), `status` pill    |
| `moment`      | `docs/contract/events/moment.json`         | `moment-text` (from `description`, truncated to `maxMomentLength`)                                                                                                                                                                           |
| `status`      | `docs/contract/events/status.json`         | `status-overlay` + `status-overlay-text` (banner shown for every state except `live`, which hides the banner)                                                                                                                                 |
| `heartbeat`   | `docs/contract/events/heartbeat.json`      | None directly — resets the stale timer + keeps `status` on `live`                                                                                                                                                                            |
| `error`       | `docs/contract/events/error.json`          | `error-pill` (shows `code` / `message`, truncated), triggers bounded reconnect                                                                                                                                                               |

---

## Widget properties

See `modules/crowdaq-widget.xml` for the authoritative definitions. The
manifest currently exposes these operator-visible widget-level properties:

| id | Type | Default | Purpose |
|---|---|---|---|
| `apiBaseUrl` | text | _(empty)_ | CROWDAQ backend base URL. Used as `<apiBaseUrl>/events/<eventId>/stream`. Validation pattern `^$|^https://.*`. Falls back to `window.crowdaqBackendBase` when empty; if both are empty the widget shows a "Configure apiBaseUrl" placeholder. |
| `eventId` | text | _(empty)_ | Pin the widget to a specific CROWDAQ event. Empty ⇒ the widget uses the literal `default` in the URL path and the backend picks the best live event for the display. |
| `refreshInterval` | number | 30 | Stale-detector interval (seconds). The widget flips to `stale` if no event (including heartbeat) arrives within `2 * refreshInterval`. Min 5. |
| `theme` | dropdown | `dark` | Palette: `dark` or `light`. |
| `showTeamLogos` | checkbox | `true` | Whether to render `<img>` crests when the feed includes `logo_url`. Falls back to the team abbreviation on `onerror`. |
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

## Open questions (MVP-widget iter)

1. **Backend base URL injection.** Resolved in iter16 as the
   per-widget `apiBaseUrl` property, with a `window.crowdaqBackendBase`
   fallback for bar-wide defaults. Still open: whether the bar-player
   bootstrap in the `xibo` repo should also expose `apiBaseUrl` as a
   CMS-level module setting so a single operator action picks the
   default for all new widgets. Deferred to a post-MVP polish iter.
2. **Auth token injection.** Out of scope for the MVP. The stream is
   currently open on the tailnet; JWT Bearer tokens are a phase-2
   upgrade documented in `docs/contract/openapi.yaml`.
3. **Multi-event streaming.** A single widget consumes one stream.
   Targeting multiple bars is a separate iter (multi-bar display tags).
4. **Player preview / offline cache.** The `<sampleData>` block is
   enough for the CMS layout editor preview; the Xibo Player itself
   does not yet cache the last-known payload to disk between reboots.
5. **Back-channel (widget → CROWDAQ).** Still phase-2. If the widget
   ever needs to emit viewer-side signals (display taps, analytics),
   that would reintroduce a PHP data provider under `src/`.
6. **Packaging.** Does Xibo CMS accept a single zip drop into
   `custom/`, or does it need to be unpacked into a specific
   subdirectory? The release iter must confirm against the real CMS
   Deployment.
