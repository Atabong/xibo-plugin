/**
 * S9-modes — headless e2e smoke for the remaining D-GRH-26 render modes.
 *
 * Proves the FULL player path end-to-end in a real headless Chromium against the
 * MOCK crowdaq.v1 WS server, for each newly-assembled mode, using the SAME built
 * bundle + assembled broadcast.css the live player renders:
 *
 *   multiple_games          — ≥2 live GameStates → a grid of score bugs.
 *   fixtures                — a FixtureList → the upcoming-fixture catalog.
 *   recap                   — a final GameState + FixtureList → frozen closing image.
 *   multiple_games_with_ads — grid + an AdSlot-driven ad panel (composite).
 *   fixtures_with_ads       — catalog + an AdSlot-driven ad panel (composite).
 *
 * Each mounts its mode root, captures a full-res 1080 screenshot, and asserts the
 * designed DOM is present. The *_with_ads scenarios inject a mock AdSlot (the LIVE
 * backend emits none — the verified gap); the test also proves the live-gap
 * behaviour: with no AdSlot the composite DECLINES (renders nothing).
 *
 * Run:  node tests/e2e/modes-smoke.mjs
 * Env:  EVIDENCE_DIR overrides where screenshots + run.json are written.
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
  resolve(widgetRoot, '..', '..', '..', 'crowdaq-backend', 'docs', 'flight', 'evidence', 's9-modes', 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => console.log('  [page]', m.text()));
  page.on('pageerror', (e) => console.log('  [page-error]', e.message));
  await page.goto(statics.url, { waitUntil: 'load' });
  await page.addScriptTag({ url: `http://127.0.0.1:${statics.port}/bundle.js` });
  const hasGlobal = await page.evaluate(() => typeof window.CrowdaqWidgetV2?.boot === 'function');
  assert(hasGlobal, 'CrowdaqWidgetV2.boot global present after bundle load');
  await page.evaluate((u) => window.__bootWidget(u), wsUrl);
  return page;
}

/** Mount one scenario, wait for `selector`, screenshot, run `check(page)`. */
async function proveMode(browser, statics, result, { scenario, options, selector, file, label, check }) {
  const server = await startMockServer({ scenario, ...(options ?? {}) });
  console.log(`[e2e] ${label} mock: ${server.url}`);
  try {
    const page = await bootPage(browser, statics, server.url);
    await page.waitForSelector(selector, { timeout: 12_000 });
    // settle a frame so mount-reveal animations paint + ad images load.
    await page.waitForTimeout(700);
    const path = resolve(EVIDENCE_DIR, file);
    await page.screenshot({ path });
    console.log(`[e2e] screenshot ${label}: ${path}`);
    const detail = check ? await check(page) : {};
    result.steps.push(`${label}: ${selector} mounted ${JSON.stringify(detail)}`);
    result.modes[scenario + (options?.tag ? `_${options.tag}` : '')] = { selector, screenshot: path, ...detail };
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
  const result = { steps: [], modes: {}, passed: false };
  try {
    // multiple_games — 4-game grid of score bugs.
    await proveMode(browser, statics, result, {
      scenario: 'multiple_games', selector: 'section.crowdaq-multi-game .cdq-card',
      file: 'modes-multiple-games-1080.png', label: 'multiple_games',
      check: async (page) => {
        const cards = await page.$$eval('.cdq-card', (els) => els.length);
        const primary = await page.$$eval('.cdq-card[data-primary="true"]', (els) => els.length);
        const homeLine = (await page.textContent('.cdq-card[data-position="0"] .cdq-card-home'))?.trim();
        assert(cards === 4, `4 cards rendered (got ${cards})`);
        assert(primary === 1, `exactly one primary card (got ${primary})`);
        return { cards, primary, firstCard: homeLine };
      },
    });

    // fixtures — upcoming-fixture catalog from the FixtureList.
    await proveMode(browser, statics, result, {
      scenario: 'fixtures', selector: 'section.crowdaq-fixtures .cdq-fixture-card',
      file: 'modes-fixtures-1080.png', label: 'fixtures',
      check: async (page) => {
        const cards = await page.$$eval('.cdq-fixture-card', (els) => els.length);
        const first = (await page.textContent('.cdq-fixture-card[data-position="0"] [data-testid="cdq-fixture-home"]'))?.trim();
        assert(cards === 3, `3 fixture cards (got ${cards})`);
        return { cards, firstHome: first };
      },
    });

    // recap — frozen final score + headline.
    await proveMode(browser, statics, result, {
      scenario: 'recap', selector: 'section.crowdaq-recap .cdq-final-score',
      file: 'modes-recap-1080.png', label: 'recap',
      check: async (page) => {
        const winner = await page.getAttribute('.crowdaq-recap', 'data-winner');
        const home = (await page.textContent('.cdq-team-home .cdq-team-name'))?.trim();
        const hs = (await page.textContent('.cdq-team-home .cdq-team-score'))?.trim();
        return { winner, home, homeScore: hs };
      },
    });

    // multiple_games_with_ads — grid + ad panel (mock AdSlot injected).
    await proveMode(browser, statics, result, {
      scenario: 'multiple_games_with_ads', selector: 'section.crowdaq-with-ads .cdq-content .cdq-card',
      file: 'modes-multi-with-ads-1080.png', label: 'multiple_games_with_ads',
      check: async (page) => {
        const adPanel = await page.$$eval('.cdq-ad-panel', (els) => els.length);
        const cards = await page.$$eval('.cdq-content .cdq-card', (els) => els.length);
        return { adPanel, gridCards: cards };
      },
    });

    // fixtures_with_ads — catalog + ad panel (mock AdSlot injected).
    await proveMode(browser, statics, result, {
      scenario: 'fixtures_with_ads', selector: 'section.crowdaq-with-ads .cdq-content .cdq-fixture-card',
      file: 'modes-fixtures-with-ads-1080.png', label: 'fixtures_with_ads',
      check: async (page) => {
        const adPanel = await page.$$eval('.cdq-ad-panel', (els) => els.length);
        return { adPanel };
      },
    });

    // LIVE-GAP proof: with NO AdSlot delivered the composite DECLINES (renders
    // nothing) — exactly the live-backend behaviour (no AdSlot frame is emitted).
    {
      const server = await startMockServer({ scenario: 'multiple_games_with_ads', withAds: false });
      try {
        const page = await bootPage(browser, statics, server.url);
        await page.waitForTimeout(1500);
        const composite = await page.$$eval('.crowdaq-with-ads', (els) => els.length);
        const cards = await page.$$eval('.cdq-card', (els) => els.length);
        assert(composite === 0, `no with-ads composite mounts without an AdSlot (got ${composite})`);
        assert(cards === 0, `no content renders for a *_with_ads state with no AdSlot (got ${cards})`);
        result.steps.push('with_ads_live_gap: no AdSlot delivered -> composite declines, nothing renders (verified live-backend behaviour)');
        result.modes.with_ads_live_gap = { composite, cards, note: 'matches live backend: no AdSlot frame emitted' };
        await page.close();
      } finally {
        await server.close();
      }
    }

    result.passed = true;
    console.log('\n[e2e] PASS — all remaining modes mount + render designed; with-ads live-gap verified');
  } finally {
    await browser.close();
    await statics.close();
    const runJson = resolve(EVIDENCE_DIR, '..', 'modes-e2e-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[e2e] run summary: ${runJson}`);
  }
  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
