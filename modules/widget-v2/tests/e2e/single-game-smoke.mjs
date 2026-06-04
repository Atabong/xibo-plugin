/**
 * SPEC-CRWDQ-027 — headless single_game e2e smoke (the S5 deliverable).
 *
 * Proves the FULL player path end-to-end in a real headless Chromium (the same
 * engine family as the player's snap Chromium), against a MOCK crowdaq.v1 WS
 * server emitting the real handshake + framing contract:
 *
 *   1. start the mock crowdaq.v1 server (enforces the no-trailing-newline
 *      framing rule + spec re-push order, live payload-nested envelopes);
 *   2. serve harness.html + the REAL tsup bundle over HTTP;
 *   3. launch headless Chromium, load the bundle, boot() against the mock WS;
 *   4. assert the single_game template mounts + renders the score (BRA 0 / ARG 0);
 *   5. screenshot BEFORE;
 *   6. push a GameEvent (goal) -> assert the score UPDATES IN PLACE (BRA 1);
 *   7. screenshot AFTER;
 *   8. assert the player never sent a trailing-newline frame (the mock would
 *      have closed 4000 and the render would have stalled — belt + braces).
 *
 * Run:  node tests/e2e/single-game-smoke.mjs
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
  resolve(widgetRoot, '..', '..', '..', 'crowdaq-backend', 'docs', 'flight', 'evidence', 's5-build');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const server = await startMockServer();
  console.log(`[e2e] mock crowdaq.v1 server: ${server.url}`);

  // Tiny static server for the harness page + the bundle.
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
  const httpPort = http.address().port;
  const pageUrl = `http://127.0.0.1:${httpPort}/harness.html`;

  const browser = await chromium.launch({ headless: true });
  const result = { steps: [], passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => console.log('  [page]', m.text()));
    page.on('pageerror', (e) => console.log('  [page-error]', e.message));

    await page.goto(pageUrl, { waitUntil: 'load' });

    // Load the REAL bundle into the page (a real <script>, real global).
    await page.addScriptTag({ url: `http://127.0.0.1:${httpPort}/bundle.js` });
    const hasGlobal = await page.evaluate(() => typeof window.CrowdaqWidgetV2?.boot === 'function');
    assert(hasGlobal, 'CrowdaqWidgetV2.boot global present after bundle load');
    result.steps.push('bundle loaded; CrowdaqWidgetV2.boot present');

    // Boot the widget against the mock WS. boot() resolves on the first server
    // frame (ConfigPush), then the spec re-push drives the single_game render.
    await page.evaluate((wsUrl) => window.__bootWidget(wsUrl), server.url);

    // Wait for the single_game template to mount + render the snapshot score.
    await page.waitForSelector('section.crowdaq-single-game', { timeout: 10_000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="single-game-home"]')?.textContent?.includes('BRA'),
      { timeout: 10_000 },
    );

    const homeBefore = await page.textContent('[data-testid="single-game-home"]');
    const awayBefore = await page.textContent('[data-testid="single-game-away"]');
    assert(homeBefore.trim() === 'BRA 0', `home before == "BRA 0" (got "${homeBefore}")`);
    assert(awayBefore.trim() === 'ARG 0', `away before == "ARG 0" (got "${awayBefore}")`);
    result.steps.push(`BEFORE: ${homeBefore.trim()} / ${awayBefore.trim()}`);

    const beforePath = resolve(EVIDENCE_DIR, 'e2e-before-goal.png');
    await page.screenshot({ path: beforePath });
    console.log(`[e2e] screenshot BEFORE: ${beforePath}`);

    // Drive the GameEvent (goal). The store applies the delta; the template's
    // GameStateStore subscription mutates the score IN PLACE (no transition).
    server.emitGoal();

    await page.waitForFunction(
      () => document.querySelector('[data-testid="single-game-home"]')?.textContent?.trim() === 'BRA 1',
      { timeout: 10_000 },
    );

    const homeAfter = await page.textContent('[data-testid="single-game-home"]');
    const awayAfter = await page.textContent('[data-testid="single-game-away"]');
    const overlayAfter = await page.textContent('[data-testid="single-game-overlay"]');
    assert(homeAfter.trim() === 'BRA 1', `home after == "BRA 1" (got "${homeAfter}")`);
    assert(awayAfter.trim() === 'ARG 0', `away unchanged "ARG 0" (got "${awayAfter}")`);
    assert(overlayAfter.includes('GOAL'), `overlay shows the goal moment (got "${overlayAfter}")`);
    result.steps.push(`AFTER:  ${homeAfter.trim()} / ${awayAfter.trim()} | overlay: "${overlayAfter.trim()}"`);

    const afterPath = resolve(EVIDENCE_DIR, 'e2e-after-goal.png');
    await page.screenshot({ path: afterPath });
    console.log(`[e2e] screenshot AFTER: ${afterPath}`);

    // Framing belt-and-braces: the player must never have sent a trailing-\n
    // frame (the mock closes 4000 on one — the render would have stalled above).
    const malformed = server.events.filter((e) => e.kind === 'malformed_frame_trailing_newline');
    assert(malformed.length === 0, 'player sent NO trailing-newline frames');
    const sawRegistration = server.events.some((e) => e.kind === 'recv' && e.message_type === 'DeviceRegistration');
    assert(sawRegistration, 'server received the DeviceRegistration handshake frame');
    result.steps.push('framing OK: no trailing-newline frame; DeviceRegistration received');

    result.passed = true;
    result.evidence = { before: beforePath, after: afterPath };
    result.serverEvents = server.events;
    console.log('\n[e2e] PASS — single_game renders + updates on GameEvent');
  } finally {
    await browser.close();
    await new Promise((r) => http.close(r));
    await server.close();
    const runJson = resolve(EVIDENCE_DIR, 'e2e-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[e2e] run summary: ${runJson}`);
  }

  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
