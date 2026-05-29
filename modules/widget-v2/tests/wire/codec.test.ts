import { describe, it, expect } from 'vitest';
import { parseLine, buildEnvelope, serialize } from '../../src/wire/codec';
import { WireError } from '../../src/wire/errors';
import { SERVER_MESSAGE_TYPES } from '../../src/wire/types';

describe('parseLine', () => {
  it('returns a typed frame for a well-formed server line', () => {
    const frame = parseLine('{"message_type":"ConfigPush","config_hash":"abc"}');
    expect(frame.message_type).toBe('ConfigPush');
  });

  it('parses every server message_type in the closed enum', () => {
    for (const mt of SERVER_MESSAGE_TYPES) {
      const frame = parseLine(JSON.stringify({ message_type: mt, game_id: 'g', seq: 1, config_hash: 'h' }));
      expect(frame.message_type).toBe(mt);
    }
  });

  it('throws WireError invalid_json for non-JSON input', () => {
    expect(() => parseLine('{not json')).toThrowError(WireError);
    try {
      parseLine('{not json');
    } catch (e) {
      expect((e as WireError).code).toBe('invalid_json');
    }
  });

  it('throws WireError not_an_object for a JSON array', () => {
    try {
      parseLine('[1,2,3]');
      expect.unreachable();
    } catch (e) {
      expect((e as WireError).code).toBe('not_an_object');
    }
  });

  it('throws WireError missing_message_type when message_type is absent', () => {
    try {
      parseLine('{"foo":"bar"}');
      expect.unreachable();
    } catch (e) {
      expect((e as WireError).code).toBe('missing_message_type');
    }
  });

  it('throws WireError unknown_message_type for a type outside the enum', () => {
    try {
      parseLine('{"message_type":"NopeFrame"}');
      expect.unreachable();
    } catch (e) {
      expect((e as WireError).code).toBe('unknown_message_type');
    }
  });

  it('throws WireError frame_too_large past the 1 MB cap', () => {
    const big = '{"message_type":"GameState","game_id":"g","seq":1,"blob":"' + 'x'.repeat(1024 * 1024) + '"}';
    try {
      parseLine(big);
      expect.unreachable();
    } catch (e) {
      expect((e as WireError).code).toBe('frame_too_large');
    }
  });
});

describe('serialize', () => {
  it('encodes a player frame as a single newline-terminated JSON line', () => {
    const line = serialize(buildEnvelope({
      message_type: 'Heartbeat',
      player_local_ts: 1234,
      config_hash: 'h',
    }));
    expect(line.endsWith('\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1);
    expect(JSON.parse(line.trimEnd())).toMatchObject({ message_type: 'Heartbeat' });
  });
});

describe('buildEnvelope', () => {
  it('passes the frame through unchanged (envelope is the frame itself)', () => {
    const frame = buildEnvelope({ message_type: 'Heartbeat', player_local_ts: 1, config_hash: null });
    expect(frame.message_type).toBe('Heartbeat');
  });
});
