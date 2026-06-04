/**
 * SPEC-CRWDQ-052 / -053 — headless standing-display e2e smoke (the S8 deliverable).
 *
 * Proves the FULL player path end-to-end in a real headless Chromium against a
 * MOCK crowdaq.v1 WS server, for the two non-game standing-display modes the
 * backend already emits for a no-games window:
 *
 *   safe_info — PlannedState(business_mode=safe_info) over an empty ProgramSlot
 *               (exactly the live S7 re-push) mounts the SPEC-CRWDQ-052 panel:
 *               a <section class="crowdaq-safe-info"> with the CROWDAQ wordmark
 *               + the venue line resolved from the ConfigPush city/state.
 *
 *   ambient   — PlannedState(business_mode=ambient) + an AssetManifest carrying
 *               two `ambient:` creatives mounts the SPEC-CRWDQ-053 template
 *               (<section class="crowdaq-ambient">), paints the first creative,
 *               and ROTATES to the second on the dwell boundary.
 *
 * Together with single-game-smoke.mjs (single_game still renders) this proves
 * the activator cleanly switches templates on PlannedState business_mode — the
 * "bar shows something 24/7" gap is closed.
 *
 * Run:  node tests/e2e/standing-display-smoke.mjs
 * Env:  EVIDENCE_DIR overrides where the screenshots + run.json are written.
 */
import { chromium } from 'playwright';
import { startMockServer } from './mock-crowdaq-server.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetRoot = resolve(here, '..', '..');
const BUNDLE = resolve(widgetRoot, 'dist', 'crowdaq-widget-v2.global.js');
const HARNESS = resolve(here, 'harness.html');
const EVIDENCE_DIR =
  process.env.EVIDENCE_DIR ??
  resolve(widgetRoot, '..', '..', '..', 'crowdaq-backend', 'docs', 'flight', 'evidence', 's8-standing-display', 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

/** Start a tiny static server for harness.html + the bundle; returns {url,close}. */
async function startStatic() {
  const bundleJs = readFileSync(BUNDLE, 'utf8');
  const harnessHtml = readFileSync(HARNESS, 'utf8');
  const http = createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(bundleJs);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(harnessHtml);
    }
  });
  await new Promise((r) => http.listen(0, r));
  const port = http.address().port;
  return { port, url: `http://127.0.0.1:${port}/harness.html`, close: () => new Promise((r) => http.close(r)) };
}

async function bootPage(browser, statics, wsUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => console.log('  [page]', m.text()));
  page.on('pageerror', (e) => console.log('  [page-error]', e.message));
  await page.goto(statics.url, { waitUntil: 'load' });
  await page.addScriptTag({ url: `http://127.0.0.1:${statics.port}/bundle.js` });
  const hasGlobal = await page.evaluate(() => typeof window.CrowdaqWidgetV2?.boot === 'function');
  assert(hasGlobal, 'CrowdaqWidgetV2.boot global present after bundle load');
  await page.evaluate((u) => window.__bootWidget(u), wsUrl);
  return page;
}

async function proveSafeInfo(browser, statics, result) {
  const server = await startMockServer({ scenario: 'safe_info' });
  console.log(`[e2e] safe_info mock: ${server.url}`);
  try {
    const page = await bootPage(browser, statics, server.url);

    // The safe_info template mounts: a <section class="crowdaq-safe-info">.
    await page.waitForSelector('section.crowdaq-safe-info', { timeout: 10_000 });
    const title = (await page.textContent('[data-testid="safe-info-title"]'))?.trim();
    const venue = (await page.textContent('[data-testid="safe-info-venue"]'))?.trim();
    const source = await page.getAttribute('[data-testid="safe-info-root"]', 'data-source');
    assert(title === 'CROWDAQ', `safe wordmark == "CROWDAQ" (got "${title}")`);
    assert(venue === 'OAKLAND, CA', `venue line from ConfigPush city/state (got "${venue}")`);
    assert(source === 'backend_planned', `backend-planned safe source (got "${source}")`);

    const path = resolve(EVIDENCE_DIR, 'e2e-safe-info.png');
    await page.screenshot({ path });
    console.log(`[e2e] screenshot safe_info: ${path}`);
    result.steps.push(`safe_info: <section.crowdaq-safe-info> title="${title}" venue="${venue}" source=${source}`);
    result.safeInfo = { title, venue, source, screenshot: path };

    // No single_game DOM leaked in.
    const sg = await page.$('section.crowdaq-single-game');
    assert(sg === null, 'no single_game DOM present in the safe_info render');
    await page.close();
  } finally {
    await server.close();
  }
}

async function proveAmbient(browser, statics, result) {
  const server = await startMockServer({ scenario: 'ambient' });
  console.log(`[e2e] ambient mock: ${server.url}`);
  try {
    const page = await bootPage(browser, statics, server.url);

    // The ambient template mounts: a <section class="crowdaq-ambient"> with a
    // creative whose data-asset-id is the first ambient asset (lexical order).
    await page.waitForSelector('section.crowdaq-ambient .cdq-ambient-creative', { timeout: 10_000 });
    const first = await page.getAttribute('.cdq-ambient-creative', 'data-asset-id');
    assert(first === 'ambient:promo-1', `first creative == ambient:promo-1 (got "${first}")`);

    const beforePath = resolve(EVIDENCE_DIR, 'e2e-ambient-1.png');
    await page.screenshot({ path: beforePath });
    console.log(`[e2e] screenshot ambient #1: ${beforePath}`);

    // The dwell boundary (2000 ms) rotates to the second creative IN PLACE.
    await page.waitForFunction(
      () => document.querySelector('.cdq-ambient-creative')?.dataset?.assetId === 'ambient:promo-2',
      { timeout: 10_000 },
    );
    const second = await page.getAttribute('.cdq-ambient-creative', 'data-asset-id');
    assert(second === 'ambient:promo-2', `rotated to ambient:promo-2 (got "${second}")`);

    const afterPath = resolve(EVIDENCE_DIR, 'e2e-ambient-2.png');
    await page.screenshot({ path: afterPath });
    console.log(`[e2e] screenshot ambient #2: ${afterPath}`);
    result.steps.push(`ambient: rotated ${first} -> ${second} on the dwell boundary`);
    result.ambient = { first, second, screenshots: [beforePath, afterPath] };
    await page.close();
  } finally {
    await server.close();
  }
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const statics = await startStatic();
  const browser = await chromium.launch({ headless: true });
  const result = { steps: [], passed: false };
  try {
    await proveSafeInfo(browser, statics, result);
    await proveAmbient(browser, statics, result);
    result.passed = true;
    console.log('\n[e2e] PASS — safe_info + ambient standing displays mount + render');
  } finally {
    await browser.close();
    await statics.close();
    const runJson = resolve(EVIDENCE_DIR, '..', 'e2e-standing-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[e2e] run summary: ${runJson}`);
  }
  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
