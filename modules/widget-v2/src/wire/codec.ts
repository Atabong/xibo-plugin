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

// `TextEncoder` is a WHATWG global available in the player browser runtime
// (DOM) and in the Node test runtime alike, so no platform fallback is
// needed for the byte-length cap.
const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

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

/** Current wire schema version (matches the backend `CURRENT_SCHEMA_VERSION`). */
export const SCHEMA_VERSION = 1;

/**
 * Canonical channel for each player-to-server message type. The live
 * game-delivery server (`src/wire/parse.ts` → `canonicalChannel`) rejects a
 * frame whose `channel` does not match the message type's canonical channel
 * (`UnpinnedChannelError`). Every player-originated frame is control-plane.
 */
const PLAYER_FRAME_CHANNEL: Record<string, 'control'> = {
  DeviceRegistration: 'control',
  Heartbeat: 'control',
  GameStateRequest: 'control',
  JournalSync: 'control',
};

/**
 * Build a player-to-server envelope from a flat frame.
 *
 * The widget's `PlayerToServerFrame` types are FLAT (`message_type` + payload
 * fields at the top level — the SPEC-CRWDQ-017 twin shape). The live
 * game-delivery server, however, requires a wrapped envelope:
 *   `{ schema_version, channel, message_type, ts, payload: {…fields} }`
 * and rejects anything else with `malformed_frame` (missing `schema_version` /
 * `ts` / `payload`, or `channel` not pinned to the message type) — closing the
 * socket with code 4000. This function performs that wrap: it lifts
 * `message_type` out, nests the remaining fields under `payload`, stamps
 * `schema_version`, the canonical `channel`, and an RFC-3339 `ts`.
 *
 * Returned as `unknown`-cast to `F` so existing call sites (which type the
 * result as the flat frame) keep compiling; the value sent on the wire is the
 * wrapped envelope the server validates.
 */
export function buildEnvelope<F extends PlayerToServerFrame>(frame: F): F {
  const { message_type, ...payload } = frame as unknown as Record<string, unknown> & {
    message_type: string;
  };
  const channel = PLAYER_FRAME_CHANNEL[message_type] ?? 'control';
  return {
    schema_version: SCHEMA_VERSION,
    channel,
    message_type,
    ts: new Date().toISOString(),
    payload,
  } as unknown as F;
}

/** Encode a frame as a single newline-terminated JSON line. */
export function serialize(frame: PlayerToServerFrame): string {
  return JSON.stringify(frame) + '\n';
}
