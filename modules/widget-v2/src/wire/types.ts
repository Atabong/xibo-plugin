/**
 * SPEC-CRWDQ-017 wire-protocol type twin (local frozen contract).
 *
 * SPEC-CRWDQ-022 consumes the wire protocol defined by SPEC-CRWDQ-017
 * (wire-protocol envelope + JSONL serializer + generated TS twin). That
 * backend-owned generated twin is not yet a file in this repo. Per the
 * consumer-first contract, these types are defined here from the shapes
 * SPEC-CRWDQ-022 and the child-issue ACs document, in ONE place (the
 * `wire/` barrel) so the `transport/` module holds no hand-rolled
 * duplicates. When SPEC-CRWDQ-017 ships its generated barrel, this module
 * is the swap point: re-export from there and delete the local bodies.
 *
 * Drift between the Go module and this twin is a SPEC-CRWDQ-017 concern.
 */

/** Closed set of server-to-player message types (D-GRH-25 + D-GRH-42). */
export type ServerMessageType =
  | 'ConfigPush'
  | 'ScheduleWindow'
  | 'PlannedState'
  | 'ProgramSlot'
  | 'AdSlot'
  | 'OverrideInjection'
  | 'AssetManifest'
  | 'MessagingLane'
  | 'HeartbeatAck'
  | 'SyncRequest'
  | 'GameState'
  | 'GameStateSnapshot'
  | 'GameEvent'
  | 'DisplayEvent'
  | 'FixtureList';

/** Closed set of player-to-server message types. */
export type PlayerMessageType =
  | 'DeviceRegistration'
  | 'GameStateRequest'
  | 'Heartbeat'
  | 'JournalSync';

/**
 * The base wire envelope. Every frame carries a `message_type`. Frames on
 * the game-data channel additionally carry a per-source monotonic `seq`
 * and a `game_id`; control frames may carry a `config_hash`. The envelope
 * is intentionally permissive at this layer — per-type schema validation
 * lives in the deserializer (D-GRH-29).
 */
export interface Envelope {
  message_type: string;
  seq?: number;
  game_id?: string;
  config_hash?: string;
  [key: string]: unknown;
}

// --- Server-to-player frames -------------------------------------------------
// Each frame narrows `message_type` to a literal so the dispatcher and
// handlers can discriminate on it. Payload fields beyond the discriminant
// are carried through the index signature (the per-channel handlers in
// SPEC-CRWDQ-014/-023 own the full per-type schema).

export interface ConfigPushFrame extends Envelope { message_type: 'ConfigPush'; config_hash: string; }
export interface ScheduleWindowFrame extends Envelope { message_type: 'ScheduleWindow'; }
export interface PlannedStateFrame extends Envelope { message_type: 'PlannedState'; }
export interface ProgramSlotFrame extends Envelope { message_type: 'ProgramSlot'; }
export interface AdSlotFrame extends Envelope { message_type: 'AdSlot'; }
export interface OverrideInjectionFrame extends Envelope { message_type: 'OverrideInjection'; }
export interface AssetManifestFrame extends Envelope { message_type: 'AssetManifest'; }
export interface MessagingLaneFrame extends Envelope { message_type: 'MessagingLane'; }
export interface HeartbeatAckFrame extends Envelope { message_type: 'HeartbeatAck'; seq: number; }
export interface SyncRequestFrame extends Envelope { message_type: 'SyncRequest'; }
export interface GameStateFrame extends Envelope { message_type: 'GameState'; game_id: string; seq: number; }
export interface GameStateSnapshotFrame extends Envelope { message_type: 'GameStateSnapshot'; game_id: string; seq: number; }
export interface GameEventFrame extends Envelope { message_type: 'GameEvent'; game_id: string; seq: number; }
export interface DisplayEventFrame extends Envelope { message_type: 'DisplayEvent'; }
export interface FixtureListFrame extends Envelope { message_type: 'FixtureList'; }

export type ServerFrame =
  | ConfigPushFrame
  | ScheduleWindowFrame
  | PlannedStateFrame
  | ProgramSlotFrame
  | AdSlotFrame
  | OverrideInjectionFrame
  | AssetManifestFrame
  | MessagingLaneFrame
  | HeartbeatAckFrame
  | SyncRequestFrame
  | GameStateFrame
  | GameStateSnapshotFrame
  | GameEventFrame
  | DisplayEventFrame
  | FixtureListFrame;

/** The set of valid server `message_type` discriminants, runtime-checkable. */
export const SERVER_MESSAGE_TYPES: ReadonlySet<ServerMessageType> = new Set<ServerMessageType>([
  'ConfigPush',
  'ScheduleWindow',
  'PlannedState',
  'ProgramSlot',
  'AdSlot',
  'OverrideInjection',
  'AssetManifest',
  'MessagingLane',
  'HeartbeatAck',
  'SyncRequest',
  'GameState',
  'GameStateSnapshot',
  'GameEvent',
  'DisplayEvent',
  'FixtureList',
]);

// --- Player-to-server payloads + frames --------------------------------------

/** D-GRH-61 single-message handshake payload. */
export interface DeviceRegistrationPayload {
  bar_id: string;
  display_id: string;
  player_sw_version: string;
  last_seq: number;
  last_config_hash: string | null;
}

export interface DeviceRegistrationFrame extends DeviceRegistrationPayload {
  message_type: 'DeviceRegistration';
}

/** D-GRH-59 heartbeat payload (no `seq` — liveness is ack-driven). */
export interface HeartbeatPayload {
  player_local_ts: number;
  config_hash: string | null;
}

export interface HeartbeatFrame extends HeartbeatPayload {
  message_type: 'Heartbeat';
}

/** D-GRH-63 seq-gap recovery request. */
export interface GameStateRequestPayload {
  game_id: string;
  since_seq: number;
}

export interface GameStateRequestFrame extends GameStateRequestPayload {
  message_type: 'GameStateRequest';
}

/**
 * SPEC-CRWDQ-061 player-side journal-sync twin. Mirrors the backend ingest
 * shape `JournalSyncPayload = { bar_id, display_id, from_ts, to_ts, entries[] }`
 * (crowdaq-backend src/wire/types.ts). Each `entries[]` element carries the
 * monotonic `seq`, an ISO `ts`, the closed-set `event_type` the backend
 * `player_journal` table validates against (the six PLAYER_JOURNAL_EVENT_TYPES
 * — owned by SPEC-CRWDQ-059), and an event-specific `payload`. The widget
 * `observability` module owns the closed `event_type` enum + the fine→bucket
 * mapping; the wire layer treats `event_type` as an opaque string so this twin
 * carries no enum drift. Drift between this twin and the backend ingest schema
 * is a SPEC-CRWDQ-059 concern; this barrel is the swap point.
 */
export interface JournalSyncEntryWire {
  seq: number;
  ts: string;
  bar_id: string;
  display_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface JournalSyncPayload {
  bar_id: string;
  display_id: string;
  from_ts: string;
  to_ts: string;
  entries: JournalSyncEntryWire[];
}

export interface JournalSyncFrame extends JournalSyncPayload {
  message_type: 'JournalSync';
}

export type PlayerToServerFrame =
  | DeviceRegistrationFrame
  | HeartbeatFrame
  | GameStateRequestFrame
  | JournalSyncFrame;
