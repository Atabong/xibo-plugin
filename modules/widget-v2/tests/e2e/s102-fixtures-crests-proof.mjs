/**
 * SPEC-CRWDQ-S11 / S102 — fixtures-catalog REAL team-crest proof.
 *
 * Drives the SAME built bundle + assembled broadcast.css the live player renders,
 * against the mock crowdaq.v1 WS server, in the `fixtures` ("COMING UP") mode.
 *
 *   BEFORE: a fixtures catalog with NO crest assets in the AssetManifest →
 *           the gap behaviour (team text + generic chip, imgCount === 0 crests).
 *   AFTER:  the SAME catalog with crest assets (kind=crest, ref=team name_key)
 *           in the AssetManifest → every team renders a REAL per-team crest
 *           <img> (data-has-crest=true), imgCount jumps to one per team.
 *
 * Captures a 1080 screenshot of each + asserts the DOM, and writes run.json.
 *
 * Run:  node tests/e2e/s102-fixtures-crests-proof.mjs
 * Env:  EVIDENCE_DIR overrides where screenshots + run.json land.
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
  resolve(widgetRoot, '..', '..', 'docs', 'flight', 'evidence', 's102-crests-render');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

// Six clubs across three fixtures — each with a distinct coloured roundel crest.
const FIXTURES = [
  { eventId: 'fx-1', sport: 'Soccer', leagueId: 1, leagueName: 'Bundesliga', homeTeam: 'DORTMUND', awayTeam: 'LEIPZIG', kickoffUtc: '2026-06-04T18:30:00Z', feedStatus: 'scheduled' },
  { eventId: 'fx-2', sport: 'Soccer', leagueId: 2, leagueName: 'La Liga', homeTeam: 'BARCELONA', awayTeam: 'SEVILLA', kickoffUtc: '2026-06-04T20:00:00Z', feedStatus: 'scheduled' },
  { eventId: 'fx-3', sport: 'Soccer', leagueId: 3, leagueName: 'Serie A', homeTeam: 'JUVENTUS', awayTeam: 'NAPOLI', kickoffUtc: '2026-06-04T21:45:00Z', feedStatus: 'scheduled' },
];
const CRESTS = [
  { team: 'DORTMUND', bg: '#fde100', ring: '#000000', mono: 'BVB' },
  { team: 'LEIPZIG', bg: '#dd0741', ring: '#001f47', mono: 'RBL' },
  { team: 'BARCELONA', bg: '#004d98', ring: '#a50044', mono: 'FCB' },
  { team: 'SEVILLA', bg: '#d81920', ring: '#ffffff', mono: 'SEV' },
  { team: 'JUVENTUS', bg: '#000000', ring: '#ffffff', mono: 'JUV' },
  { team: 'NAPOLI', bg: '#0a7bc2', ring: '#ffffff', mono: 'NAP' },
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
  page.on('console', (m) => console.log('  [page]', m.text()));
  page.on('pageerror', (e) => console.log('  [page-error]', e.message));
  await page.goto(statics.url, { waitUntil: 'load' });
  await page.addScriptTag({ url: `http://127.0.0.1:${statics.port}/bundle.js` });
  const hasGlobal = await page.evaluate(() => typeof window.CrowdaqWidgetV2?.boot === 'function');
  assert(hasGlobal, 'CrowdaqWidgetV2.boot global present after bundle load');
  await page.evaluate((u) => window.__bootWidget(u), wsUrl);
  return page;
}

/** Count real crest <img>s + monogram fallbacks in the mounted fixtures DOM. */
async function inspect(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.crowdaq-fixtures .cdq-fixture-card'));
    const crestImgs = document.querySelectorAll('.crowdaq-fixtures .cdq-team-crest .cdq-team-crest-img');
    const monos = document.querySelectorAll('.crowdaq-fixtures .cdq-team-crest .cdq-team-crest-mono');
    const teamsWithCrest = document.querySelectorAll('.crowdaq-fixtures [data-has-crest="true"]');
    // Every <img> anywhere in the fixtures section (the "DOM imgCount" the gap report cites).
    const imgCount = document.querySelectorAll('.crowdaq-fixtures img').length;
    const teamNames = Array.from(document.querySelectorAll('.crowdaq-fixtures .cdq-team-name'))
      .map((e) => e.textContent.trim())
      .filter(Boolean);
    return { cards: cards.length, crestImgCount: crestImgs.length, monoCount: monos.length, teamsWithCrest: teamsWithCrest.length, imgCount, teamNames };
  });
}

async function runScenario(browser, statics, { label, crests, file }) {
  const server = await startMockServer({ scenario: 'fixtures', fixtures: FIXTURES, crests });
  console.log(`[s102] ${label} mock: ${server.url}`);
  try {
    const page = await bootPage(browser, statics, server.url);
    await page.waitForSelector('section.crowdaq-fixtures .cdq-fixture-card', { timeout: 12_000 });
    // Settle: mount-reveal animations + the async crest warm-fetch + onCrestReady swap-in.
    await page.waitForTimeout(1200);
    const path = resolve(EVIDENCE_DIR, file);
    await page.screenshot({ path });
    const detail = await inspect(page);
    console.log(`[s102] ${label}: ${JSON.stringify(detail)} -> ${path}`);
    await page.close();
    return { screenshot: path, ...detail };
  } finally {
    await server.close();
  }
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const statics = await startStatic();
  const browser = await chromium.launch({ headless: true });
  const result = { passed: false };
  try {
    // BEFORE — no crest assets in the manifest (the gap: generic chip / text only).
    result.before = await runScenario(browser, statics, { label: 'BEFORE (no crests)', crests: [], file: 'before.png' });
    assert(result.before.cards === 3, `before: 3 fixture cards (got ${result.before.cards})`);
    assert(result.before.crestImgCount === 0, `before: NO real crest imgs (got ${result.before.crestImgCount})`);

    // AFTER — crest assets present → a real per-team crest <img> for all 6 teams.
    result.after = await runScenario(browser, statics, { label: 'AFTER (real crests)', crests: CRESTS, file: 'after.png' });
    assert(result.after.cards === 3, `after: 3 fixture cards (got ${result.after.cards})`);
    assert(result.after.crestImgCount === 6, `after: a real crest img for ALL 6 teams (got ${result.after.crestImgCount})`);
    assert(result.after.teamsWithCrest === 6, `after: 6 teams flagged data-has-crest (got ${result.after.teamsWithCrest})`);
    assert(result.after.imgCount > result.before.imgCount, `after: DOM imgCount jumped (${result.before.imgCount} -> ${result.after.imgCount})`);

    result.passed = true;
    console.log(`\n[s102] PASS — fixtures real crests render: imgCount ${result.before.imgCount} -> ${result.after.imgCount}, ${result.after.crestImgCount} per-team crest <img>s`);
  } finally {
    await browser.close();
    await statics.close();
    const runJson = resolve(EVIDENCE_DIR, 's102-run.json');
    writeFileSync(runJson, JSON.stringify(result, null, 2));
    console.log(`[s102] run summary: ${runJson}`);
  }
  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error('[s102] FAILED:', err);
  process.exit(1);
});
