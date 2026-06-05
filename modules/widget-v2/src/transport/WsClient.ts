/**
 * The single physical WebSocket session per display (SPEC-CRWDQ-022).
 *
 * Owns the connection lifecycle: opens one WS against the tailnet-resolved
 * `GameDeliveryService` URL with the `crowdaq.v1` subprotocol, performs the
 * D-GRH-61 single-message registration handshake on every open (first +
 * reconnect), runs the JSONL read loop through the injected
 * {@link Deserializer} into the {@link Dispatcher}, drives the
 * {@link HeartbeatLoop}, and reconnects with exponential backoff + full
 * jitter on transport error / SPEC-020 server close / heartbeat liveness
 * loss — but never on an application-initiated {@link WsClient.close}.
 *
 * Everything below the socket is a real instance wired by DI; only the
 * WebSocket, the clock, and the jitter RNG are substituted at the system
 * boundary (INV-FACTORY-17).
 */
import { buildEnvelope, type DeviceRegistrationFrame, type PlayerToServerFrame } from '../wire';
import { HeartbeatLoop } from './Heartbeat';
import type { Deserializer } from './Deserializer';
import type {
  Dispatcher,
  Heartbeat,
  JournalSink,
  LifecycleEvent,
  LifecycleInfo,
  LifecycleListener,
  ParseResult,
  ServerFrame,
  WsClient,
  WsClientConfig,
} from './types';

/**
 * Structural slice of the browser `WebSocket` the client actually uses.
 * Declared here (not via the DOM global) so the node test runtime can bind
 * a {@link FakeWebSocket} and the module carries no ambient dependency.
 */
export interface WebSocketLike {
  readonly protocol: string;
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export type WebSocketFactory = (url: string, protocol: string) => WebSocketLike;

/** SPEC-CRWDQ-022 WS subprotocol token (D-GRH-42). */
export const SUBPROTOCOL = 'crowdaq.v1';

/**
 * SPEC-020 server-initiated close codes that mean "the server dropped me;
 * re-establish". 1001 (going away) + the 4000–4004 / 4006 application range.
 * 1000 is reserved for our own clean close and never reconnects.
 */
const RECONNECT_CLOSE_CODES: ReadonlySet<number> = new Set([1001, 4000, 4001, 4002, 4003, 4004, 4006]);

const CLEAN_CLOSE = 1000;

/** WHATWG `WebSocket.OPEN`. */
const WS_OPEN = 1;

/** A 1000 close is "clean" — it is never on its own a reconnect trigger. */
const isCleanCode = (code: number): boolean => code === CLEAN_CLOSE;

type EmptyLine = Extract<ParseResult, { kind: 'empty_line' }>;
type ParseError = Extract<ParseResult, { kind: 'parse_error' }>;

const isParseError = (r: ParseResult): r is ParseError =>
  (r as { kind?: unknown }).kind === 'parse_error';
const isEmptyLine = (r: ParseResult): r is EmptyLine =>
  (r as { kind?: unknown }).kind === 'empty_line';

export interface WsClientDeps {
  webSocketFactory: WebSocketFactory;
  deserializer: Deserializer;
  dispatcher: Dispatcher;
  journal: JournalSink;
  /** Player-local clock (injected; vitest fake timers under test). */
  now: () => number;
  /** Jitter RNG in [0,1); injected so backoff is deterministic under test. */
  random: () => number;
  /** Optional heartbeat override; defaults to a real {@link HeartbeatLoop}. */
  heartbeat?: Heartbeat;
}

export class CrowdaqWsClient implements WsClient {
  private socket: WebSocketLike | null = null;
  private readonly listeners: Record<LifecycleEvent, Set<LifecycleListener>> = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    reconnect: new Set(),
  };

  private readonly heartbeat: Heartbeat;
  /** Highest server `seq` observed, surfaced on (re)registration (D-GRH-61). */
  private lastSeq = 0;
  private lastConfigHash: string | null = null;
  /** Set true only by the public `close()`; suppresses auto-reconnect. */
  private intentionalClose = false;
  /**
   * True once the CURRENT socket reached OPEN. Reset on every `open()`. Drives
   * the pre-open-failure recovery in {@link onError}: a WebSocket whose connect
   * is REFUSED before it ever opens (e.g. the Xibo player's Content-Security-
   * Policy `connect-src` blocking the cross-origin game-delivery WS, or DNS /
   * TLS failure) fires `error` but — observed live on Chromium — NEVER fires a
   * subsequent `close`. Without this guard the whole close-driven recovery
   * (reconnect backoff + the SafeStateController `control_channel_lost`
   * fallback that mounts safe_info) would never arm, leaving the host blank.
   */
  private opened = false;
  /** Guards against double-handling when both `error` and `close` do fire. */
  private failureHandled = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolver for the in-flight `connect()` promise (first-frame gate). */
  private connectResolve: (() => void) | null = null;
  /** Listeners bound to the current socket, retained for teardown. */
  private boundListeners: Array<[string, (ev: unknown) => void]> = [];
  /**
   * SPEC-CRWDQ-S41 inbound-frame liveness watchdog. Reset on EVERY inbound
   * frame (any server frame, including a HeartbeatAck). If it fires, the socket
   * has gone silent past `livenessTimeoutMs` — the half-open proxy/pod-roll
   * case where neither `error` nor `close` is delivered — and we force a
   * reconnect. Null when disabled or no socket is live.
   */
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: WsClientConfig,
    private readonly deps: WsClientDeps,
  ) {
    this.heartbeat =
      deps.heartbeat ??
      new HeartbeatLoop({
        send: (frame) => this.send(frame),
        intervalMs: config.heartbeatIntervalMs,
        ackTimeoutMs: config.ackTimeoutMs,
        configHash: () => this.lastConfigHash,
        now: deps.now,
        onLivenessLost: () => this.onLivenessLost(),
      });
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.connectResolve = resolve;
      this.open();
    });
  }

  send(frame: PlayerToServerFrame): void {
    // Each WS text frame is exactly ONE JSON object with NO trailing newline.
    // The live game-delivery server closes the socket with code 4000
    // (malformed_frame) on a trailing '\n', so we deliberately use
    // JSON.stringify here, NOT the codec `serialize()` (which appends '\n' for
    // file-based JSONL). Do not "fix" this to add a newline.
    this.socket?.send(JSON.stringify(buildEnvelope(frame)));
  }

  /**
   * Readiness seam for send-path consumers (SPEC-CRWDQ-061 JournalSyncClient):
   * true only when the underlying socket is `WebSocket.OPEN`. A consumer that
   * batches must gate on this before a `send`, because a write to a CONNECTING
   * / CLOSING / absent socket is silently dropped here. Read-only — it does not
   * touch transport behaviour.
   */
  isOpen(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }

  close(): Promise<void> {
    this.intentionalClose = true;
    this.cancelReconnect();
    this.cancelLivenessWatchdog();
    this.heartbeat.stop();
    this.socket?.close(CLEAN_CLOSE, 'ws_close_clean');
    this.emit('close', { code: CLEAN_CLOSE, reason: 'ws_close_clean' });
    return Promise.resolve();
  }

  on(event: LifecycleEvent, listener: LifecycleListener): void {
    this.listeners[event].add(listener);
  }

  // --- connection management -------------------------------------------------

  private open(): void {
    this.teardownSocket();
    this.opened = false;
    this.failureHandled = false;
    // SPEC-CRWDQ-S41: re-resolve the WS URL on EVERY (re)connect so an
    // established-then-dropped reconnect rejoins the CURRENT endpoint (the
    // tailnet proxy may have moved during a roll) rather than a stale captured
    // URL. Falls back to the static config URL when no resolver is configured
    // or it yields nothing.
    const url = this.config.resolveUrl?.() ?? this.config.url;
    const ws = this.deps.webSocketFactory(url, SUBPROTOCOL);
    this.socket = ws;

    this.bind(ws, 'open', () => this.onOpen());
    this.bind(ws, 'message', (ev) => this.onMessage(ev));
    this.bind(ws, 'error', (ev) => this.onError(ev));
    this.bind(ws, 'close', (ev) => this.onClose(ev));
  }

  private onOpen(): void {
    this.opened = true;
    // D-GRH-61: a single DeviceRegistration is the first outbound frame on
    // every open (first connect AND every reconnect). It carries lastSeq +
    // lastConfigHash, so the backend's conn-registry replays the CURRENT
    // PlannedState/ConfigPush on (re)registration — i.e. registration IS the
    // re-subscribe + state-resync after a drop (SPEC-CRWDQ-S41). The first
    // resulting server frame both implicitly acks the registration (resolving
    // connect()) and supersedes any local safe_info fallback.
    this.sendRegistration();
    this.heartbeat.start();
    // SPEC-CRWDQ-S41: arm the inbound-frame liveness watchdog for this socket.
    // A healthy link delivers at least a HeartbeatAck every heartbeat interval;
    // silence past livenessTimeoutMs means the socket is dead-but-open.
    this.armLivenessWatchdog();
    this.emit('open', {});
  }

  private sendRegistration(): void {
    const frame: DeviceRegistrationFrame = {
      message_type: 'DeviceRegistration',
      bar_id: this.config.barId,
      display_id: this.config.displayId,
      player_sw_version: this.config.playerVersion,
      last_seq: this.lastSeq,
      last_config_hash: this.lastConfigHash,
    };
    this.send(frame);
  }

  private onMessage(ev: unknown): void {
    const data = (ev as { data?: unknown }).data;

    if (typeof data !== 'string') {
      // Binary frames are not part of the JSONL contract (step 9) — drop +
      // journal, never crash (AC9).
      this.deps.journal.record({ type: 'binary_frame_dropped' });
      return;
    }

    const result = this.deps.deserializer.parse(data);
    this.handleParseResult(result, data);
  }

  private handleParseResult(result: ParseResult, _raw: string): void {
    if (isParseError(result)) {
      // A defensive 1 MB cap breach gets its own journal type (AC9);
      // everything else is a schema violation (AC8). Neither reaches a
      // handler.
      if (result.reason === 'frame_too_large' || result.reason === 'binary_frame') {
        this.deps.journal.record({ type: 'frame_too_large_dropped', raw: result.raw, reason: result.reason });
      } else {
        this.deps.journal.record({ type: 'schema_violation_received', raw: result.raw, reason: result.reason });
      }
      return;
    }
    if (isEmptyLine(result)) {
      return; // JSONL may carry blank separators; not an error.
    }

    this.onValidFrame(result);
  }

  private onValidFrame(frame: ServerFrame): void {
    // The first valid server frame resolves connect() (D-GRH-61).
    if (this.connectResolve) {
      const resolve = this.connectResolve;
      this.connectResolve = null;
      resolve();
    }

    this.reconnectAttempt = 0; // a live frame proves the link is healthy.
    this.armLivenessWatchdog(); // SPEC-CRWDQ-S41: any inbound frame is liveness.
    this.trackResyncState(frame);

    if (frame.message_type === 'HeartbeatAck') {
      this.heartbeat.onAck((frame as Extract<ServerFrame, { message_type: 'HeartbeatAck' }>).seq);
      return;
    }

    this.deps.dispatcher.dispatch(frame);
  }

  /** Remember the resync anchors echoed back on the next registration. */
  private trackResyncState(frame: ServerFrame): void {
    if (typeof frame.seq === 'number' && frame.seq > this.lastSeq) {
      this.lastSeq = frame.seq;
    }
    if (frame.message_type === 'ConfigPush') {
      this.lastConfigHash = (frame as Extract<ServerFrame, { message_type: 'ConfigPush' }>).config_hash;
    }
  }

  private onError(ev: unknown): void {
    const reason = (ev as { message?: string }).message;
    this.emit('error', reason !== undefined ? { reason } : {});

    // Pre-open connect failure recovery. When the socket errors WITHOUT ever
    // having opened, the browser may not deliver a follow-up `close` event
    // (verified live on the Xibo Chromium player: a CSP-`connect-src`-blocked
    // WS fires ONLY `error`, leaving readyState=CLOSED and no `close`). Treat
    // that as a synthetic 1006 close so the standard close-path recovery runs:
    // it emits `close` (arming the SafeStateController `control_channel_lost`
    // safe_info fallback so the bar stops showing a blank host) and schedules a
    // reconnect. A real `close` arriving afterwards is deduped via
    // `failureHandled`. An already-OPEN socket that errors is left to its own
    // (real) `close` event as before.
    if (this.opened || this.intentionalClose) return;
    this.handleConnectionFailure(undefined);
  }

  private onClose(ev: unknown): void {
    const code = (ev as { code?: number }).code;
    this.handleConnectionFailure(code);
  }

  /**
   * The single close/failure recovery path, reached from a real `close` event
   * OR a pre-open `error` that the browser never followed with a `close`.
   * Idempotent per connection attempt (the {@link failureHandled} guard) so a
   * synthesized-then-real close (or vice versa) only recovers once.
   */
  private handleConnectionFailure(code: number | undefined): void {
    if (this.failureHandled) return;
    this.failureHandled = true;

    this.heartbeat.stop();
    this.cancelLivenessWatchdog();
    this.emit('close', code !== undefined ? { code } : {});

    if (this.intentionalClose) {
      return; // application-initiated close() — honor it, no reconnect.
    }
    // Reconnect on a transport drop (no code / 1006) or any SPEC-020
    // server-initiated code. A bare server 1000 that we did not initiate is
    // not in the SPEC-020 trigger set and is left alone.
    if (code === undefined || !isCleanCode(code) || RECONNECT_CLOSE_CODES.has(code)) {
      this.scheduleReconnect();
    }
  }

  /**
   * Liveness loss — either the heartbeat-ack path (AC6) OR the SPEC-CRWDQ-S41
   * inbound-frame watchdog. The socket is (or has gone) dead; force a clean
   * close and reconnect. Routes through {@link handleConnectionFailure} with a
   * synthetic 1006 so a single recovery runs (the `failureHandled` guard
   * dedupes against the browser's own close that may follow our `close()`), the
   * `close` lifecycle event fires (arming the SafeStateController fallback), and
   * a reconnect is unconditionally scheduled. This is the established-then-
   * dropped self-heal: it MUST recover regardless of any close code.
   */
  private onLivenessLost(): void {
    this.heartbeat.stop();
    this.cancelLivenessWatchdog();
    // Close the (possibly half-open) socket so the browser releases it; the
    // synthetic-1006 failure path below owns the reconnect, not the resulting
    // close event (which is deduped).
    this.socket?.close(CLEAN_CLOSE, 'ws_liveness_lost');
    this.handleConnectionFailure(1006);
  }

  // --- reconnect (AC7) -------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer !== null) {
      return;
    }
    this.reconnectAttempt += 1;
    const delayMs = this.backoffDelay(this.reconnectAttempt);
    this.emit('reconnect', { attempt: this.reconnectAttempt, delayMs });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delayMs);
  }

  /**
   * Exponential backoff with full jitter bounded by initialDelayMs..maxDelayMs:
   * the window cap is `min(maxDelay, initialDelay * 2^(attempt-1))`; the
   * chosen delay is `random() * cap` for `jitter: 'full'`, else the cap.
   */
  private backoffDelay(attempt: number): number {
    const { initialDelayMs, maxDelayMs, jitter } = this.config.reconnect;
    const cap = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
    return jitter === 'full' ? Math.round(this.deps.random() * cap) : cap;
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- inbound-frame liveness watchdog (SPEC-CRWDQ-S41) ----------------------

  /**
   * (Re)arm the inbound-frame watchdog. A no-op when `livenessTimeoutMs` is not
   * configured (watchdog disabled) or the connection is intentionally closing.
   * Each inbound frame resets the deadline; expiry means the socket has gone
   * silent and is treated as dead via {@link onLivenessLost}.
   */
  private armLivenessWatchdog(): void {
    const timeoutMs = this.config.livenessTimeoutMs;
    if (timeoutMs === undefined || timeoutMs <= 0 || this.intentionalClose) return;
    this.cancelLivenessWatchdog();
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null;
      // Guard: a teardown or already-handled failure between arm and fire must
      // not double-recover.
      if (this.intentionalClose || this.failureHandled) return;
      this.onLivenessLost();
    }, timeoutMs);
  }

  private cancelLivenessWatchdog(): void {
    if (this.livenessTimer !== null) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  // --- listener plumbing -----------------------------------------------------

  private bind(ws: WebSocketLike, type: string, handler: (ev: unknown) => void): void {
    ws.addEventListener(type, handler);
    this.boundListeners.push([type, handler]);
  }

  private teardownSocket(): void {
    if (this.socket) {
      for (const [type, handler] of this.boundListeners) {
        this.socket.removeEventListener(type, handler);
      }
    }
    this.boundListeners = [];
    this.socket = null;
  }

  private emit(event: LifecycleEvent, info: LifecycleInfo): void {
    for (const l of this.listeners[event]) {
      l(info);
    }
  }
}
