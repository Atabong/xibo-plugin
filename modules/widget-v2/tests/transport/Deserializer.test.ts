import { describe, it, expect } from 'vitest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import { SERVER_MESSAGE_TYPES } from '../../src/wire';

const de = () => new WireDeserializer();

describe('Deserializer.parse', () => {
  it('returns a typed frame for every server message_type', () => {
    for (const mt of SERVER_MESSAGE_TYPES) {
      const result = de().parse(JSON.stringify({ message_type: mt, game_id: 'g', seq: 1, config_hash: 'h' }));
      expect('message_type' in result && result.message_type).toBe(mt);
    }
  });

  it('returns an empty_line marker for a whitespace-only line', () => {
    expect(de().parse('   ')).toEqual({ kind: 'empty_line' });
    expect(de().parse('')).toEqual({ kind: 'empty_line' });
  });

  it('returns parse_error invalid_json for non-JSON, never throwing', () => {
    const result = de().parse('{broken');
    expect(result).toMatchObject({ kind: 'parse_error', reason: 'invalid_json' });
  });

  it('returns parse_error missing_message_type when the field is absent', () => {
    const result = de().parse('{"foo":1}');
    expect(result).toMatchObject({ kind: 'parse_error', reason: 'missing_message_type' });
  });

  it('returns parse_error unknown_message_type for a type outside the enum', () => {
    const result = de().parse('{"message_type":"Bogus"}');
    expect(result).toMatchObject({ kind: 'parse_error', reason: 'unknown_message_type' });
  });

  it('returns parse_error not_an_object for a JSON array', () => {
    const result = de().parse('[1,2]');
    expect(result).toMatchObject({ kind: 'parse_error', reason: 'not_an_object' });
  });

  it('carries a raw snippet on parse_error markers', () => {
    const result = de().parse('{broken');
    expect(result).toMatchObject({ raw: '{broken' });
  });
});
