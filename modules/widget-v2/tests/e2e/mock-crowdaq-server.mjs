/**
 * Mock crowdaq.v1 WebSocket server for the SPEC-CRWDQ-027 headless e2e.
 *
 * Faithfully reproduces the live game-delivery contract the S5-infra agent
 * verified end-to-end, so the e2e would CATCH a regression against the real
 * server:
 *
 *   - mandatory subprotocol `crowdaq.v1` (rejects an upgrade missing it);
 *   - JSONL framing rule: each text frame is exactly ONE JSON object with NO
 *     trailing newline. A frame carrying a trailing '\n' is malformed — the
 *     server CLOSES with code 4000 (`malformed_frame`), exactly like live. This
 *     is what makes the test catch a player that appends '\n' on send.
 *   - the spec-ordered re-push after DeviceRegistration:
 *       ConfigPush -> ScheduleWindow -> AssetManifest -> ProgramSlot ->
 *       GameStateSnapshot -> PlannedState(single_game)
 *     (ProgramSlot + GameStateSnapshot precede PlannedState so the single_game
 *     activator resolves the slot + has a score to render immediately — the
 *     live D-GRH-49 guarantee that the snapshot is in-store before the
 *     referencing PlannedState).
 *   - HeartbeatAck on a Heartbeat frame.
 *   - Envelope shape: { schema_version:1, channel, message_type, ts, payload?,
 *     bar_id?, game_id?, seq? }. GameEvent is on channel `game_data`, seq-bearing.
 *
 * The driver controls the server over a tiny control channel (a resolved
 * promise + an exported `emitGoal()`), so the test can assert the BEFORE state
 * (score 0-0) then push a GameEvent and assert the AFTER state (1-0).
 */
import { WebSocketServer } from 'ws';
import { createHash } from 'node:crypto';

const SUBPROTOCOL = 'crowdaq.v1';

/** sha256 of a UTF-8 string, in the AssetManifestStore's `sha256:<hex>` form.
 *  The HttpAssetFetcher fetches the data: URL and the store verifies the bytes
 *  against the manifest content_hash, so a with-ads creative must carry the
 *  REAL hash of its decoded SVG bytes or it is rejected as a hash mismatch. */
function svgHash(svg) {
  return 'sha256:' + createHash('sha256').update(svg, 'utf8').digest('hex');
}
const BAR_ID = '11111111-1111-1111-1111-111111111111';
const GAME_ID = 'game-7';

const now = () => new Date().toISOString();

/** Build a control-channel envelope (no seq). */
const control = (message_type, payload = {}) => ({
  schema_version: 1,
  channel: 'control',
  message_type,
  ts: now(),
  bar_id: BAR_ID,
  payload,
});

/** Build a game-data envelope (seq-bearing). Data nests under `payload` (live). */
const gameData = (message_type, seq, payload) => ({
  schema_version: 1,
  channel: 'game_data',
  message_type,
  ts: now(),
  bar_id: BAR_ID,
  game_id: GAME_ID,
  seq,
  payload,
});

/** Send one frame as a single text frame WITH NO trailing newline (the rule). */
function sendFrame(ws, obj) {
  ws.send(JSON.stringify(obj));
}

/** Normalise a team display name to the manifest `ref` key — MUST match the
 *  widget `teamNameKey` (CrestResolver): trim, lowercase, collapse whitespace. */
function teamNameKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A self-contained round club-badge SVG (no network) for the S12 crest proof.
 *  A coloured roundel with the team's 3-letter monogram — stands in for a real
 *  api-football crest so the headless render shows the badge layout + hash path. */
function svgCrest(bg, ring, mono) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="46" fill="${bg}" stroke="${ring}" stroke-width="5"/>` +
    `<circle cx="50" cy="50" r="30" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>` +
    `<text x="50" y="62" font-family="sans-serif" font-size="30" font-weight="800" ` +
    `fill="#ffffff" text-anchor="middle">${mono}</text></svg>`
  );
}

/**
 * Build AssetManifest crest entries (kind=crest, ref=team name_key) from a
 * `[{ team, bg, ring }]` spec. Each entry carries a self-contained `data:` SVG
 * URL + its REAL sha256 so the store's hash verification + the CrestResolver
 * (ref→asset_id→bytes) resolve the badge exactly like the live path. Returns
 * `[]` when no crests are requested (the default colour-block fallback path).
 */
function crestAssets(crests) {
  if (!Array.isArray(crests) || crests.length === 0) return [];
  return crests.map((c, i) => {
    const mono = (c.mono ?? c.team.replace(/[^a-z]/gi, '').slice(0, 3)).toUpperCase();
    const svg = svgCrest(c.bg ?? '#1b6ca8', c.ring ?? '#ffcf3f', mono);
    return {
      asset_id: `crest:${i}:${teamNameKey(c.team)}`,
      kind: 'crest',
      ref: teamNameKey(c.team),
      content_hash: svgHash(svg),
      url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
      content_type: 'image/svg+xml',
      bytes: 1,
    };
  });
}

/** A self-contained SVG creative (no network) for the ambient e2e rotation. */
function svgCreative(bg, label) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">` +
    `<rect width="1280" height="720" fill="${bg}"/>` +
    `<text x="640" y="380" font-family="sans-serif" font-size="96" font-weight="800" ` +
    `fill="#ffffff" text-anchor="middle">${label}</text></svg>`
  );
}

/**
 * Start the mock server. Returns { url, port, close, onGoal } where `onGoal` is
 * a function the driver calls to push a GameEvent (goal) to the connected
 * player. Resolves once it is listening.
 */
export function startMockServer(options = {}) {
  // scenario: 'single_game' (default), 'safe_info', or 'ambient'. Drives which
  // re-push the server emits after DeviceRegistration so the SPEC-CRWDQ-027
  // harness can prove every standing-display mode mounts against the REAL bundle.
  const scenario = options.scenario ?? 'single_game';
  // ambientAssets: AssetManifest assets array for the 'ambient' scenario (the
  // template rotates every `ambient:`-prefixed image). Default: two creatives.
  const ambientAssets =
    options.ambientAssets ??
    [
      { asset_id: 'ambient:promo-1', content_hash: 'h1', url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svgCreative('#1b6ca8', 'SPONSOR ONE')), content_type: 'image/svg+xml', bytes: 1 },
      { asset_id: 'ambient:promo-2', content_hash: 'h2', url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svgCreative('#a8421b', 'SPONSOR TWO')), content_type: 'image/svg+xml', bytes: 1 },
    ];

  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false) });
    let activeSocket = null;
    const events = [];

    wss.on('connection', (ws, req) => {
      // Enforce the mandatory subprotocol (live rejects a missing one).
      if (ws.protocol !== SUBPROTOCOL) {
        ws.close(4003, 'subprotocol_required');
        return;
      }
      activeSocket = ws;

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          ws.close(4000, 'malformed_frame');
          return;
        }
        const text = data.toString('utf8');

        // FRAMING RULE: a trailing newline is malformed -> close 4000 (live).
        if (text.endsWith('\n')) {
          events.push({ kind: 'malformed_frame_trailing_newline' });
          ws.close(4000, 'malformed_frame');
          return;
        }

        let frame;
        try {
          frame = JSON.parse(text);
        } catch {
          ws.close(4000, 'malformed_frame');
          return;
        }
        events.push({ kind: 'recv', message_type: frame.message_type });

        if (frame.message_type === 'DeviceRegistration') {
          // Spec-ordered re-push (D-GRH-61 / D-GRH-49). The ConfigPush carries
          // city/state so the safe_info venue header renders a venue line.
          sendFrame(ws, control('ConfigPush', {
            config_hash: 'cfg-e2e-1',
            schema_version: 1,
            ts: now(),
            bar_id: BAR_ID,
            display_id: 'bar-demo',
            preferences: {
              theme: { state: 'default' },
              sports: [], leagues: [], region: null, state: 'CA', city: 'Oakland',
              timezone: 'UTC', business_hours: [], local_team_list: [], fallback_mode_order: [],
            },
            cache_ceiling_bytes: 1000,
            intervals: { journal_sync_ms: 1000, heartbeat_ms: 30000, manifest_recheck_ms: 60000 },
          }));
          sendFrame(ws, control('ScheduleWindow', { windows: [] }));

          if (scenario === 'safe_info') {
            // A no-games window: backend authors PlannedState(safe_info) over a
            // real (empty) ProgramSlot — exactly what the live S7 re-push emits.
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-1', assets: [] }));
            sendFrame(ws, control('ProgramSlot', { program_slot_id: 'safe-slot', primary_game_id: null }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-safe-1', business_mode: 'safe_info', program_slot_id: 'safe-slot',
              ad_slot_id: null, dwell_target_ms: 0,
              transition: { animation_id: 'cut', duration_ms: 0 }, theme_id: null,
            }));
            return;
          }

          if (scenario === 'multiple_games') {
            // ≥2 live games (D-GRH-30: the scheduler authors multiple_games).
            // Snapshots precede the PlannedState so each card has a score to
            // render immediately (the D-GRH-49 in-store-before-referencing rule).
            const games = options.games ?? [
              { id: 'mg-1', home: 'DOR', away: 'SGE', hs: 2, as: 1, sport: 'Soccer', league: 'Bundesliga', clock: "67'" },
              { id: 'mg-2', home: 'FCB', away: 'RMA', hs: 1, as: 1, sport: 'Soccer', league: 'La Liga', clock: "54'" },
              { id: 'mg-3', home: 'LIV', away: 'MCI', hs: 0, as: 0, sport: 'Soccer', league: 'Premier', clock: "23'" },
              { id: 'mg-4', home: 'JUV', away: 'INT', hs: 3, as: 2, sport: 'Soccer', league: 'Serie A', clock: "81'" },
            ];
            // S12 polish proof: optional crest assets keyed by team name_key so
            // the headless card redesign shows real badges (live parity).
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-mg', assets: crestAssets(options.crests) }));
            games.forEach((g, i) =>
              sendFrame(ws, { schema_version: 1, channel: 'game_data', message_type: 'GameStateSnapshot', ts: now(), bar_id: BAR_ID, game_id: g.id, seq: 100 + i, payload: {
                home_team: g.home, away_team: g.away, home_score: g.hs, away_score: g.as,
                sport_context: { sport: g.sport, league: g.league, period_clock: g.clock },
              } }));
            sendFrame(ws, control('ProgramSlot', { program_slot_id: 'mg-slot', primary_game_id: games[0].id, game_ids: games.map((g) => g.id) }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-mg-1', business_mode: 'multiple_games', program_slot_id: 'mg-slot',
              ad_slot_id: null, dwell_target_ms: 600000,
              transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
            }));
            return;
          }

          if (scenario === 'fixtures') {
            // 0 live games + a FixtureList (D-GRH-18) → fixtures catalog. The
            // FixtureList carries the per-fixture detail; the ProgramSlot's
            // fixture_ids select + order which cards render.
            const fixtures = options.fixtures ?? [
              { eventId: 'fx-1', sport: 'Soccer', leagueId: 1, leagueName: 'Bundesliga', homeTeam: 'DORTMUND', awayTeam: 'LEIPZIG', kickoffUtc: '2026-06-04T18:30:00Z', feedStatus: 'scheduled' },
              { eventId: 'fx-2', sport: 'Soccer', leagueId: 2, leagueName: 'La Liga', homeTeam: 'BARCELONA', awayTeam: 'SEVILLA', kickoffUtc: '2026-06-04T20:00:00Z', feedStatus: 'scheduled' },
              { eventId: 'fx-3', sport: 'Soccer', leagueId: 3, leagueName: 'Serie A', homeTeam: 'JUVENTUS', awayTeam: 'NAPOLI', kickoffUtc: '2026-06-04T21:45:00Z', feedStatus: 'scheduled' },
            ];
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-fx', assets: [] }));
            sendFrame(ws, control('FixtureList', { fixtures }));
            sendFrame(ws, control('ProgramSlot', { program_slot_id: 'fx-slot', primary_game_id: null, fixture_ids: fixtures.map((f) => f.eventId) }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-fx-1', business_mode: 'fixtures', program_slot_id: 'fx-slot',
              ad_slot_id: null, dwell_target_ms: 600000,
              transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
            }));
            return;
          }

          if (scenario === 'recap') {
            // A concluded game (status:final) → recap frozen closing image. Team
            // names join from the FixtureList by event_id (GameState has codes only).
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-rc', assets: [] }));
            sendFrame(ws, control('FixtureList', { fixtures: [
              { eventId: 'rc-1', sport: 'Soccer', leagueId: 1, leagueName: 'Bundesliga', homeTeam: 'DORTMUND', awayTeam: 'SCHALKE', kickoffUtc: '2026-06-04T16:00:00Z', feedStatus: 'final' },
            ] }));
            sendFrame(ws, { schema_version: 1, channel: 'game_data', message_type: 'GameStateSnapshot', ts: now(), bar_id: BAR_ID, game_id: 'rc-1', seq: 200, payload: {
              home_team: 'DORTMUND', away_team: 'SCHALKE', home_score: 3, away_score: 1, status: 'final',
              sport_context: { sport: 'Soccer', league: 'Bundesliga', period_clock: 'FT' },
            } });
            sendFrame(ws, control('ProgramSlot', { program_slot_id: 'rc-slot', primary_game_id: 'rc-1', game_ids: ['rc-1'] }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-rc-1', business_mode: 'recap', program_slot_id: 'rc-slot',
              ad_slot_id: null, dwell_target_ms: 600000,
              transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
            }));
            return;
          }

          if (scenario === 'multiple_games_with_ads' || scenario === 'fixtures_with_ads') {
            // The composites need a resolvable AdSlot. The LIVE backend emits NO
            // AdSlot frame (the verified gap); this scenario injects one so the
            // headless proof can show the composite layout. `withAds:false`
            // proves the live-gap behaviour (no AdSlot → composite declines).
            const ads = options.withAds !== false;
            const adSvg = svgCreative('#143d2b', 'YOUR AD HERE');
            const adCreative = 'data:image/svg+xml;utf8,' + encodeURIComponent(adSvg);
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-ads', assets: ads ? [
              { asset_id: 'ad:promo', content_hash: svgHash(adSvg), url: adCreative, content_type: 'image/svg+xml', bytes: 1 },
            ] : [] }));
            if (scenario === 'multiple_games_with_ads') {
              const games = [
                { id: 'mga-1', home: 'DOR', away: 'SGE', hs: 2, as: 1, sport: 'Soccer', league: 'Bundesliga', clock: "67'" },
                { id: 'mga-2', home: 'FCB', away: 'RMA', hs: 1, as: 1, sport: 'Soccer', league: 'La Liga', clock: "54'" },
              ];
              games.forEach((g, i) =>
                sendFrame(ws, { schema_version: 1, channel: 'game_data', message_type: 'GameStateSnapshot', ts: now(), bar_id: BAR_ID, game_id: g.id, seq: 300 + i, payload: {
                  home_team: g.home, away_team: g.away, home_score: g.hs, away_score: g.as,
                  sport_context: { sport: g.sport, league: g.league, period_clock: g.clock },
                } }));
              sendFrame(ws, control('ProgramSlot', { program_slot_id: 'mga-slot', primary_game_id: games[0].id, game_ids: games.map((g) => g.id) }));
            } else {
              sendFrame(ws, control('FixtureList', { fixtures: [
                { eventId: 'fxa-1', sport: 'Soccer', leagueId: 1, leagueName: 'Bundesliga', homeTeam: 'DORTMUND', awayTeam: 'LEIPZIG', kickoffUtc: '2026-06-04T18:30:00Z', feedStatus: 'scheduled' },
                { eventId: 'fxa-2', sport: 'Soccer', leagueId: 2, leagueName: 'La Liga', homeTeam: 'BARCELONA', awayTeam: 'SEVILLA', kickoffUtc: '2026-06-04T20:00:00Z', feedStatus: 'scheduled' },
              ] }));
              sendFrame(ws, control('ProgramSlot', { program_slot_id: 'fxa-slot', primary_game_id: null, fixture_ids: ['fxa-1', 'fxa-2'] }));
            }
            // Defer the AdSlot + PlannedState so the AssetManifest prefetch has
            // warmed the creative into the hot cache before the AdPanel reads it
            // synchronously (the live re-push prefetches eagerly, D-GRH-23; here
            // the data: URL warms in a microtask, so a short delay mirrors that).
            setTimeout(() => {
              if (ws.readyState !== ws.OPEN) return;
            if (ads) sendFrame(ws, control('AdSlot', { ad_slot_id: 'ad-1', ad_class: 'sponsor', ad_ref: 'ad:promo', ad_ref_type: 'asset_id', policy: {} }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-ads-1', business_mode: scenario,
              program_slot_id: scenario === 'multiple_games_with_ads' ? 'mga-slot' : 'fxa-slot',
              ad_slot_id: ads ? 'ad-1' : null, dwell_target_ms: 600000,
              transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
            }));
            }, 400);
            return;
          }

          if (scenario === 'ambient') {
            // AssetManifest-driven branded gap-fill (D-GRH-26/27): ambient:* assets
            // drive the rotation; the PlannedState carries a real (empty) slot.
            sendFrame(ws, control('AssetManifest', { version: 'v-e2e-amb-1', assets: ambientAssets }));
            sendFrame(ws, control('ProgramSlot', { program_slot_id: 'ambient-slot', primary_game_id: null }));
            sendFrame(ws, control('PlannedState', {
              state_id: 'st-amb-1', business_mode: 'ambient', program_slot_id: 'ambient-slot',
              ad_slot_id: null, dwell_target_ms: 2000,
              transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
            }));
            return;
          }

          // default: single_game
          // S12 polish proof: `options.single` overrides team names/scores so the
          // harness can drive the LIVE long-name case (e.g. "BORUSSIA DORTMUND")
          // that truncated, and inject crest assets keyed by team name_key.
          const sg = options.single ?? {
            home: 'BRA', away: 'ARG', hs: 0, as: 0,
            sport: 'Football', league: 'World Cup', clock: "12'",
          };
          sendFrame(ws, control('AssetManifest', { version: 'v-e2e-1', assets: crestAssets(options.crests) }));
          sendFrame(ws, control('ProgramSlot', { program_slot_id: 'slot-1', primary_game_id: GAME_ID }));
          sendFrame(ws, gameData('GameStateSnapshot', 100, {
            home_team: sg.home, away_team: sg.away, home_score: sg.hs, away_score: sg.as,
            sport_context: { sport: sg.sport, league: sg.league, period_clock: sg.clock },
          }));
          sendFrame(ws, control('PlannedState', {
            state_id: 'st-1', business_mode: 'single_game', program_slot_id: 'slot-1',
            ad_slot_id: null, dwell_target_ms: 600000,
            transition: { animation_id: 'fade_scale_up', duration_ms: 0 }, theme_id: null,
          }));
          return;
        }

        if (frame.message_type === 'Heartbeat') {
          sendFrame(ws, { schema_version: 1, channel: 'control', message_type: 'HeartbeatAck', ts: now(), seq: 0, bar_id: BAR_ID, payload: {} });
          return;
        }
      });

      ws.on('close', () => { if (activeSocket === ws) activeSocket = null; });
    });

    wss.on('listening', () => {
      const port = wss.address().port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        port,
        events,
        /** Push a GameEvent (goal): BRA scores, seq advances. */
        emitGoal() {
          if (!activeSocket) throw new Error('no active player socket');
          sendFrame(activeSocket, gameData('GameEvent', 101, { home_score: 1, last_moment: 'GOAL! Brazil takes the lead' }));
        },
        /**
         * SPEC-CRWDQ-S41: simulate a proxy/pod roll by abruptly dropping the
         * active player socket. The player must re-establish on its OWN (no
         * manual reconnect) — the server then receives a fresh DeviceRegistration
         * and re-pushes the full state. terminate() destroys the TCP socket with
         * no clean close handshake, the closest analogue to a yanked connection.
         */
        dropActive() {
          if (!activeSocket) throw new Error('no active player socket to drop');
          const sock = activeSocket;
          activeSocket = null;
          sock.terminate();
        },
        /** Count of DeviceRegistration frames received (one per (re)connect). */
        registrationCount() {
          return events.filter((e) => e.kind === 'recv' && e.message_type === 'DeviceRegistration').length;
        },
        close() {
          return new Promise((r) => wss.close(r));
        },
      });
    });
  });
}
