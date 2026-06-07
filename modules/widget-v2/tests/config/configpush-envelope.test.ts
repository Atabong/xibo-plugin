/**
 * S87 — ConfigPush schema_invalid reject-loop fix.
 *
 * The live game-delivery server wraps every frame in the standard envelope
 * (`buildEnvelope`): `{ schema_version, channel, message_type, ts, payload, bar_id? }`
 * with the ConfigPush fields nested under `payload`. The widget's
 * `EnvelopeFlatteningDeserializer` hoists the payload keys to the top level but
 * (historically) LEFT the envelope-only `channel` + `payload` wrapper keys on
 * the flattened frame. `validateConfigPush` is closed-shape, so those leftover
 * keys made every live ConfigPush reject with `schema_invalid` (~8/sec).
 *
 * These tests assert the live-envelope ConfigPush, after flattening, is ACCEPTED
 * by `validateConfigPush` (the validator tolerates the known envelope wrapper
 * keys), and that the other frame types still deserialize correctly.
 */
import { describe, it, expect } from 'vitest';
import { EnvelopeFlatteningDeserializer } from '../../src/bootstrap';
import { validateConfigPush } from '../../src/config/validate';

/** The exact wire shape `buildEnvelope('ConfigPush', …)` emits on the WS. */
const liveConfigPushEnvelope = (timezone = 'America/New_York', configHash = 'cfg-live-1'): string =>
  JSON.stringify({
    schema_version: 1,
    channel: 'control',
    message_type: 'ConfigPush',
    ts: '2026-06-07T00:00:00Z',
    bar_id: 'bar-demo',
    payload: {
      config_hash: configHash,
      bar_id: 'bar-demo',
      display_id: 'disp-1',
      preferences: {
        theme: { state: 'default' },
        sports: ['soccer'],
        leagues: ['EPL'],
        region: null,
        state: null,
        city: null,
        timezone,
        business_hours: [],
        local_team_list: [],
        fallback_mode_order: [],
      },
      cache_ceiling_bytes: 1000,
      intervals: { journal_sync_ms: 1000, heartbeat_ms: 30000, manifest_recheck_ms: 60000 },
    },
  });

describe('S87 — live-envelope ConfigPush is accepted (schema_invalid loop fix)', () => {
  const d = new EnvelopeFlatteningDeserializer();

  it('flattens the live envelope and validateConfigPush ACCEPTS it', () => {
    const frame = d.parse(liveConfigPushEnvelope()) as Record<string, unknown>;
    const result = validateConfigPush(frame);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.config_hash).toBe('cfg-live-1');
      expect(result.payload.preferences.timezone).toBe('America/New_York');
      expect(result.payload.bar_id).toBe('bar-demo');
    }
  });

  it('the leftover envelope `channel` key alone no longer triggers schema_invalid', () => {
    // A twin-shaped ConfigPush with ONLY a stray `channel` added — the minimal
    // repro of the live leftover that broke the closed-shape validator.
    const twinWithChannel = {
      message_type: 'ConfigPush',
      schema_version: 1,
      ts: '2026-06-07T00:00:00Z',
      bar_id: 'bar-demo',
      display_id: 'disp-1',
      channel: 'control', // <-- the offending envelope-only key
      config_hash: 'cfg-2',
      preferences: {
        theme: { state: 'default' },
        sports: [],
        leagues: [],
        region: null,
        state: null,
        city: null,
        timezone: 'UTC',
        business_hours: [],
        local_team_list: [],
        fallback_mode_order: [],
      },
      cache_ceiling_bytes: 1000,
      intervals: { journal_sync_ms: 1000, heartbeat_ms: 30000, manifest_recheck_ms: 60000 },
    };
    const result = validateConfigPush(twinWithChannel);
    expect(result.ok).toBe(true);
  });

  it('still rejects a genuinely unknown extra key (not an envelope wrapper)', () => {
    const bogus = {
      message_type: 'ConfigPush',
      schema_version: 1,
      ts: '2026-06-07T00:00:00Z',
      bar_id: 'bar-demo',
      display_id: 'disp-1',
      config_hash: 'cfg-3',
      surprise: 'not-allowed', // <-- a real contract drift, must still reject
      preferences: {
        theme: { state: 'default' },
        sports: [],
        leagues: [],
        region: null,
        state: null,
        city: null,
        timezone: 'UTC',
        business_hours: [],
        local_team_list: [],
        fallback_mode_order: [],
      },
      cache_ceiling_bytes: 1000,
      intervals: { journal_sync_ms: 1000, heartbeat_ms: 30000, manifest_recheck_ms: 60000 },
    };
    const result = validateConfigPush(bogus);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema_invalid');
  });

  it('other frame types still flatten correctly through the same deserializer', () => {
    // GameEvent — fields hoisted to top level.
    const ge = d.parse(
      JSON.stringify({
        schema_version: 1, channel: 'game_data', message_type: 'GameEvent',
        ts: 't', bar_id: 'bar-1', game_id: 'g7', seq: 3,
        payload: { home_score: 2, last_moment: 'GOAL' },
      }),
    ) as Record<string, unknown>;
    expect(ge['home_score']).toBe(2);
    expect(ge['game_id']).toBe('g7');
    expect(ge['seq']).toBe(3);

    // AssetManifest — payload PRESERVED (store reads frame.payload).
    const am = d.parse(
      JSON.stringify({
        schema_version: 1, channel: 'control', message_type: 'AssetManifest',
        ts: 't', payload: { version: 'v1', assets: [] },
      }),
    ) as Record<string, unknown>;
    expect((am['payload'] as Record<string, unknown>)['version']).toBe('v1');
  });
});
