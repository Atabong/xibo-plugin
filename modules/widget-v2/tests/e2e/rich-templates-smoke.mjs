/**
 * SPEC-CRWDQ-084 — CONTROLLED rich-render proof in REAL headless Chromium.
 *
 * The HARD GATE (3b): before any live bar deploy, prove the rich panels render
 * non-empty DOM with the rich content AND the clock VISIBLY TICKS — against the
 * REAL tsup bundle + the REAL broadcast CSS (the same engine family as the bar's
 * snap Chromium), driven by the mock crowdaq.v1 WS server. Off the live screen.
 *
 * Football: rich single_game (timeline goals/cards/subs + half/stoppage) →
 *   screenshot; capture the clock pill text; let ~4s of WALL time pass (the
 *   local GameClock ticks ~2×/s) → capture the clock again → assert the minute
 *   MOVED (the headline "looks alive" requirement) → screenshot a second frame.
 * Baseball: rich single_game (inning line-score + count + bases) → screenshot;
 *   push a later-inning snapshot → assert the inning advanced + the grid FILLED.
 *
 * Run:  node tests/e2e/rich-templates-smoke.mjs
 * Env:  EVIDENCE_DIR overrides where the screenshots + run.json land.
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
  resolve(widgetRoot, '..', '..', '..', 'crowdaq-backend', 'docs', 'flight', 'evidence', 's53-rich-templates');

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FOOTBALL = {
  home: 'ARGENTINA', away: 'FRANCE', hs: 2, as: 0, sport: 'football', league: 'World Cup',
  clock: "36'", status: 'live',
  detail: { half: '2H', minute: 64, stoppage: 0, possession: { home: 54, away: 46 }, shots: { home: 12, away: 9 } },
  timeline: [
    { seq: 0, kind: 'goal', clock: "23'", team: 'home', player: 'L. Messi' },
    { seq: 1, kind: 'goal', clock: "36'", team: 'home', player: 'Á. Di María' },
    { seq: 2, kind: 'card', clock: "41'", team: 'away', player: 'Dembélé', detail: 'yellow' },
    { seq: 3, kind: 'sub', clock: "41'", team: 'away', detail: 'Kolo Muani ◄ Giroud' },
    { seq: 4, kind: 'var', clock: "55'", detail: 'penalty check' },
  ],
};

const BASEBALL_1 = {
  home: 'CHICAGO CUBS', away: 'ATHLETICS', hs: 4, as: 3, sport: 'baseball', league: 'MLB',
  clock: 'BOT 5', status: 'live',
  detail: {
    inning: 5, half: 'bottom', balls: 2, strikes: 1, outs: 1,
    bases: { first: true, second: false, third: true },
    lineScore: [
      { inning: 1, home: 1, away: 0 }, { inning: 2, home: 0, away: 2 },
      { inning: 3, home: 2, away: 0 }, { inning: 4, home: 0, away: 1 },
      { inning: 5, home: 1, away: 0 },
    ],
    hits: { home: 8, away: 6 }, errors: { home: 0, away: 1 },
  },
};
// A later snapshot to prove the inning ADVANCES + the grid FILLS (no flash).
const BASEBALL_2 = {
  home_team: 'CHICAGO CUBS', away_team: 'ATHLETICS', home_score: 7, away_score: 6,
  sport_context: { sport: 'baseball', league: 'MLB', period_clock: 'BOT 9', detail: {
    inning: 9, half: 'bottom', balls: 1, strikes: 2, outs: 2,
    bases: { first: false, second: true, third: false },
    lineScore: [
      { inning: 1, home: 1, away: 0 }, { inning: 2, home: 0, away: 2 }, { inning: 3, home: 2, away: 0 },
      { inning: 4, home: 0, away: 1 }, { inning: 5, home: 1, away: 0 }, { inning: 6, home: 0, away: 1 },
      { inning: 7, home: 1, away: 1 }, { inning: 8, home: 2, away: 1 }, { inning: 9, home: 0, away: 0 },
    ],
    hits: { home: 12, away: 9 }, errors: { home: 0, away: 1 },
  } },
};

async function withPage(scenarioOptions, fn) {
  const server = await startMockServer(scenarioOptions);
  const bundleJs = readFileSync(BUNDLE, 'utf8');
  const harnessHtml = readFileSync(HARNESS, 'utf8');
  const http = createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundleJs); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harnessHtml); }
  });
  await new Promise((r) => http.listen(0, r));
  const httpPort = http.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.log('  [page-error]', e.message));
    await page.goto(`http://127.0.0.1:${httpPort}/harness.html`, { waitUntil: 'load' });
    await page.addScriptTag({ url: `http://127.0.0.1:${httpPort}/bundle.js` });
    await page.evaluate((wsUrl) => window.__bootWidget(wsUrl), server.url);
    await page.waitForSelector('section.crowdaq-single-game', { timeout: 10_000 });
    await fn(page, server);
  } finally {
    await browser.close();
    await new Promise((r) => http.close(r));
    await server.close();
  }
}

const clockOf = (page) =>
  page.evaluate(() => (document.querySelector('[data-testid="single-game-clock"]')?.textContent ?? '').replace(/\s+/g, ' ').trim());

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const result = { football: {}, baseball: {}, passed: false };

  // ---------- FOOTBALL: timeline + half/clock + TICKING clock --------------
  await withPage({ scenario: 'single_game', single: FOOTBALL }, async (page, server) => {
    await page.waitForSelector('[data-testid="sg-detail-football"]', { timeout: 10_000 });
    const tlCount = await page.evaluate(() => document.querySelectorAll('[data-testid="sg-detail-football-timeline"] .cdq-fb-row').length);
    const tlText = await page.textContent('[data-testid="sg-detail-football-timeline"]');
    const halfText = (await page.textContent('[data-testid="sg-detail-football-half"]'))?.replace(/\s+/g, ' ').trim();
    assert(tlCount >= 4, `football timeline NON-EMPTY (>=4 rows; got ${tlCount})`);
    assert(tlText.includes('L. Messi'), 'timeline shows scorer L. Messi');
    assert(tlText.includes('Kolo Muani'), 'timeline shows the sub');
    assert(/HALF/.test(halfText), `half treatment present (got "${halfText}")`);
    result.football.timelineRows = tlCount;
    result.football.half = halfText;

    const clock1 = await clockOf(page);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'e2e-football-frame1.png') });

    // The headline requirement: the local GameClock ticks the minute forward
    // between server frames. Wait WALL time and assert the clock pill MOVED.
    await sleep(4500);
    const clock2 = await clockOf(page);
    result.football.clock1 = clock1;
    result.football.clock2 = clock2;
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'e2e-football-frame2.png') });
    const m1 = Number((clock1.match(/(\d+)/) ?? [])[1]);
    const m2 = Number((clock2.match(/(\d+)/) ?? [])[1]);
    assert(Number.isFinite(m1) && Number.isFinite(m2), `clock pill numeric both frames ("${clock1}" -> "${clock2}")`);
    assert(m2 > m1, `CLOCK TICKED between frames ("${clock1}" -> "${clock2}")`);

    // Server frame re-syncs the clock (server wins): push 70' and assert snap.
    server.emitSnapshot({ home_team: FOOTBALL.home, away_team: FOOTBALL.away, home_score: 2, away_score: 1,
      sport_context: { sport: 'football', league: 'World Cup', period_clock: "70'", detail: { half: '2H', minute: 70, stoppage: 0 } } }, 111);
    await page.waitForFunction(() => /70/.test(document.querySelector('[data-testid="single-game-clock"]')?.textContent ?? ''), { timeout: 5_000 });
    result.football.resync = await clockOf(page);
  });

  // ---------- BASEBALL: line-score + count/bases + inning progression ------
  await withPage({ scenario: 'single_game', single: BASEBALL_1 }, async (page, server) => {
    await page.waitForSelector('[data-testid="sg-detail-baseball"]', { timeout: 10_000 });
    const innCols = await page.evaluate(() => document.querySelectorAll('[data-testid="sg-detail-baseball-linescore"] .cdq-bb-inn').length);
    const rows = await page.evaluate(() => document.querySelectorAll('[data-testid="sg-detail-baseball-linescore"] tr.cdq-bb-row').length);
    const gridText = await page.textContent('[data-testid="sg-detail-baseball-linescore"]');
    const countShown = await page.evaluate(() => document.querySelector('[data-testid="sg-detail-baseball-count"]')?.hidden === false);
    const basesOn = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sg-detail-baseball-bases"] .cdq-bb-base')].filter((b) => b.dataset.on === 'true').length);
    assert(innCols >= 9, `line-score has >=9 inning columns (got ${innCols})`);
    assert(rows === 2, `line-score has 2 team rows (got ${rows})`);
    assert(gridText.includes('CUBS'), 'line-score shows CUBS');
    assert(countShown, 'count (B-S-O) shown');
    assert(basesOn >= 2, `bases diamond shows occupied bases (got ${basesOn})`);
    result.baseball.inningCols = innCols;
    result.baseball.basesOn = basesOn;

    const filled1 = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sg-detail-baseball-linescore"] .cdq-bb-cell')].filter((c) => (c.textContent ?? '').trim() !== '').length);
    const inning1 = await page.textContent('[data-testid="sg-detail-baseball-inning"]');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'e2e-baseball-frame1.png') });

    // Push a later-inning snapshot: prove the inning ADVANCES + the grid FILLS
    // (inning-by-inning, not a 0-0→final flash).
    server.emitSnapshot(BASEBALL_2, 112);
    await page.waitForFunction(() => /9/.test(document.querySelector('[data-testid="sg-detail-baseball-inning"]')?.textContent ?? ''), { timeout: 5_000 });
    const filled2 = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sg-detail-baseball-linescore"] .cdq-bb-cell')].filter((c) => (c.textContent ?? '').trim() !== '').length);
    const inning2 = await page.textContent('[data-testid="sg-detail-baseball-inning"]');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'e2e-baseball-frame2.png') });
    result.baseball.inning1 = inning1.trim();
    result.baseball.inning2 = inning2.trim();
    result.baseball.filled1 = filled1;
    result.baseball.filled2 = filled2;
    assert(filled2 > filled1, `line-score FILLED inning-by-inning (${filled1} -> ${filled2} cells)`);
  });

  result.passed = true;
  writeFileSync(resolve(EVIDENCE_DIR, 'rich-render-run.json'), JSON.stringify(result, null, 2));
  console.log('\n[rich-e2e] PASS');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error('[rich-e2e] FAIL:', e.message); process.exit(1); });
