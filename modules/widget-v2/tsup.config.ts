import { defineConfig } from 'tsup';

/**
 * Bundle the Widget v2 runtime into a single self-contained IIFE the Xibo
 * `<onRender>` can inline + eval. The player runs a strict-confined snap
 * Chromium (4.x), so the target is ES2019-ish — no top-level await, no bare ESM
 * imports the webview cannot resolve. The bundle exposes a single global,
 * `CrowdaqWidgetV2`, with `.boot(target, properties, deps)`.
 *
 * Everything is inlined (`noExternal` catch-all): the runtime has no runtime
 * npm dependencies, so the IIFE is fully self-contained — nothing for the
 * webview to fetch.
 */
export default defineConfig({
  entry: { 'crowdaq-widget-v2': 'src/index.ts' },
  format: ['iife'],
  globalName: 'CrowdaqWidgetV2',
  target: 'es2019',
  platform: 'browser',
  outDir: 'dist',
  minify: true,
  sourcemap: false,
  treeshake: true,
  clean: true,
  // No runtime deps — bundle everything so the IIFE is self-contained.
  noExternal: [/.*/],
  dts: false,
});
