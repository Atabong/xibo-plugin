/**
 * Transport-layer interfaces for SPEC-CRWDQ-022.
 *
 * All WIRE types (envelope, frame unions, payloads, `WireError`) come from
 * the SPEC-CRWDQ-017 wire barrel — re-exported here for transport
 * consumers, NOT redefined (AC: no hand-rolled type duplicates in
 * transport). This module only declares interfaces that are genuinely
 * transport concerns: lifecycle, journaling, the deserializer result
 * shape, dispatcher and heartbeat surfaces.
 */
export type {
  Envelope,
  ServerFrame,
  ServerMessageType,
  PlayerMessageType,
  PlayerToServerFrame,
  DeviceRegistrationFrame,
  DeviceRegistrationPayload,
  HeartbeatFrame,
  HeartbeatPayload,
  GameStateRequestFrame,
  GameStateRequestPayload,
} from '../wire';
export { WireError, type WireErrorCode } from '../wire';

import type { ServerFrame, ServerMessageType } from '../wire';
import type { WireErrorCode } from '../wire';

/** Logical channel a `message_type` routes to (D-GRH-48). */
export type LogicalChannel = 'control' | 'game_data';

/** Result of `Deserializer.parse` — a typed frame or a non-throwing marker. */
export type ParseResult =
  | ServerFrame
  | { kind: 'empty_line' }
  | { kind: 'parse_error'; raw: string; reason: WireErrorCode };

/** Connection lifecycle event payload. */
export interface LifecycleInfo {
  /** WS close code when applicable (e.g. 1000, 1001, 4000–4004, 4006). */
  code?: number;
  /** Reconnect attempt number (1-based), present on `reconnect` events. */
  attempt?: number;
  /** Backoff delay before this reconnect attempt, in ms. */
  delayMs?: number;
  /** Human-readable reason / error message. */
  reason?: string;
}

export type LifecycleEvent = 'open' | 'close' | 'error' | 'reconnect';
export type LifecycleListener = (info: LifecycleInfo) => void;

/**
 * Minimal sink for D-GRH-29 journal events. The transport never imports a
 * concrete journal — it is injected (system boundary). Production binds a
 * LocalStorage-backed sink; tests bind an in-memory recorder.
 */
export interface JournalSink {
  record(entry: JournalEntry): void;
}

export interface JournalEntry {
  type: JournalEventType;
  /** Raw line snippet for schema-violation visibility. */
  raw?: string;
  /** The `WireError` code, when the entry is a deserialization failure. */
  reason?: WireErrorCode;
  /** Free-form payload for non-deserialization journal events. */
  [key: string]: unknown;
}

export type JournalEventType =
  | 'schema_violation_received'
  | 'binary_frame_dropped'
  | 'frame_too_large_dropped';

/** A registered per-type frame handler. */
export type FrameHandler<F extends ServerFrame = ServerFrame> = (frame: F) => void | Promise<void>;

export interface Dispatcher {
  register<MT extends ServerMessageType>(
    messageType: MT,
    handler: FrameHandler<Extract<ServerFrame, { message_type: MT }>>,
    channel: LogicalChannel,
  ): void;
  dispatch(frame: ServerFrame): void;
}

export interface Heartbeat {
  start(): void;
  stop(): void;
  onAck(seq?: number): void;
  outstanding(): number | null;
}

export interface GameStateRequester {
  requestForGap(gameId: string, sinceSeq: number): void;
  /**
   * Clear the per-game coalescing gate once the recovery `GameStateSnapshot`
   * arrives, so a subsequent gap on the same game can request again (AC5).
   */
  resolve(gameId: string): void;
}

/** Exponential-backoff-with-jitter reconnect policy. */
export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: 'full' | 'none';
}

export interface WsClientConfig {
  url: string;
  barId: string;
  displayId: string;
  playerVersion: string;
  heartbeatIntervalMs: number;
  ackTimeoutMs: number;
  reconnect: ReconnectPolicy;
}

export interface WsClient {
  connect(): Promise<void>;
  send(frame: import('../wire').PlayerToServerFrame): void;
  /** True only while the underlying socket is `WebSocket.OPEN`. */
  isOpen(): boolean;
  close(): Promise<void>;
  on(event: LifecycleEvent, listener: LifecycleListener): void;
}
