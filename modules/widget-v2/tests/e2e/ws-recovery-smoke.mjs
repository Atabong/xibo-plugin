/**
 * SPEC-CRWDQ-S41 — headless WS auto-recovery e2e (the self-heal deliverable).
 *
 * Proves the FULL player path re-establishes its WS after a proxy/pod-roll-style
 * drop with NO manual intervention (no F5), against a MOCK crowdaq.v1 server, in
 * a real headless Chromium (the player's engine family):
 *
 *   1. start the mock crowdaq.v1 server + serve harness.html + the REAL bundle;
 *   2. boot() the widget; assert single_game mounts + renders the score (BRA/ARG);
 *   3. screenshot CONNECTED baseline;
 *   4. server.dropActive() — abruptly TERMINATE the player's socket (the closest
 *      analogue to ts-game-delivery-tailnet / a game-delivery pod vanishing);
 *   5. WITHOUT touching the page, wait for the player to RE-ESTABLISH on its own:
 *      the server receives a SECOND DeviceRegistration (registrationCount 1 -> 2)
 *      and re-pushes the full state -> the score re-renders;
 *   6. push a GameEvent on the NEW connection -> assert the score updates in
 *      place (proves the re-established conn is live + bound, so admin Play would
 *      now render);
 *   7. screenshot RECOVERED.
 *
 * Run:  node tests/e2e/ws-recovery-smoke.mjs
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
  resolve(widgetRoot, '..', '..', 'docs', 'flight', 'evidence', 's41-ws-recovery');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const server = await startMockServer();
  console.log(`[e2e] mock crowdaq.v1 server: ${server.url}`);

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
    await page.addScriptTag({ url: `http://127.0.0.1:${httpPort}/bundle.js` });
    const hasGlobal = await page.evaluate(() => typeof window.CrowdaqWidgetV2?.boot === 'function');
    assert(hasGlobal, 'CrowdaqWidgetV2.boot global present after bundle load');

    // Boot with a SHORT reconnect backoff so the e2e proves recovery promptly.
    await page.evaluate((wsUrl) => window.__bootWidget(wsUrl), server.url);

    // --- step 2/3: CONNECTED baseline ----------------------------------------
    await page.waitForSelector('section.crowdaq-single-game', { timeout: 10_000 });
    await page.waitForFunction(
      () => document.querySelector('.cdq-home .cdq-team-name')?.textContent?.includes('BRA'),
      { timeout: 10_000 },
    );
    const homeBefore = (await page.textContent('.cdq-score-home'))?.trim();
    assert(homeBefore === '0', `baseline home score == "0" (got "${homeBefore}")`);
    assert(server.registrationCount() === 1, `exactly 1 registration at baseline (got ${server.registrationCount()})`);
    result.steps.push(`CONNECTED baseline: BRA ${homeBefore} / ARG 0, registrations=1`);
    const basePath = resolve(EVIDENCE_DIR, 'e2e-1-connected.png');
    await page.screenshot({ path: basePath });
    console.log(`[e2e] screenshot CONNECTED: ${basePath}`);

    // --- step 4: force the drop (proxy/pod roll) -----------------------------
    console.log('[e2e] dropping the player socket (simulating proxy/pod roll)…');
    server.dropActive();
    result.steps.push('forced drop: server.dropActive() (TCP terminate, no clean close)');

    // --- step 5: WITHOUT touching the page, prove self-heal ------------------
    // The player must re-establish on its OWN: the server sees a 2nd
    // DeviceRegistration. The mock waits between 1s (initial backoff) here.
    await page.waitForFunction(
      () => true, // keep the event loop alive; the real wait is the poll below.
      { timeout: 100 },
    ).catch(() => {});
    const start = Date.now();
    while (server.registrationCount() < 2 && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const reconMs = Date.now() - start;
    assert(server.registrationCount() >= 2, `player re-registered on its own (got ${server.registrationCount()} regs)`);
    result.steps.push(`SELF-HEALED: 2nd DeviceRegistration received ${reconMs}ms after drop, NO manual action`);
    console.log(`[e2e] re-registered ${reconMs}ms after drop`);

    // The re-push after the 2nd registration re-renders the score (resync).
    await page.waitForSelector('section.crowdaq-single-game', { timeout: 10_000 });
    await page.waitForFunction(
      () => document.querySelector('.cdq-home .cdq-team-name')?.textContent?.includes('BRA'),
      { timeout: 10_000 },
    );
    result.steps.push('resync: single_game re-rendered after reconnect (left fallback)');

    // --- step 6: prove the re-established conn is LIVE (admin Play analogue) --
    server.emitGoal();
    await page.waitForFunction(
      () => document.querySelector('.cdq-score-home')?.textContent?.trim() === '1',
      { timeout: 10_000 },
    );
    const homeAfter = (await page.textContent('.cdq-score-home'))?.trim();
    assert(homeAfter === '1', `post-recovery GameEvent rendered (home score "1", got "${homeAfter}")`);
    result.steps.push(`LIVE conn proven: post-recovery GameEvent rendered (BRA ${homeAfter})`);

    const recPath = resolve(EVIDENCE_DIR, 'e2e-2-recovered.png');
    await page.screenshot({ path: recPath });
    console.log(`[e2e] screenshot RECOVERED: ${recPath}`);

    result.passed = true;
    result.reconMs = reconMs;
    result.registrationCount = server.registrationCount();
    result.evidence = { connected: basePath, recovered: recPath };
    console.log('\n[e2e] PASS — WS self-heals after a drop with NO manual F5');
  } finally {
    await browser.close();
    await new Promise((r) => http.close(r));
    await server.close();
    const runJson = resolve(EVIDENCE_DIR, 'e2e-ws-recovery-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[e2e] run summary: ${runJson}`);
  }

  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
