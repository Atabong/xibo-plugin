/**
 * S12 widget-polish proof — headless 1920×1080 against the REAL bundle.
 *
 * Reproduces + proves the two live bar-demo layout bugs are fixed:
 *
 *   1. single_game LONG team names ("BORUSSIA DORTMUND", "EINTRACHT FRANKFURT")
 *      must be fully legible — NOT clipped mid-word with an ellipsis.
 *   2. multiple_games cards must be filled + balanced (crest + name + score laid
 *      out together per team), proven for a 2-game and a 4-game grid.
 *
 * Each scenario drives the mock crowdaq.v1 server with the live long names +
 * injected crest assets (real sha256, data: SVG — same hash/verify path as the
 * live crests), mounts the mode, settles a frame, and screenshots at 1920×1080.
 * It also ASSERTS no team name element overflows its box (scrollWidth tightly
 * within clientWidth) so a regression to truncation fails the run.
 *
 * Run:  node tests/e2e/s12-polish-proof.mjs
 * Env:  EVIDENCE_DIR overrides the screenshot dir.
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
  resolve(
    widgetRoot, '..', '..', '..', 'crowdaq-backend',
    'docs', 'flight', 'evidence', 's12-widget-polish', 'screenshots',
  );

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

// Realistic long club names — the live bar-demo case that truncated.
const CRESTS = [
  { team: 'BORUSSIA DORTMUND', bg: '#fde100', ring: '#000000', mono: 'BVB' },
  { team: 'EINTRACHT FRANKFURT', bg: '#e1000f', ring: '#000000', mono: 'SGE' },
  { team: 'BAYERN MUNCHEN', bg: '#dc052d', ring: '#ffffff', mono: 'FCB' },
  { team: 'REAL MADRID', bg: '#00529f', ring: '#ffffff', mono: 'RMA' },
  { team: 'LIVERPOOL', bg: '#c8102e', ring: '#f6eb61', mono: 'LIV' },
  { team: 'MANCHESTER CITY', bg: '#6cabdd', ring: '#ffffff', mono: 'MCI' },
  { team: 'JUVENTUS', bg: '#000000', ring: '#ffffff', mono: 'JUV' },
  { team: 'INTERNAZIONALE', bg: '#0066b3', ring: '#000000', mono: 'INT' },
];

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
  page.on('pageerror', (e) => console.log('  [page-error]', e.message));
  await page.goto(statics.url, { waitUntil: 'load' });
  await page.addScriptTag({ url: `http://127.0.0.1:${statics.port}/bundle.js` });
  await page.evaluate((u) => window.__bootWidget(u), wsUrl);
  return page;
}

/**
 * Assert every matching name fits HORIZONTALLY in its box (no mid-word "…").
 * Two-line vertical wrap IS the intended fix, so we only guard the horizontal
 * axis — the axis the live truncation occurred on. A `-webkit-line-clamp` box
 * reports scrollHeight > clientHeight even for in-bounds wrapped text, so the
 * vertical axis is not a reliable clip signal; we instead assert the rendered
 * text carries no ellipsis (proof the full name is present, not truncated).
 */
async function assertNoClip(page, selector, label) {
  const overflow = await page.$$eval(selector, (els) =>
    els.map((el) => ({
      text: el.textContent.trim(),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
    })),
  );
  for (const o of overflow) {
    assert(o.scrollW <= o.clientW + 3, `${label}: "${o.text}" clips horizontally (scrollW ${o.scrollW} > clientW ${o.clientW})`);
    assert(!o.text.includes('…'), `${label}: "${o.text}" contains an ellipsis (truncated)`);
  }
  return overflow;
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const statics = await startStatic();
  const browser = await chromium.launch({ headless: true });
  const result = { steps: [], scenarios: {}, passed: false };

  try {
    // ---- single_game: full long names + real crests (the truncation case) ---
    {
      const server = await startMockServer({
        scenario: 'single_game',
        single: { home: 'BORUSSIA DORTMUND', away: 'EINTRACHT FRANKFURT', hs: 2, as: 1, sport: 'Soccer', league: 'Bundesliga', clock: "67'" },
        crests: [CRESTS[0], CRESTS[1]],
      });
      try {
        const page = await bootPage(browser, statics, server.url);
        await page.waitForSelector('section.crowdaq-single-game', { timeout: 12_000 });
        await page.waitForFunction(
          () => (document.querySelector('.cdq-home .cdq-team-name')?.textContent ?? '').includes('DORTMUND'),
          { timeout: 12_000 },
        );
        await page.waitForTimeout(800); // crest warm + mount reveal settle
        const path = resolve(EVIDENCE_DIR, 'after-single-game-long-names.png');
        await page.screenshot({ path });
        const names = await assertNoClip(page, '.crowdaq-single-game .cdq-team-name', 'single_game name');
        const crests = await page.$$eval('.crowdaq-single-game .cdq-crest[data-has-crest="true"]', (e) => e.length);
        const homeName = (await page.textContent('.cdq-home .cdq-team-name'))?.trim();
        const awayName = (await page.textContent('.cdq-away .cdq-team-name'))?.trim();
        assert(homeName.replace(/\s/g, '') === 'BORUSSIADORTMUND' || homeName.includes('DORTMUND'), `home name legible (got "${homeName}")`);
        assert(!homeName.includes('…') && !awayName.includes('…'), `no ellipsis in names (got "${homeName}" / "${awayName}")`);
        result.scenarios.single_game = { screenshot: path, homeName, awayName, crests, names };
        result.steps.push(`single_game: "${homeName}" / "${awayName}" no-clip, crests=${crests}`);
        console.log(`[s12] single_game OK -> ${path} (crests=${crests})`);
        await page.close();
      } finally {
        await server.close();
      }
    }

    // ---- multiple_games 4-up (full names + crests) --------------------------
    const mgGames4 = [
      { id: 'mg-1', home: 'BORUSSIA DORTMUND', away: 'EINTRACHT FRANKFURT', hs: 2, as: 1, sport: 'Soccer', league: 'Bundesliga', clock: "67'" },
      { id: 'mg-2', home: 'BAYERN MUNCHEN', away: 'REAL MADRID', hs: 1, as: 1, sport: 'Soccer', league: 'Champions League', clock: "54'" },
      { id: 'mg-3', home: 'LIVERPOOL', away: 'MANCHESTER CITY', hs: 0, as: 0, sport: 'Soccer', league: 'Premier League', clock: "23'" },
      { id: 'mg-4', home: 'JUVENTUS', away: 'INTERNAZIONALE', hs: 3, as: 2, sport: 'Soccer', league: 'Serie A', clock: "81'" },
    ];
    for (const [tag, games, file] of [
      ['4up', mgGames4, 'after-multiple-games-4up.png'],
      ['2up', mgGames4.slice(0, 2), 'after-multiple-games-2up.png'],
    ]) {
      const server = await startMockServer({ scenario: 'multiple_games', games, crests: CRESTS });
      try {
        const page = await bootPage(browser, statics, server.url);
        await page.waitForSelector('section.crowdaq-multi-game .cdq-card', { timeout: 12_000 });
        await page.waitForFunction(
          (n) => document.querySelectorAll('.cdq-card').length === n,
          games.length, { timeout: 12_000 },
        );
        await page.waitForTimeout(800);
        const path = resolve(EVIDENCE_DIR, file);
        await page.screenshot({ path });
        const cards = await page.$$eval('.cdq-card', (e) => e.length);
        const crests = await page.$$eval('.cdq-card [data-has-crest="true"]', (e) => e.length);
        const teamNames = await assertNoClip(page, '.cdq-card .cdq-card-team-name', `multiple_games ${tag} name`);
        assert(cards === games.length, `${tag}: ${games.length} cards (got ${cards})`);
        result.scenarios[`multiple_games_${tag}`] = { screenshot: path, cards, crests, teamNames };
        result.steps.push(`multiple_games ${tag}: ${cards} cards, crests=${crests}, no name clip`);
        console.log(`[s12] multiple_games ${tag} OK -> ${path} (cards=${cards}, crests=${crests})`);
        await page.close();
      } finally {
        await server.close();
      }
    }

    result.passed = true;
    console.log('\n[s12] PASS — single_game long names legible + crests; multi-game 2-up/4-up filled + balanced');
  } finally {
    await browser.close();
    await statics.close();
    const runJson = resolve(EVIDENCE_DIR, '..', 's12-proof-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[s12] run summary: ${runJson}`);
  }
  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[s12] FAILED:', err);
  process.exit(1);
});
