# CROWDAQ Xibo Plugin

An open-source [Xibo CMS](https://xibosignage.com/) custom module that renders
[CROWDAQ](#what-is-crowdaq) sports-excitement content on Xibo-managed digital
signage screens (typically bar TVs).

> Status: **manifest + stencil authored** — the module manifest and
> inline Twig stencil are real. The live backend wire-up (SSE fetch,
> multi-bar targeting, release packaging, CI packaging) is filled in by
> follow-up iterations (see `docs/ARCHITECTURE.md` and the
> CROWDAQ + Xibo Delivery Infra Notion project).

---

## What is CROWDAQ

CROWDAQ is a sports-excitement engine: it ingests live sports signals and
produces a stream of short, high-energy content intended to be rendered on
passive screens in public venues (primarily bars) to lift the room when a
match heats up. CROWDAQ owns the content/engine side.

## What is Xibo

[Xibo](https://xibosignage.com/) is an open-source digital signage platform
with two halves:

- **Xibo CMS** — PHP web app that schedules layouts to displays. The CMS is
  licensed under AGPL-3.0.
- **Xibo Player** — a desktop or Android client that pulls layouts from the
  CMS and renders them on a screen.

Xibo CMS 4.x supports **Custom Modules** as **XML-first**: a widget is fully
defined by its `<module>` manifest (with an inline Twig stencil) dropped into
the CMS `custom/` directory. A PHP data-provider class is optional and only
needed when the CMS itself must fetch the feed (phase 1 does not need one —
the Xibo Player opens the CROWDAQ SSE stream directly from the rendered
widget HTML).

## What this plugin does

This plugin ships a **CROWDAQ widget** that a layout designer can drag onto
a Xibo region. The widget:

1. Fetches the latest CROWDAQ feed from the CROWDAQ backend over SSE
   (`GET /stream?display_id=…&event_id=…`) — data contract documented in
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and declared to Xibo as
   the `crowdaq-event` datatype in [`datatypes/crowdaq-event.xml`](datatypes/crowdaq-event.xml).
2. Renders the payload through an inline Twig stencil in
   [`modules/crowdaq-widget.xml`](modules/crowdaq-widget.xml). A mirror of
   just the Twig body is also kept at
   [`stencils/crowdaq-widget.twig`](stencils/crowdaq-widget.twig) for
   IDE-friendly editing — the inline copy is the one the CMS reads.
3. Supports Xibo's **display tags** so operators can target specific bars
   (see the `Multi-bar targeting via display tags` iter).

Phase 1 scope is intentionally minimal (single widget, read-only). See the
Notion decision `Decide CROWDAQ plugin phase-1 scope [DECIDED]`.

---

## Data contract

The CROWDAQ → widget wire protocol is specified formally under
[`docs/contract/`](docs/contract/):

- [`docs/contract/openapi.yaml`](docs/contract/openapi.yaml) — OpenAPI
  3.1 spec for the single SSE endpoint
  `GET /events/{eventId}/stream`, error responses, and Bearer-token
  auth (Phase-2).
- [`docs/contract/events/`](docs/contract/events/) — one JSON Schema
  (Draft 2020-12) per SSE event type:
  - [`score-update.json`](docs/contract/events/score-update.json) —
    primary snapshot; consumed by the widget DOM renderer. Shape mirrors
    [`datatypes/crowdaq-event.xml`](datatypes/crowdaq-event.xml) 1:1.
  - [`moment.json`](docs/contract/events/moment.json) — standalone
    notable-moment announcement.
  - [`status.json`](docs/contract/events/status.json) — event-lifecycle
    transitions.
  - [`heartbeat.json`](docs/contract/events/heartbeat.json) —
    keepalive / liveness ping.
  - [`error.json`](docs/contract/events/error.json) — stream-level
    error.

Anywhere docs disagree with the formal spec, the formal spec wins. CI
(`.github/workflows/ci.yml`, job `contract`) enforces:

- OpenAPI validity via `@redocly/cli lint` (pinned).
- JSON Schema meta-validity (Draft 2020-12) via `ajv-cli` (pinned).

### Overriding the backend URL

The OpenAPI `servers[0].url` is the placeholder
`https://api.crowdaq.example/v1`. The real hostname is tailnet-only and
is not committed. At deploy time the Xibo Player reads the backend base
URL from a browser global injected by the bar-PC bootstrap (see the
`xibo` repo, `infra/bar-pc/`): `window.crowdaqBackendBase`. The widget's
`eventId` property is appended verbatim to produce the full stream URL.

## Widget properties

Operators configure the widget instance via the standard Xibo property
panel. The manifest exposes:

| Property | Type | Default | Purpose |
|---|---|---|---|
| `eventId` | text | _(empty)_ | Pin to a specific CROWDAQ event. Empty ⇒ backend picks the best live event for the display. |
| `refreshInterval` | number | `30` (seconds) | Fallback polling cadence when SSE is unavailable. Minimum 5. |
| `theme` | dropdown (`dark` / `light`) | `dark` | Colour palette. |
| `showTeamLogos` | checkbox | `true` | Render team crest images when `logo_url` is present in the feed. |
| `showLastMoment` | checkbox | `true` | Show the most recent notable moment text. |
| `maxMomentLength` | number | `80` | Character cap for the last-moment text. Only shown when `showLastMoment` is on. |

Changing a property requires no CMS restart — Xibo picks up widget-level
changes on the next layout publish.

---

## Repository layout

```
xibo-plugin/
├── README.md                      This file.
├── LICENSE                        AGPL-3.0 (matches Xibo CMS).
├── .gitignore
├── .editorconfig
├── .github/workflows/ci.yml       PHP lint, composer validate, release zip.
├── composer.json                  Autoload + dev tooling.
├── modules/
│   └── crowdaq-widget.xml         Xibo 4.4.2 module manifest + inline stencil.
├── stencils/
│   └── crowdaq-widget.twig        IDE-friendly mirror of the inline stencil.
├── datatypes/
│   └── crowdaq-event.xml          Data-provider field registry for the widget.
├── src/
│   └── README.md                  Why this directory is empty in phase 1.
├── docs/
│   ├── ARCHITECTURE.md            Data flow + property table; links into contract/.
│   └── contract/
│       ├── openapi.yaml           OpenAPI 3.1 spec for the SSE endpoint.
│       └── events/
│           ├── score-update.json  Match-snapshot payload schema (primary tick).
│           ├── moment.json        Notable-moment announcement schema.
│           ├── status.json        Event-lifecycle transition schema.
│           ├── heartbeat.json     Keepalive schema.
│           └── error.json         Stream-level error schema.
└── dist/                          Release artifacts (gitignored).
```

## Install (development CMS)

> This requires a working Xibo CMS instance. For the founding-company
> deployment see the `xibo` infrastructure repo.

1. Build a release zip (see [Release](#release)).
2. Unzip its contents into your Xibo CMS `custom/` directory.
3. Restart the CMS container so the module registry is re-scanned.
4. The CROWDAQ widget appears in the layout designer under the media picker.

## Develop

Requires:

- PHP **8.1+** (Xibo 4.x CMS runtime).
- [Composer](https://getcomposer.org/) 2.x.
- A local Xibo CMS instance to test against (Docker Compose is the upstream
  recommendation — see the `xibo` infra repo for the Kubernetes version we
  run in production).

```
composer install
```

For iterative work, mount this repo into your CMS container at
`/var/www/cms/custom/crowdaq/` (bind mount or Kubernetes hostPath) and
reload the CMS.

## Test

```
composer run lint      # php -l on all php files (no-op on an empty src/)
composer run analyse   # phpstan
composer run cs        # php-cs-fixer dry-run
```

The CI workflow under `.github/workflows/ci.yml` runs the same commands on
every push and pull request.

## Release

`composer run package` is intended to build
`dist/crowdaq-xibo-plugin-<version>.zip` with the module layout Xibo expects
(the contents of `modules/`, `stencils/`, `datatypes/`, and `src/` — no dev
files). This script is **not yet implemented** — see the CI workflow for
the intended layout.

## License

This plugin is released under the
[GNU Affero General Public License, version 3](LICENSE), matching Xibo CMS
itself. Any distribution of a modified version of this plugin must also be
released under AGPL-3.0.

## Contributing

This repository is currently developed as part of the CROWDAQ founding
company. External contribution guidelines will land with the phase-1
public release.
