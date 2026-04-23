# Multi-bar targeting via display properties

_Status: loop iter17. Path chosen: **B (client-side substitution)**. See
"Why not Path A" below for the upstream evidence that ruled out
CMS-side `%displayTag(name)%` substitution against Xibo CMS 4.4.2._

The CROWDAQ widget is a regular Xibo 4.4.2 custom module. Each display
running a layout with this widget is a bar's Xibo Player. When a single
layout is assigned to many displays (the common operator case — one
"CROWDAQ live football" layout pushed to twenty bars), each bar needs
its own CROWDAQ event without duplicating the layout per-bar.

This doc describes how operators do that with a single layout.

## TL;DR

1. Pick which piece of per-display data will drive per-bar routing.
   Xibo CMS 4.4.2 exposes a fixed set of fields to widgets via
   `xiboIC.info()` on the player — see "Allowed fields" below. The
   recommended field is `displayName`.
2. In each bar's Xibo display record, put the CROWDAQ event id in that
   field (e.g. set `displayName` to `nfl-bills-chiefs-2026w8`).
3. In the widget's property panel, set `eventId` to
   `display:displayName`. The widget resolves that placeholder at
   render time on each bar, so bar A streams
   `/events/nfl-bills-chiefs-2026w8/stream` while bar B streams
   whatever its own `displayName` carries.

That is the whole model. No per-bar layouts, no CMS customisation, no
plugin config per bar.

## Allowed fields

The player's local `/info` endpoint (which `xiboIC.info()` wraps) is
documented by Xibo upstream to return exactly these fields on CMS
4.4.2. The widget only substitutes against this allowlist; anything
else is resolved to the empty string so a typo does not silently leak
into the stream URL.

| `display:<field>`     | Source (player /info) | Typical use |
|---                    |---                    |---          |
| `display:hardwareKey` | `hardwareKey`         | Internal routing when the event id lives in a backend registry keyed by hardware key. |
| `display:displayName` | `displayName`         | **Recommended.** Operator-friendly, editable in the Xibo CMS display record. |
| `display:timeZone`    | `timeZone`            | Content variants per region (e.g. `us-east` vs `eu-west`). |
| `display:latitude`    | `latitude`            | Geo-routing. |
| `display:longitude`   | `longitude`           | Geo-routing. |

Upstream reference:
[`xibosignage/xibo-interactive-control`](https://github.com/xibosignage/xibo-interactive-control)
(the library that defines the global) plus the Xibo player-control
docs page [Getting player information using JavaScript](https://account.xibosignage.com/docs/developer/player-control/getting-player-information-using-javascript).

## Worked example: three bars, three CROWDAQ events

Setup: the operator runs three bars, each with its own Xibo Player.
The goal is one "CROWDAQ live" layout that shows a different CROWDAQ
event per bar.

1. In the Xibo CMS, open each display record and set `displayName` to
   the CROWDAQ event id the bar should stream:

   | Bar              | `displayName`                   |
   |---               |---                              |
   | The Anchor Pub   | `nfl-bills-chiefs-2026w8`       |
   | Red Lion         | `mls-toronto-miami-2026-final`  |
   | Ocean View       | `epl-liverpool-arsenal-2026w14` |

2. Build a single layout. Drag a CROWDAQ widget onto a region. In the
   widget's property panel:

   - `apiBaseUrl` → the tenant's CROWDAQ backend (literal, e.g.
     `https://crowdaq.tailnet-tenant-a.ts.net`).
   - `eventId`    → `display:displayName`

3. Publish the layout to all three displays. Each player renders
   `/events/<its-own-displayName>/stream`. No per-bar layout clones.

### Inspecting what a bar actually rendered

The widget mirrors the resolved values onto two hidden elements in the
stencil (see `modules/crowdaq-widget.xml`):

```html
<span hidden data-crowdaq-resolved-event-id="nfl-bills-chiefs-2026w8"></span>
<span hidden data-crowdaq-resolved-api-base-url="https://crowdaq.tailnet-tenant-a.ts.net"></span>
```

These are cosmetic-only (hidden from the signage render) and exist so
a headless probe or DevTools session can confirm what a given bar
actually rendered without having to reach into the player's local
`/info` endpoint itself.

## Per-tenant backend via the same mechanism

`apiBaseUrl` accepts the same `display:<field>` syntax. If each tenant
runs their own CROWDAQ backend behind Tailscale and you want a single
layout to serve multiple tenants, point `apiBaseUrl` at a field that
encodes the tenant root URL (typically `displayName` doing double
duty is a bad idea — prefer a backend-side indirection: keep
`apiBaseUrl` literal for now, open an issue if you need this in
production). The widget's validation regex is:

```
^$|^https://.*|^display:[a-zA-Z][a-zA-Z0-9_]*$
```

## Fallback behaviour

- **Empty field on a display.** If `displayName` is blank on a bar's
  display record, `display:displayName` resolves to `""` and the
  widget falls through to its default eventId behaviour (`default`
  in the stream path). The backend is expected to treat this as
  "pick the best live event for this display" per the OpenAPI spec.
- **`xiboIC.info()` fails or times out.** The widget has a 5 s
  safety timeout around `xiboIC.info()`. On failure the resolution
  path treats the raw property as a literal (so `display:displayName`
  is effectively `"display:displayName"` — an invalid event id that
  the backend will reject with a clean 404). The lifecycle banner
  does not hide this; the error pill surfaces the backend response.
- **CMS editor preview.** `xiboIC.checkIsPreview()` returns true
  inside the CMS layout editor. The widget skips `xiboIC.info()`
  in that environment and keeps `display:<field>` as a literal so
  authors can see which displays will substitute what.

## Naming convention

For `displayName` values that encode a CROWDAQ event id (the
recommended use):

- Lowercase, hyphenated — matches the CROWDAQ event-id convention
  used in `docs/contract/openapi.yaml` (`eventId` path parameter,
  pattern `^[A-Za-z0-9][A-Za-z0-9._:-]*$`).
- No spaces, no `/`, no `?`, no `#` — the value is URL-encoded when
  it's spliced into the stream path but keeping it URL-safe in the
  CMS avoids surprises when an operator scans the display list.
- Prefix with the league or sport short code when ambiguous:
  `nfl-bills-chiefs-2026w8`, not `bills-chiefs-2026w8`.

## Bulk setup via the Xibo CMS API

Operators with many displays can set `displayName` en masse via the
Xibo CMS REST API rather than clicking through the UI. The shape
below is against the CMS 4.4.2 `/api/display/{displayId}` endpoint
(see the CMS OpenAPI at `/api/swagger.json` on your own CMS instance
for the full payload):

```bash
# 1. Get an OAuth2 token (standard client-credentials flow).
CMS="https://cms.example.com"
TOKEN=$(curl -s -X POST "$CMS/api/authorize/access_token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$XIBO_CLIENT_ID" \
  -d "client_secret=$XIBO_CLIENT_SECRET" \
  | jq -r '.access_token')

# 2. Set displayName on a specific display.
curl -X PUT "$CMS/api/display/42" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "display=nfl-bills-chiefs-2026w8" \
  -d "auditingUntil=0"
```

Notes:

- `display` is the Xibo API's field name for what the UI calls
  "Display Name". It is the same field `xiboIC.info()` returns as
  `displayName`.
- `auditingUntil=0` disables per-display audit logging from changing;
  drop it if you want to leave the existing value alone.
- Swap the endpoint for `/api/displaygroup` and use the group
  membership calls if you want to rename many displays in one shot.

## Why not Path A (CMS-side `%displayTag(name)%`)

The natural first thought is "Xibo already has display tags — can the
CMS just substitute a widget property with a tag value at publish
time?" The answer against **Xibo CMS 4.4.2** is **no**:

1. The module XML property system in 4.4.2 only supports Handlebars
   and Twig template expressions over the widget's own properties
   (see upstream
   [Creating a Module](https://account.xibosignage.com/docs/developer/widgets/creating-a-module)).
   There is no `%displayTag(name)%` or `{{tag.name}}` macro expanded
   by the CMS at publish time against a display's tags.
2. A grep of the upstream `xibosignage/xibo-cms` repo at tag
   `4.4.2` for `displayTag` returns zero hits in `modules/*.xml`.
   Every stock module either has no tag substitution or uses a
   widget property directly.
3. The community enhancement request
   [`xibosignage/xibo#2773` "Widgets: send display tags/values to the
   player"](https://github.com/xibosignage/xibo/issues/2773) is
   closed against milestone `4.0.0-alpha2` but the corresponding
   widget-side API never shipped in 4.4.2: `xiboIC` has no
   `getDisplayTags()` method, and the player's `/info` endpoint
   returns only `{hardwareKey, displayName, timeZone, latitude,
   longitude}` — no tags. Confirmed against
   `xibosignage/xibo-interactive-control` master and the upstream
   player-control docs.

Because Path A can't be implemented without inventing unsupported
syntax, the iter-17 hard constraint says "use Path B instead — do
NOT ship unverified `%...%` macros". That's what this widget does.

If a future Xibo CMS version exposes a real display-tag substitution
(server-side at publish time) or extends `xiboIC.info()` to return
tags, the widget should be re-cut to prefer that path — it's strictly
more powerful (many tags per display, arbitrary keys) than what
`displayName` can encode.

## Out of scope (iter17)

- Bulk display-tag (not `displayName`) management — Xibo's tag model
  is richer than `displayName`, and once a real per-display-tag
  surface exists in a future CMS release, this doc should be updated
  with the `%displayTag(...)%` syntax and the `display:` prefix kept
  only as a compatibility shim.
- A convention for encoding multiple per-bar knobs (event id +
  theme + pinned team) in one `displayName`. Today the widget's
  `theme` and `showTeamLogos` / `showLastMoment` flags are per-widget
  (per-layout), not per-display. For theme variation today, publish
  two layouts (dark / light) to two display groups.
- A CMS-API helper script. The `curl` example above is the contract;
  operators can wrap it in whatever orchestration they already use.
