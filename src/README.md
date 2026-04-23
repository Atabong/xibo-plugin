# `src/` — CROWDAQ Xibo plugin PHP sources

This directory is intentionally empty in phase 1.

Xibo CMS 4.x custom modules are **XML-first**: a widget is fully defined
by its `<module>` manifest under `modules/` and an inline `<stencil>`
block (mirrored for IDE editing under `stencils/`). A server-side PHP
data-provider class is **optional**, used only when the CMS must fetch
and cache the feed itself (e.g. for signed tokens or backend caching).

The upstream Xibo 4.4.2 reference modules that require no PHP class:

- [`modules/text.xml`](https://github.com/xibosignage/xibo-cms/blob/4.4.2/modules/text.xml)
- [`modules/countdown-text.xml`](https://github.com/xibosignage/xibo-cms/blob/4.4.2/modules/countdown-text.xml)
- [`modules/embedded.xml`](https://github.com/xibosignage/xibo-cms/blob/4.4.2/modules/embedded.xml)

Each of those declares an empty `<class></class>` element — the same
pattern we follow in `modules/crowdaq-widget.xml`.

## When we'd add PHP here

The **MVP CROWDAQ widget rendering** iteration will decide whether the
widget needs a PHP data provider. Triggers that would flip us to "yes":

1. The bar players cannot reach the CROWDAQ backend directly — e.g.
   because we move from tailnet ACLs to a short-lived JWT that the CMS
   must mint per render.
2. We need server-side fallback / sample-data generation beyond what the
   manifest's `<sampleData>` block can express.
3. The widget needs to participate in Xibo's widget cache — which
   requires implementing `\Xibo\Widget\Provider\DataProviderInterface`
   (the 4.x replacement for the legacy `\Xibo\Widget\ModuleWidget`).

If any of those trigger, the follow-up iter will add a class under
`CROWDAQ\Xibo\Widget\CrowdaqWidgetProvider` in this directory, register
it in `modules/crowdaq-widget.xml` via the `<class>` element, and extend
the composer dev-only dependency on the xibo-cms source tree.

Until then: the PSR-4 autoload in `composer.json`, the `composer run
lint` `find src -type f -name '*.php'` loop, and the release-zip job in
`.github/workflows/ci.yml` all handle an empty `src/` as a clean no-op.
