# CROWDAQ Xibo Plugin

An open-source [Xibo CMS](https://xibosignage.com/) custom module that renders
[CROWDAQ](#what-is-crowdaq) sports-excitement content on Xibo-managed digital
signage screens (typically bar TVs).

This repo ships **two widget generations side-by-side**:

- **v1 (legacy, SSE)** — `modules/crowdaq-widget.xml`. An XML-first Xibo
  module: an inline Twig stencil plus inline `onRender` JS that opens a
  CROWDAQ **Server-Sent Events** stream directly from the rendered widget
  HTML. Client-side only, no PHP. Its prose docs are archived under
  [`docs/archive/v1/`](docs/archive/v1/) and the SSE wire contract lives at
  `docs/contract/` (see [`docs/archive/v1/`](docs/archive/v1/)). v1 still
  ships and still works; it is no longer where new development happens.
- **v2 (current / active, WebSocket + JSONL)** — `modules/widget-v2/`. A
  TypeScript player runtime (`@crowdaq/widget-v2`) built with `tsup`,
  speaking a **WebSocket + JSONL wire protocol** to the CROWDAQ backend.
  This is where active development and the backend orchestration infra are
  heading. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
  [`docs/WIRE_PROTOCOL.md`](docs/WIRE_PROTOCOL.md).

> Status: **v2 wire barrel built; transport + render templates pending.**
> The v2 wire-protocol surface (`modules/widget-v2/src/wire.ts` —
> SPEC-CRWDQ-017) is implemented and tested. The v2 WebSocket transport
> (SPEC-CRWDQ-022) and the render templates are specified under
> [`docs/specs/`](docs/specs/) but **not yet built**. The v1 widget
> (manifest + Twig stencil + SSE `onRender` JS) is complete and shipping.

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
needed when the CMS itself must fetch the feed (neither widget generation
needs one — v1 opens its SSE stream directly from the rendered widget HTML,
and v2's TypeScript runtime opens its own WebSocket).

## What this plugin does

This plugin ships a **CROWDAQ widget** that a layout designer can drag onto
a Xibo region. Two generations exist:

### v1 — legacy SSE widget (`modules/crowdaq-widget.xml`)

The v1 widget:

1. Fetches the latest CROWDAQ feed from the CROWDAQ backend over **SSE**
   (`GET /events/{eventId}/stream`) — the v1 wire contract lives at
   `docs/contract/` (archived alongside the v1 prose docs under
   [`docs/archive/v1/`](docs/archive/v1/)).
2. Renders the payload through an inline Twig stencil in
   [`modules/crowdaq-widget.xml`](modules/crowdaq-widget.xml). The inline
   copy is the sole source of truth.
3. Resolves per-bar values (CROWDAQ event id, backend URL) from the Xibo
   Player's local `xiboIC.info()` response so one layout can serve many
   bars (`display:<field>` substitution — recommended field `displayName`).
   The full walkthrough lives in
   [`docs/archive/v1/TARGETING.md`](docs/archive/v1/TARGETING.md), with the
   data flow and property table in
   [`docs/archive/v1/ARCHITECTURE.md`](docs/archive/v1/ARCHITECTURE.md) and
   operations in [`docs/archive/v1/OPERATIONS.md`](docs/archive/v1/OPERATIONS.md).

v1 is intentionally minimal (single widget, read-only) and is preserved as a
working fallback. It is not receiving new features.

### v2 — current WebSocket + JSONL runtime (`modules/widget-v2/`)

The v2 widget is a **TypeScript player runtime**, not an inline-JS stencil.
It speaks a bidirectional **WebSocket + JSONL wire protocol** to the CROWDAQ
backend instead of one-way SSE. The live contract is:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the v2 WebSocket
  architecture (transport, channels, dispatch, render loop).
- [`docs/WIRE_PROTOCOL.md`](docs/WIRE_PROTOCOL.md) — the wire-protocol
  reference generated from `wire.ts`.
- [`modules/widget-v2/src/wire.ts`](modules/widget-v2/src/wire.ts) — the
  implemented, in-repo wire barrel (SPEC-CRWDQ-017): JSONL envelope, two
  channels (`control` + `game_data`), the 20-value message-type enum,
  parser/serializer, and the error taxonomy. `src/index.ts` re-exports it.

Everything beyond the wire barrel — the WebSocket transport
(SPEC-CRWDQ-022) and the render templates — is **specified but not yet
built**. The 16 planned-surface specs live under
[`docs/specs/`](docs/specs/) (see [`docs/specs/index.md`](docs/specs/index.md)
for the catalog and [`docs/specs/buildorder.md`](docs/specs/buildorder.md)
for the dependency-ordered build sequence).

---

## Data contract

### v1 SSE contract (legacy)

The v1 CROWDAQ → widget wire protocol is specified formally under
`docs/contract/` (archived with the rest of the v1 docs — see
[`docs/archive/v1/`](docs/archive/v1/)):

- `openapi.yaml` — OpenAPI 3.1 spec for the single SSE endpoint
  `GET /events/{eventId}/stream`, error responses, and Bearer-token auth.
- `events/` — one JSON Schema (Draft 2020-12) per SSE event type:
  `score-update.json` (primary snapshot), `moment.json` (notable-moment
  announcement), `status.json` (event-lifecycle transitions),
  `heartbeat.json` (keepalive), and `error.json` (stream-level error).

CI (`.github/workflows/ci.yml`) enforces OpenAPI validity via
`@redocly/cli lint` and JSON Schema meta-validity (Draft 2020-12) via
`ajv-cli`.

### v2 WebSocket + JSONL wire protocol (current)

The v2 contract is **code-first**: the authoritative surface is
[`modules/widget-v2/src/wire.ts`](modules/widget-v2/src/wire.ts), documented
in [`docs/WIRE_PROTOCOL.md`](docs/WIRE_PROTOCOL.md) and framed architecturally
in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). It defines a JSONL
envelope over two channels (`control`, `game_data`), a closed 20-value
message-type enum, and an error taxonomy. The transport that consumes it is
planned per [`docs/specs/`](docs/specs/).

Anywhere docs disagree with the formal spec or the wire barrel, the code /
formal spec wins.

---

## Repository layout

```
xibo-plugin/
├── README.md                      This file.
├── LICENSE                        AGPL-3.0 (matches Xibo CMS).
├── .gitignore
├── .editorconfig
├── .eslintrc.cjs                  ESLint rules for the v1 extracted onRender JS.
├── .github/workflows/ci.yml       PHP lint, onRender lint, contract, release zip.
├── composer.json                  v1 PHP autoload + dev tooling.
├── scripts/
│   └── extract-onrender.mjs       Pulls v1 <onRender> CDATA out of the XML for lint.
├── modules/
│   ├── crowdaq-widget.xml         v1 — Xibo module manifest + inline Twig stencil + SSE onRender JS.
│   ├── assets/                    v1 widget assets.
│   └── widget-v2/                 v2 — TypeScript player runtime (@crowdaq/widget-v2).
│       ├── package.json           npm manifest (node 20.x); build/test/lint/typecheck scripts.
│       ├── tsup.config.ts         Bundler config (ESM + CJS + d.ts).
│       ├── tsconfig.json          TypeScript compiler config.
│       ├── vitest.config.ts       Test runner config.
│       ├── .eslintrc.cjs          ESLint config for the TS sources.
│       ├── src/
│       │   ├── wire.ts            SPEC-CRWDQ-017 wire barrel (envelope, channels, 20 msg types, parse/serialize, errors).
│       │   └── index.ts           Bundle entry point; re-exports the wire barrel.
│       └── tests/
│           ├── setup.ts           Vitest setup (jsdom + fake-indexeddb shims).
│           ├── shims.test.ts      Sanity check on the test environment shims.
│           └── wire.test.ts       Wire-barrel tests.
├── datatypes/
│   └── crowdaq-event.xml          v1 data-provider field registry for the widget.
├── src/
│   └── README.md                  Why this PHP directory is empty (see also widget-v2 for v2).
├── docs/
│   ├── ARCHITECTURE.md            v2 WebSocket architecture.
│   ├── WIRE_PROTOCOL.md           v2 wire-protocol reference (wire.ts).
│   ├── contract/                  v1 SSE contract (OpenAPI + JSON Schemas).
│   │   ├── openapi.yaml
│   │   └── events/                score-update / moment / status / heartbeat / error schemas.
│   ├── archive/v1/                Archived v1 prose docs.
│   │   ├── ARCHITECTURE.md        v1 data flow + render loop + property table.
│   │   ├── OPERATIONS.md          v1 operations runbook.
│   │   └── TARGETING.md           v1 multi-bar targeting walkthrough.
│   └── specs/                     v2 planned-surface specs.
│       ├── index.md               Spec catalog (16 SPEC-CRWDQ-NNN specs).
│       ├── buildorder.md          Dependency-ordered build sequence.
│       └── SPEC-CRWDQ-*.md        The 16 widget-v2 specs.
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

### v1 (PHP / Xibo module)

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

### v2 (TypeScript runtime)

Requires Node **20.x**. From `modules/widget-v2/`:

```
cd modules/widget-v2
npm install
```

## Test

### v1

```
composer run lint      # php -l on all php files (no-op on an empty src/)
composer run analyse   # phpstan
composer run cs        # php-cs-fixer dry-run
```

### v2

From `modules/widget-v2/`:

```
npm run build       # tsup — bundle ESM + CJS + d.ts
npm run test        # vitest run
npm run lint        # eslint (--max-warnings=0)
npm run typecheck   # tsc --noEmit
```

The CI workflow under `.github/workflows/ci.yml` runs the relevant commands
on every push and pull request.

## Release

`composer run package` is intended to build
`dist/crowdaq-xibo-plugin-<version>.zip` with the module layout Xibo expects
(the contents of `modules/`, `datatypes/`, and `src/` — no dev files). This
script is **not yet implemented** — see the CI workflow for the intended
layout. The v2 bundle's release packaging lands with the v2 transport work.

## License

This plugin is released under the
[GNU Affero General Public License, version 3](LICENSE), matching Xibo CMS
itself. Any distribution of a modified version of this plugin must also be
released under AGPL-3.0.

## Contributing

This repository is currently developed as part of the CROWDAQ founding
company. External contribution guidelines will land with the phase-1
public release.
