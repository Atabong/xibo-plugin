/**
 * Non-throwing JSONL deserializer (SPEC-CRWDQ-022 step 2–3).
 *
 * Wraps the SPEC-CRWDQ-017 `parseLine` and catches every `WireError`,
 * translating it to a `parse_error` marker so the read loop never throws
 * on a bad frame (D-GRH-29). Empty / whitespace-only lines — which the
 * JSONL stream may legitimately contain between frames — return an
 * `empty_line` marker rather than an error.
 */
import { parseLine, WireError } from '../wire';
import type { ParseResult } from './types';

export interface Deserializer {
  parse(line: string): ParseResult;
}

export class WireDeserializer implements Deserializer {
  parse(line: string): ParseResult {
    if (line.trim().length === 0) {
      return { kind: 'empty_line' };
    }
    try {
      return parseLine(line);
    } catch (err) {
      if (err instanceof WireError) {
        return { kind: 'parse_error', raw: err.raw, reason: err.code };
      }
      // parseLine only throws WireError; defensively normalize anything else.
      return { kind: 'parse_error', raw: line, reason: 'invalid_json' };
    }
  }
}
