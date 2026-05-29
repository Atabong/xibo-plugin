/**
 * SPEC-CRWDQ-017 `WireError` codes (local twin). The closed set of
 * malformation reasons `parseLine` can report. Seven codes, mirroring the
 * deserialization failure modes documented in SPEC-CRWDQ-022 (invalid
 * JSON, structural problems, the closed-enum check, and the two defensive
 * caps on binary/oversized frames).
 */
export type WireErrorCode =
  /** `JSON.parse` threw — the line is not valid JSON. */
  | 'invalid_json'
  /** Parsed to a non-object (array, string, number, null). */
  | 'not_an_object'
  /** Object has no `message_type` field, or it is not a string. */
  | 'missing_message_type'
  /** `message_type` is a string but not in the closed server enum. */
  | 'unknown_message_type'
  /** A required per-type field is absent or wrong-typed. */
  | 'schema_invalid'
  /** The frame arrived as binary, not a UTF-8 JSON line. */
  | 'binary_frame'
  /** The frame exceeds the 1 MB defensive cap. */
  | 'frame_too_large';

/** The seven canonical codes, in declaration order. */
export const WIRE_ERROR_CODES: readonly WireErrorCode[] = [
  'invalid_json',
  'not_an_object',
  'missing_message_type',
  'unknown_message_type',
  'schema_invalid',
  'binary_frame',
  'frame_too_large',
];

/**
 * Thrown by `parseLine` on any malformation. Consumers that prefer a
 * non-throwing surface (the transport `Deserializer`) catch this and
 * translate to a `parse_error` marker.
 */
export class WireError extends Error {
  readonly code: WireErrorCode;
  /** The raw line (or a truncated snippet for oversized frames). */
  readonly raw: string;

  constructor(code: WireErrorCode, raw: string, message?: string) {
    super(message ?? `wire ${code}`);
    this.name = 'WireError';
    this.code = code;
    this.raw = raw;
  }
}
