/**
 * SPEC-CRWDQ-S13 (D-GRH-78) — headless proof that the single_game excitement
 * meter renders the REAL backend `sport_context.excitement` value and SPIKES
 * when a goal GameEvent lands.
 *
 * This drives the SAME real bundle + real boot path as single-game-smoke.mjs,
 * but injects excitement values computed by the ACTUAL backend model
 * (crowdaq-backend src/delivery/excitement/model.ts, imported via tsx) so the
 * meter is matched to what the backend would emit — not hand-picked numbers.
 *
 *   1. boot the widget against a mock crowdaq.v1 WS (single_game window);
 *   2. the GameStateSnapshot carries the model's "at rest" excitement for a
 *      0-0 at 70' (low/med) → screenshot LOW;
 *   3. emit a goal GameEvent carrying the model's SPIKED excitement (the goal
 *      just landed: 1-0 at 71', full recency spike) → screenshot SPIKE;
 *   4. assert the meter fill width == the emitted excitement (before + after)
 *      and that AFTER > BEFORE.
 *
 * Run:  node tests/e2e/s13-excitement-proof.mjs
 */
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExcitement } from '../../../../../crowdaq-backend/src/delivery/excitement/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const widgetRoot = resolve(here, '..', '..');
const BUNDLE = resolve(widgetRoot, 'dist', 'crowdaq-widget-v2.global.js');
const HARNESS = resolve(here, 'harness.html');
const EVIDENCE_DIR =
  process.env.EVIDENCE_DIR ??
  resolve(widgetRoot, '..', '..', '..', 'crowdaq-backend', 'docs', 'flight', 'evidence', 's13-excitement');

const BAR_ID = '11111111-1111-1111-1111-111111111111';
const DISPLAY_ID = '99999999-9999-4999-8999-999999999999';
const GAME_ID = 'g-s13';
const NOW_MS = 1_000_000_000_000;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}
const now = () => new Date().toISOString();
function sendFrame(ws, obj) {
  ws.send(JSON.stringify(obj)); // no trailing newline (the framing contract)
}

// REAL backend-computed excitement for the two moments (no hand-picked numbers).
const BEFORE = computeExcitement({ home_score: 0, away_score: 0, period: '2H', clock: "70'" }, [], NOW_MS);
const AFTER = computeExcitement(
  { home_score: 1, away_score: 0, period: '2H', clock: "71'" },
  [{ kind: 'goal', atMs: NOW_MS, scoringTeam: 'home', homeScore: 1, awayScore: 0 }],
  NOW_MS,
);

async function startMock() {
  return new Promise((res) => {
    const wss = new WebSocketServer({ port: 0 });
    let sock = null;
    wss.on('connection', (ws) => {
      sock = ws;
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.message_type === 'DeviceRegistration') {
          // re-push: ConfigPush -> ScheduleWindow -> AssetManifest -> ProgramSlot
          //   -> GameStateSnapshot(real excitement) -> PlannedState(single_game)
          const ctrl = (mt, payload) => sendFrame(ws, { schema_version: 1, channel: 'control', message_type: mt, ts: now(), bar_id: BAR_ID, payload });
          ctrl('ConfigPush', {
            config_hash: 'h1', bar_id: BAR_ID, display_id: DISPLAY_ID,
            preferences: { theme: { state: 'default' }, sports: ['football'], leagues: [], region: null, state: null, city: null, timezone: 'UTC', business_hours: [], local_team_list: [], fallback_mode_order: ['safe_info'] },
            cache_ceiling_bytes: 1073741824, intervals: { journal_sync_ms: 60000, heartbeat_ms: 30000, manifest_recheck_ms: 300000 },
          });
          ctrl('ScheduleWindow', { window_id: 'w1', bar_id: BAR_ID, window_start: now(), window_end: now(), schedule_hash: 'sh', slot_count: 1 });
          ctrl('AssetManifest', { manifest_id: 'm1', bar_id: BAR_ID, generated_at: now(), version: 'v1', assets: [] });
          ctrl('ProgramSlot', { program_slot_id: 'slot-1', primary_game_id: GAME_ID, game_ids: [], fixture_ids: [] });
          sendFrame(ws, { schema_version: 1, channel: 'game_data', message_type: 'GameStateSnapshot', ts: now(), bar_id: BAR_ID, game_id: GAME_ID, seq: 100, payload: {
            home_team: 'NEW', away_team: 'TOT', home_score: 0, away_score: 0,
            sport_context: { sport: 'Football', league: 'Premier', period_clock: "2H 70'", excitement: BEFORE.excitement, momentum: BEFORE.momentum },
          } });
          ctrl('PlannedState', { state_id: 'st-1', business_mode: 'single_game', program_slot_id: 'slot-1', ad_slot_id: null, dwell_target_ms: 600000, transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null });
        } else if (frame.message_type === 'Heartbeat') {
          sendFrame(ws, { schema_version: 1, channel: 'control', message_type: 'HeartbeatAck', ts: now(), seq: 0, bar_id: BAR_ID, payload: {} });
        }
      });
    });
    wss.on('listening', () => {
      const port = wss.address().port;
      res({
        url: `ws://127.0.0.1:${port}`,
        emitGoal() {
          // The goal GameEvent carries the SPIKED excitement on its
          // sport_context — exactly as Router.enrichGameEventOutbound stamps it.
          sendFrame(sock, { schema_version: 1, channel: 'game_data', message_type: 'GameEvent', ts: now(), bar_id: BAR_ID, game_id: GAME_ID, seq: 101, payload: {
            game_id: GAME_ID, seq: 101, kind: 'goal', at_clock: "71'",
            home_score: 1, last_moment: 'GOAL! Newcastle take the lead',
            delta: { scoring_team: 'home', home_score: 1, away_score: 0 },
            sport_context: { excitement: AFTER.excitement, momentum: AFTER.momentum },
          } });
        },
        close: () => new Promise((r) => wss.close(r)),
      });
    });
  });
}

async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`bundle missing — run \`npm run build\` first (${BUNDLE})`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const server = await startMock();
  console.log(`[s13] mock WS: ${server.url}`);
  console.log(`[s13] backend model BEFORE (0-0 @70'): excitement=${BEFORE.excitement} momentum=${BEFORE.momentum} components=${JSON.stringify(BEFORE.components)}`);
  console.log(`[s13] backend model AFTER  (1-0 @71', goal): excitement=${AFTER.excitement} momentum=${AFTER.momentum} components=${JSON.stringify(AFTER.components)}`);

  const bundleJs = readFileSync(BUNDLE, 'utf8');
  const harnessHtml = readFileSync(HARNESS, 'utf8');
  const http = createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundleJs); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harnessHtml); }
  });
  await new Promise((r) => http.listen(0, r));
  const httpPort = http.address().port;

  const browser = await chromium.launch({ headless: true });
  const result = { steps: [], model: { before: BEFORE, after: AFTER }, passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('console', (m) => console.log('  [page]', m.text()));
    page.on('pageerror', (e) => console.log('  [page-error]', e.message));
    await page.goto(`http://127.0.0.1:${httpPort}/harness.html`, { waitUntil: 'load' });
    await page.addScriptTag({ url: `http://127.0.0.1:${httpPort}/bundle.js` });
    await page.evaluate((wsUrl) => window.__bootWidget(wsUrl), server.url);

    await page.waitForSelector('section.crowdaq-single-game', { timeout: 10_000 });
    await page.waitForFunction((exp) => {
      const f = document.querySelector('.cdq-excitement-fill');
      return f && Math.round(parseFloat(f.style.width)) === exp;
    }, BEFORE.excitement, { timeout: 10_000 });

    const beforePct = await page.evaluate(() => parseFloat(document.querySelector('.cdq-excitement-fill').style.width));
    assert(Math.round(beforePct) === BEFORE.excitement, `meter BEFORE == model ${BEFORE.excitement} (got ${beforePct})`);
    result.steps.push(`BEFORE: meter=${beforePct}% == backend excitement ${BEFORE.excitement}`);
    await page.waitForTimeout(900); // mount-reveal opacity settle (broadcast fade-in)
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'headless-before-goal-low.png') });
    console.log(`[s13] BEFORE meter = ${beforePct}% (model ${BEFORE.excitement})`);

    // Goal lands → the meter must SPIKE to the model's post-goal excitement.
    server.emitGoal();
    await page.waitForFunction((exp) => {
      const f = document.querySelector('.cdq-excitement-fill');
      return f && Math.round(parseFloat(f.style.width)) === exp;
    }, AFTER.excitement, { timeout: 10_000 });

    const afterPct = await page.evaluate(() => parseFloat(document.querySelector('.cdq-excitement-fill').style.width));
    const scoreHome = (await page.textContent('.cdq-score-home'))?.trim();
    assert(Math.round(afterPct) === AFTER.excitement, `meter AFTER == model ${AFTER.excitement} (got ${afterPct})`);
    assert(afterPct > beforePct, `meter SPIKED on the goal (${beforePct} -> ${afterPct})`);
    assert(scoreHome === '1', `score updated to 1 on the goal (got ${scoreHome})`);
    result.steps.push(`AFTER:  meter=${afterPct}% == backend excitement ${AFTER.excitement} (SPIKE +${(afterPct - beforePct).toFixed(0)})`);
    await page.waitForTimeout(300); // capture mid-GOAL-banner (auto-clears ~4.2s)
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'headless-after-goal-spike.png') });
    console.log(`[s13] AFTER meter = ${afterPct}% (model ${AFTER.excitement}) — SPIKE +${(afterPct - beforePct).toFixed(0)}`);

    result.passed = true;
    console.log('\n[s13] PASS — meter renders the REAL backend excitement and SPIKES on the goal');
  } finally {
    await browser.close();
    await new Promise((r) => http.close(r));
    await server.close();
    writeFileSync(resolve(EVIDENCE_DIR, 's13-headless-run.json'), JSON.stringify(result, null, 2));
  }
  if (!result.passed) process.exit(1);
}

main().catch((err) => { console.error('[s13] FAILED:', err); process.exit(1); });
