# CROWDAQ Xibo Plugin

An open-source [Xibo CMS](https://xibosignage.com/) custom module that renders
[CROWDAQ](#what-is-crowdaq) sports-excitement content on Xibo-managed digital
signage screens (typically bar TVs).

> Status: **scaffold** — structure and placeholders only. Real manifest, Twig
> stencil, data fetch, and CI are filled in by follow-up iterations (see
> `docs/ARCHITECTURE.md` and the CROWDAQ + Xibo Delivery Infra Notion project).

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

Xibo CMS supports **Custom Modules**: XML-defined widgets (with a Twig
stencil and, optionally, a PHP data-provider class) that are dropped into
the CMS `custom/` directory.

## What this plugin does

This plugin ships a **CROWDAQ widget** that a layout designer can drag onto
a Xibo region. The widget:

1. Fetches the latest CROWDAQ feed from the CROWDAQ backend (data contract
   defined in the Notion `Define CROWDAQ data source contract` task).
2. Renders the payload through a Twig stencil that becomes the HTML
   delivered to the player.
3. Supports Xibo's **display tags** so operators can target specific bars
   (see `Multi-bar targeting via display tags`).

Phase 1 scope is intentionally minimal (single widget, read-only). See the
Notion decision `Decide CROWDAQ plugin phase-1 scope [DECIDED]`.

---

## Repository layout

```
xibo-plugin/
├── README.md               This file.
├── LICENSE                 AGPL-3.0 (matches Xibo CMS).
├── .gitignore
├── .editorconfig
├── .github/workflows/      CI placeholder (PHP lint, composer validate, release zip).
├── composer.json           Autoload + dev tooling.
├── modules/
│   └── crowdaq-widget.xml  Xibo module manifest (stub).
├── stencils/
│   └── crowdaq-widget.twig Xibo render template (stub).
├── src/Widget/
│   └── CrowdaqWidget.php   Optional PHP data-provider class (stub).
├── docs/
│   └── ARCHITECTURE.md     High-level data flow.
└── dist/                   Release artifacts (gitignored).
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
composer run lint      # php -l on all php files
composer run analyse   # phpstan
composer run cs        # php-cs-fixer dry-run
```

The CI workflow under `.github/workflows/ci.yml` runs the same commands on
every push and pull request.

## Release

`composer run package` builds `dist/crowdaq-xibo-plugin-<version>.zip` with
the module layout Xibo expects (the contents of `modules/`, `stencils/`,
and `src/` — no dev files). This script is **not yet implemented** — see
the CI workflow for the intended layout.

## License

This plugin is released under the
[GNU Affero General Public License, version 3](LICENSE), matching Xibo CMS
itself. Any distribution of a modified version of this plugin must also be
released under AGPL-3.0.

## Contributing

This repository is currently developed as part of the CROWDAQ founding
company. External contribution guidelines will land with the phase-1
public release.
