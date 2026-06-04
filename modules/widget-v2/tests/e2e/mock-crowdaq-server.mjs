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

const SUBPROTOCOL = 'crowdaq.v1';
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
          sendFrame(ws, control('AssetManifest', { version: 'v-e2e-1', assets: [] }));
          sendFrame(ws, control('ProgramSlot', { program_slot_id: 'slot-1', primary_game_id: GAME_ID }));
          sendFrame(ws, gameData('GameStateSnapshot', 100, {
            home_team: 'BRA', away_team: 'ARG', home_score: 0, away_score: 0,
            sport_context: { sport: 'Football', league: 'World Cup', period_clock: "12'" },
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
        close() {
          return new Promise((r) => wss.close(r));
        },
      });
    });
  });
}
