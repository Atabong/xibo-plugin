# CROWDAQ Xibo Plugin — Architecture

_Status: scaffold iter. Diagrams are textual; a rendered version will land
in the `Author architecture diagram (D2 -> Kroki -> wiki)` iteration._

---

## High-level data flow

```
+--------------------+      SSE       +--------------------+
|  CROWDAQ backend   |  (text/event-  |  CROWDAQ widget    |
|  (in-cluster pod,  |  stream, one-  |  (Twig stencil +   |
|  founding-crowdaq  |  way, HTTP)    |  optional PHP      |
|  namespace, Flux-  | -------------> |  provider) running |
|  managed)          |                |  inside a Xibo     |
+--------------------+                |  layout region     |
          ^                           +---------+----------+
          |                                     |
          |  Tailscale ACL                      |  served as part of the
          |  tag:bar-player                     |  layout HTML when the
          |  -> tag:crowdaq-api                 |  Xibo Player pulls it
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

```json
{
  "match_id": "worldcup-2026-semi-br-ar",
  "clock": {"minute": 78, "stoppage": 2, "period": "2H"},
  "score": {"home": 1, "away": 1},
  "excitement": {"level": 0.82, "trend": "rising"},
  "events": [
    {"type": "goal", "team": "home", "minute": 78, "clip_url": "..."}
  ],
  "next_update_hint_ms": 500
}
```

`events` is append-only. The widget renders the latest state and animates
on new event types.

---

## Responsibilities

| Layer              | Repo / location                    | Owns |
|--------------------|------------------------------------|------|
| CROWDAQ backend    | `founding` repo (k8s manifests)    | SSE endpoint, match ingest, excitement scoring |
| Xibo CMS infra     | `xibo` repo                        | MySQL, XMR, CMS Deployment, k8up backups, Flux binding |
| Bar PC bootstrap   | `xibo` repo (`infra/bar-pc/`)      | Debian bootstrap, tailnet join, player install |
| CROWDAQ plugin     | **this repo**                      | XML manifest, Twig stencil, optional PHP data provider |

---

## Open questions (scaffold iter)

1. Does the phase-1 widget need the optional PHP provider at all, or is
   the Twig stencil enough to open the SSE stream from the player's
   Chromium runtime? To be answered in the MVP-widget iter.
2. Exact `display_id -> bar slug` lookup: is it a single Xibo CMS API
   call per widget render, or a CROWDAQ-side cache keyed on display id?
3. Packaging: does Xibo CMS accept a single zip drop into `custom/`, or
   does it need to be unpacked into a specific subdirectory? Upstream
   docs to be checked in the manifest iter.
