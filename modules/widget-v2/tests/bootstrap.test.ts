/**
 * @vitest-environment jsdom
 *
 * Composition-root unit tests (SPEC-CRWDQ-022/-023 boot).
 *
 * Exercises the `boot()` wiring against a FakeWebSocket driving the real
 * crowdaq.v1 handshake into the REAL module pipeline — the same FakeWebSocket
 * the transport suite uses (the single substituted boundary). Asserts: URL
 * resolution + targeting, the DeviceRegistration handshake, single_game mount,
 * score render, and the in-place score update on a GameEvent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boot, resolveWsUrl, HOST_TESTID, EnvelopeFlatteningDeserializer } from '../src/bootstrap';
import { FakeWebSocket } from './transport/support/FakeWebSocket';
import { TESTID } from '../src/templates/single-game/SingleGameTemplate';

/** A LocalStorage stand-in (jsdom provides one, but keep the boot test hermetic). */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const text = (host: HTMLElement, id: string): string =>
  host.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

/** Trimmed textContent of a CSS-class element under the host (S9 score-bug DOM). */
const cls = (host: HTMLElement, selector: string): string =>
  host.querySelector(selector)?.textContent?.trim() ?? '';

const configPush = (): string =>
  JSON.stringify({
    message_type: 'ConfigPush',
    config_hash: 'cfg-1',
    schema_version: 1,
    ts: '2026-06-03T00:00:00Z',
    bar_id: 'bar-demo',
    display_id: 'disp-1',
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
  });

describe('resolveWsUrl', () => {
  it('appends /ws to a ws base', () => {
    expect(resolveWsUrl('ws://game-delivery', null)).toBe('ws://game-delivery/ws');
  });
  it('rewrites https -> wss and appends /ws', () => {
    expect(resolveWsUrl('https://gd.tailnet', null)).toBe('wss://gd.tailnet/ws');
  });
  it('does not double the /ws suffix', () => {
    expect(resolveWsUrl('ws://gd/ws', null)).toBe('ws://gd/ws');
  });
  it('resolves display:<field> targeting against xiboIC info', () => {
    expect(resolveWsUrl('display:wsBase', { wsBase: 'wss://bar.tailnet' })).toBe('wss://bar.tailnet/ws');
  });
  it('returns null for an empty base', () => {
    expect(resolveWsUrl('', null)).toBeNull();
  });
  it('returns null for an unresolvable display field', () => {
    expect(resolveWsUrl('display:missing', {})).toBeNull();
  });
});

describe('EnvelopeFlatteningDeserializer (live payload-nested shape)', () => {
  const d = new EnvelopeFlatteningDeserializer();

  it('hoists payload keys to top level for a game-data frame (live shape)', () => {
    const live = JSON.stringify({
      schema_version: 1,
      channel: 'game_data',
      message_type: 'GameEvent',
      ts: '2026-06-03T00:00:00Z',
      bar_id: 'bar-1',
      game_id: 'game-7',
      seq: 11,
      payload: { home_score: 1, last_moment: 'GOAL' },
    });
    const frame = d.parse(live) as Record<string, unknown>;
    expect(frame['message_type']).toBe('GameEvent');
    expect(frame['game_id']).toBe('game-7'); // envelope-level, preserved
    expect(frame['seq']).toBe(11);
    expect(frame['home_score']).toBe(1); // hoisted from payload
    expect(frame['last_moment']).toBe('GOAL');
  });

  it('passes a top-level (twin-shaped) frame through unchanged', () => {
    const twin = JSON.stringify({ message_type: 'GameEvent', game_id: 'g', seq: 5, home_score: 2 });
    const frame = d.parse(twin) as Record<string, unknown>;
    expect(frame['home_score']).toBe(2);
    expect(frame['seq']).toBe(5);
  });

  it('preserves payload for AssetManifest (which reads frame.payload)', () => {
    const live = JSON.stringify({
      schema_version: 1, channel: 'control', message_type: 'AssetManifest', ts: 't',
      payload: { version: 'v1', assets: [] },
    });
    const frame = d.parse(live) as Record<string, unknown>;
    expect((frame['payload'] as Record<string, unknown>)['version']).toBe('v1');
  });

  it('returns parse-error / empty markers untouched', () => {
    expect(d.parse('').kind).toBe('empty_line');
    expect(d.parse('not json').kind).toBe('parse_error');
  });
});

describe('boot()', () => {
  let captured: FakeWebSocket | null;
  let factory: (url: string, protocol: string) => FakeWebSocket;

  beforeEach(() => {
    captured = null;
    factory = (url, protocol) => {
      captured = new FakeWebSocket(url, protocol);
      return captured;
    };
  });

  it('renders the configure placeholder when no wsBaseUrl is set', async () => {
    const target = document.createElement('div');
    const rt = await boot(target, {}, { displayInfo: null, webSocketFactory: factory as never });
    expect(rt.wsUrl).toBeNull();
    expect(rt.client).toBeNull();
    expect(text(rt.host, 'crowdaq-configure-placeholder')).toBe('Configure wsBaseUrl');
    await rt.destroy();
  });

  it('connects with the crowdaq.v1 subprotocol and sends DeviceRegistration', async () => {
    const target = document.createElement('div');
    const bootPromise = boot(
      target,
      { wsBaseUrl: 'ws://game-delivery' },
      {
        displayInfo: { hardwareKey: 'hw-bar-demo', displayName: 'bar-demo' },
        webSocketFactory: factory as never,
        storage: new MemoryStorage(),
      },
    );
    // The first valid server frame resolves connect(); drive the handshake.
    await Promise.resolve();
    captured!.simulateOpen();
    captured!.simulateMessage(configPush());
    const rt = await bootPromise;

    expect(rt.wsUrl).toBe('ws://game-delivery/ws');
    expect(captured!.protocol).toBe('crowdaq.v1');
    const reg = JSON.parse(captured!.sent[0] ?? '{}') as Record<string, unknown>;
    expect(reg['message_type']).toBe('DeviceRegistration');
    expect(reg['schema_version']).toBe(1);
    expect(reg['channel']).toBe('control');
    expect(typeof reg['ts']).toBe('string');
    const regPayload = reg['payload'] as Record<string, unknown>;
    expect(regPayload['bar_id']).toBe('hw-bar-demo');
    expect(regPayload['display_id']).toBe('bar-demo');
    expect(rt.host.dataset['testid']).toBe(HOST_TESTID);
    await rt.destroy();
  });

  it('mounts single_game, renders the score, and updates it on a GameEvent', async () => {
    const target = document.createElement('div');
    const bootPromise = boot(
      target,
      { wsBaseUrl: 'ws://game-delivery' },
      {
        displayInfo: { hardwareKey: 'hw-bar-demo', displayName: 'bar-demo' },
        webSocketFactory: factory as never,
        storage: new MemoryStorage(),
      },
    );
    await Promise.resolve();
    captured!.simulateOpen();
    captured!.simulateMessage(configPush());
    const rt = await bootPromise;
    const host = rt.host;

    // crowdaq.v1 re-push order: AssetManifest -> ProgramSlot -> GameState snapshot
    // -> PlannedState(single_game). (ProgramSlot before PlannedState avoids the
    // 5 s buffer path; the activator also un-buffers on a later ProgramSlot.)
    captured!.simulateMessage(
      JSON.stringify({ message_type: 'AssetManifest', payload: { version: 'v1', assets: [] } }),
    );
    captured!.simulateMessage(
      JSON.stringify({ message_type: 'ProgramSlot', program_slot_id: 'slot-1', primary_game_id: 'game-7' }),
    );
    captured!.simulateMessage(
      JSON.stringify({
        message_type: 'GameStateSnapshot',
        game_id: 'game-7',
        seq: 10,
        home_team: 'BRA',
        away_team: 'ARG',
        home_score: 0,
        away_score: 0,
        sport_context: { sport: 'Football', league: 'WC', period_clock: "12'" },
      }),
    );
    captured!.simulateMessage(
      JSON.stringify({
        message_type: 'PlannedState',
        state_id: 'st-1',
        business_mode: 'single_game',
        program_slot_id: 'slot-1',
        ad_slot_id: null,
        dwell_target_ms: 30000,
        transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
        theme_id: null,
      }),
    );
    // Let the activator's async activation chain settle.
    await vi.waitFor(() => {
      expect(host.querySelectorAll('section.crowdaq-single-game').length).toBe(1);
    });

    // S9 broadcast score-bug DOM: team names + big score numerals are separate
    // sub-regions of the team block / centre column. Snapshot is 0 - 0.
    expect(cls(host, '.cdq-home .cdq-team-name')).toBe('BRA');
    expect(cls(host, '.cdq-away .cdq-team-name')).toBe('ARG');
    expect(cls(host, '.cdq-score-home')).toBe('0');
    expect(cls(host, '.cdq-score-away')).toBe('0');

    // GameEvent: BRA scores. The store applies the delta; the template's
    // subscription mutates the score IN PLACE (no transition) and fires the
    // GOAL moment (banner activates on the scoring side).
    captured!.simulateMessage(
      JSON.stringify({
        message_type: 'GameEvent',
        game_id: 'game-7',
        seq: 11,
        home_score: 1,
        last_moment: 'GOAL! BRA',
      }),
    );

    await vi.waitFor(() => {
      expect(cls(host, '.cdq-score-home')).toBe('1');
    });
    expect(cls(host, '.cdq-score-away')).toBe('0');
    expect(text(host, TESTID.overlay)).toBe('GOAL! BRA');
    // The score-change fired the broadcast GOAL banner on the home side.
    expect(host.querySelector('.cdq-goal-banner')?.classList.contains('is-on')).toBe(true);
    expect(host.querySelector('section.crowdaq-single-game')?.getAttribute('data-goal')).toBe('home');

    await rt.destroy();
    expect(captured!.closedWith?.code).toBe(1000);
  });
});
