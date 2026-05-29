/**
 * SPEC-CRWDQ-017 JSONL codec twin: `parseLine`, `buildEnvelope`,
 * `serialize`. One JSON object per `\n`-terminated line (D-GRH-42).
 *
 * `parseLine` is the single authoritative deserialization entry point. It
 * THROWS a {@link WireError} on any malformation; the transport
 * `Deserializer` wraps it to expose a non-throwing surface.
 */
import { WireError } from './errors';
import {
  SERVER_MESSAGE_TYPES,
  type ServerFrame,
  type ServerMessageType,
  type PlayerToServerFrame,
} from './types';

/** Defensive cap: refuse frames larger than 1 MB (prevents OOM, D-GRH spirit). */
export const MAX_FRAME_BYTES = 1024 * 1024;

const byteLength = (s: string): number =>
  typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : Buffer.byteLength(s, 'utf8');

/**
 * Parse one JSONL line into a typed {@link ServerFrame}. Throws
 * {@link WireError} (never a raw `SyntaxError`) for every malformation.
 */
export function parseLine(line: string): ServerFrame {
  if (byteLength(line) > MAX_FRAME_BYTES) {
    throw new WireError('frame_too_large', line.slice(0, 256), 'frame exceeds 1 MB cap');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new WireError('invalid_json', line, 'line is not valid JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WireError('not_an_object', line, 'frame is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const messageType = obj['message_type'];
  if (typeof messageType !== 'string') {
    throw new WireError('missing_message_type', line, 'message_type is absent or not a string');
  }

  if (!SERVER_MESSAGE_TYPES.has(messageType as ServerMessageType)) {
    throw new WireError('unknown_message_type', line, `unknown message_type "${messageType}"`);
  }

  return obj as unknown as ServerFrame;
}

/**
 * Build a player-to-server envelope. The envelope IS the frame at this
 * protocol revision (no separate header); kept as a named seam so a future
 * SPEC-CRWDQ-017 header wrap is a single edit here.
 */
export function buildEnvelope<F extends PlayerToServerFrame>(frame: F): F {
  return frame;
}

/** Encode a frame as a single newline-terminated JSON line. */
export function serialize(frame: PlayerToServerFrame): string {
  return JSON.stringify(frame) + '\n';
}
