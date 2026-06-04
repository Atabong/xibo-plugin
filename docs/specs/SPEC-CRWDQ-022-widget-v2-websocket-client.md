---
spec_id: SPEC-CRWDQ-022
title: Widget v2 WebSocket client + wire-protocol deserializer
status: impl-ready
owner: player-runtime/widget-v2/transport
depends_on: [SPEC-CRWDQ-017]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-022 — Widget v2 WebSocket client + wire-protocol deserializer

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S3 — Single-game render (no admin path) |
| Plane epic | CRWDQ-4 |
| Decisions referenced | D-GRH-12, D-GRH-42, D-GRH-43, D-GRH-48, D-GRH-49, D-GRH-59, D-GRH-60, D-GRH-61, D-GRH-63, D-GRH-65 |
| Source files | `modules/crowdaq-widget.xml` (legacy v1 SSE — unchanged) |
| New files | `modules/widget-v2/src/transport/WsClient.ts`, `modules/widget-v2/src/transport/Deserializer.ts`, `modules/widget-v2/src/transport/Dispatcher.ts`, `modules/widget-v2/src/transport/Heartbeat.ts`, `modules/widget-v2/src/transport/types.ts`, `modules/widget-v2/src/transport/GameStateRequest.ts`, `modules/widget-v2/tests/transport/*.test.ts` |

> **Backend authority note:** Every wire-contract claim in this spec is
> cross-checked against the authoritative backend specs
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-017` (wire-protocol envelope +
> JSONL serializer) and `SPEC-CRWDQ-020` (GameDeliveryService WS server).
> Where the original player-side draft diverged from those contracts, the
> player spec has been corrected to match the backend. The backend is the
> source of truth: do not re-derive frame shapes here.

## Module

`player-runtime :: widget-v2 :: transport` — the single physical WebSocket session per display, the JSONL line-framed deserializer, the per-`message_type` dispatcher into per-channel handler tables (`ConfigPush` → SPEC-CRWDQ-014; `PlannedState` / `GameState` / etc. → SPEC-CRWDQ-023 and onward), the 30s outbound heartbeat with `HeartbeatAck` liveness tracking, and the seq-gap `GameStateRequest` recovery path (D-GRH-63).

## Current shape

- The widget v1 stencil opens an SSE `EventSource` against `<apiBaseUrl>/events/<eventId>/stream`. Five SSE event names are dispatched inline in `<onRender>`: `score-update`, `moment`, `status`, `heartbeat`, `error`. The connection is per-event, not per-display.
- There is no notion of a control channel, a planned-state stream, an asset manifest, a game-data multiplex, or a heartbeat-with-ack. There is no shared protocol with `crowdaq-backend` services beyond the SSE shape documented in `docs/current/contract/openapi.yaml`.
- Reconnect on v1 is whatever `EventSource` does by default (browser-controlled backoff, no application-layer state).
- The v1 stencil consumes `apiBaseUrl` and `eventId` from Xibo widget properties at layout-publish time; per-bar resolution uses `xiboIC.info()` (`display:displayName`).

Widget v2 (per D-GRH-42 + D-GRH-48) replaces this entirely with one persistent WS connection per display to `GameDeliveryService`, JSONL framing, and the closed set of message types from D-GRH-42.

## Proposed deep interface

### Frame envelope

All frames — inbound and outbound — are `Envelope` objects per SPEC-CRWDQ-017: every frame carries `schema_version`, `channel`, `message_type`, `ts`, an optional `seq` (only on `GameEvent` / `GameStateRequest`), an optional `bar_id` / `game_id`, and a typed `payload`. The plugin never constructs flat frames — outbound frames are built with the SPEC-CRWDQ-017 `buildEnvelope` helper and serialized with `serialize`. The deserializer wraps the SPEC-CRWDQ-017 `parseLine`.

```ts
// modules/widget-v2/src/transport/WsClient.ts
export interface WsClient {
  /** Open the WebSocket and send DeviceRegistration. Resolves on the
   *  first server-pushed frame (the ConfigPush re-push frame). */
  connect(): Promise<void>;
  /** Send a player-to-server envelope (DeviceRegistration, GameStateRequest, Heartbeat). */
  send(frame: PlayerToServerFrame): void;
  /** Close cleanly with WS close code 1000 ("normal closure"); no auto-reconnect. */
  close(): Promise<void>;
  /** Connection lifecycle observers. */
  on(event: 'open' | 'close' | 'error' | 'reconnect', listener: (info: LifecycleInfo) => void): void;
}

export interface WsClientConfig {
  url: string;                    // tailnet-resolved GameDeliveryService URL, path /ws
  subprotocol: string;            // MUST be "crowdaq.v1" — required by SPEC-CRWDQ-020
  barId: string;                  // UUID from xiboIC.info() / config (DeviceRegistration.bar_id)
  displayId: string;              // UUID from xiboIC.info()
  playerSwVersion: string;        // baked at build time (DeviceRegistration.player_sw_version)
  heartbeatIntervalMs: number;    // default 30000 (D-GRH-59)
  ackTimeoutMs: number;           // default 60000 — 2 × heartbeatIntervalMs; player-side
                                  //   liveness trigger. Distinct from the server's own
                                  //   90s heartbeat-timeout (SPEC-CRWDQ-020 / D-GRH-59).
  reconnect: ReconnectPolicy;     // see below
}

export interface ReconnectPolicy {
  /** Exponential backoff with full jitter. */
  initialDelayMs: number;         // default 1000
  maxDelayMs: number;             // default 30000
  jitter: 'full' | 'none';        // default 'full'
}

/** Lifecycle event payload passed to WsClient.on listeners. */
export interface LifecycleInfo {
  event: 'open' | 'close' | 'error' | 'reconnect';
  /** WS close code, present on 'close'. Server-initiated codes are the
   *  SPEC-CRWDQ-020 set: 1001 server_shutdown, 4000 malformed_frame,
   *  4001 registration_timeout, 4002 heartbeat_timeout,
   *  4003 unexpected_message_type, 4004 unknown_bar,
   *  4006 replaced_by_newer. Player-initiated close uses 1000. */
  code?: number;
  /** WS close reason string, present on 'close'. */
  reason?: string;
  /** Reconnect attempt ordinal (1-based), present on 'reconnect'. */
  attempt?: number;
  /** Backoff delay applied before this attempt in ms, present on 'reconnect'. */
  delayMs?: number;
}
```

```ts
// modules/widget-v2/src/transport/Deserializer.ts
export interface Deserializer {
  /**
   * Parse one JSONL line. Returns a typed envelope or a parse-error
   * marker. Never throws — internally wraps the SPEC-CRWDQ-017
   * `parseLine` (which throws typed `WireError`s), catching every
   * `WireError` and converting it to a `parse_error` marker. The
   * JSONL/envelope parse is NOT reimplemented here. `parseLine` returning
   * `null` for an empty / whitespace-only line is surfaced as a
   * `{ kind: 'empty_line' }` marker that the caller drops silently
   * (no journal entry). Bad frames are journaled and dropped per D-GRH-29
   * (`schema_violation_received`).
   */
  parse(line: string):
    | ServerFrame
    | { kind: 'parse_error'; raw: string; reason: ParseErrorReason }
    | { kind: 'empty_line' };
}

/**
 * Parse-failure reason — the `code` of the SPEC-CRWDQ-017 `WireError`
 * the wrapped `parseLine` threw. These are exactly the seven `WireError`
 * `code` values defined in SPEC-CRWDQ-017 `src/wire/errors.ts`.
 */
export type ParseErrorReason =
  | 'malformed_frame'            // MalformedFrameError
  | 'unknown_channel'            // UnknownChannelError
  | 'unknown_message_type'       // UnknownMessageTypeError
  | 'unpinned_channel'           // UnpinnedChannelError
  | 'unsupported_schema_version' // UnsupportedSchemaVersionError
  | 'missing_seq'                // MissingSeqError
  | 'unexpected_seq';            // UnexpectedSeqError

/**
 * The server-to-player subset of the SPEC-CRWDQ-017 closed `MessageType`
 * enum. Of the 20 wire message types, four are player→server only
 * (`DeviceRegistration`, `Heartbeat`, `GameStateRequest`, `JournalSync`)
 * and never appear here. The remaining 16 are the frames a player can
 * receive.
 */
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
  | PlayerConnectedFrame
  | PlayerDisconnectedFrame
  | GameStateFrame
  | GameEventFrame
  | DisplayEventFrame
  | FixtureListFrame;
```

```ts
// modules/widget-v2/src/transport/Dispatcher.ts
export type LogicalChannel = 'control' | 'game_data';

export interface Dispatcher {
  /** Register a per-message-type handler. One handler per type — a second
   *  registration for the same message_type throws `DuplicateHandlerError`. */
  register<T extends ServerFrame>(messageType: T['message_type'], handler: FrameHandler<T>, channel: LogicalChannel): void;
  /** Route a parsed frame. Records seq gaps on the game-data channel and triggers GameStateRequest. */
  dispatch(frame: ServerFrame): void;
}

export type FrameHandler<F extends ServerFrame> = (frame: F) => void | Promise<void>;

/** Thrown by Dispatcher.register on a second registration for an
 *  already-registered message_type. Carries `{ messageType }`. */
export class DuplicateHandlerError extends Error {
  readonly messageType: string;
}
```

```ts
// modules/widget-v2/src/transport/Heartbeat.ts
export interface Heartbeat {
  start(): void;   // begin 30s outbound cadence
  stop(): void;
  /**
   * Called when any `HeartbeatAck` frame is received. `HeartbeatAck`
   * carries NO `seq` (SPEC-CRWDQ-017 `HeartbeatAckPayload` is
   * { server_ts, rtt_ms, config_hash_ok }), so acks are NOT correlated
   * to a specific outbound heartbeat. Receiving any ack clears the
   * outstanding-heartbeat marker — the contract is "the server is alive
   * and answering", not "this exact heartbeat was acked".
   */
  onAck(): void;
  /**
   * Returns the oldest unacked outbound heartbeat as { sentAt } (sentAt =
   * the clock time the heartbeat was sent), or null when an ack has been
   * received since the last heartbeat was sent. The caller compares
   * `now - sentAt` against `ackTimeoutMs` to decide the reconnect trigger.
   */
  outstanding(): { sentAt: number } | null;
}
```

```ts
// modules/widget-v2/src/transport/GameStateRequest.ts
export interface GameStateRequester {
  /**
   * Called by the game-data dispatcher whenever a per-game seq gap is
   * detected (D-GRH-63): expected N+1, observed M > N+1, for a game_id
   * currently in the active ProgramSlot. Coalesces concurrent requests
   * for the same game_id (one outstanding request per game).
   */
  requestForGap(gameId: string, fromSeq: number): void;
}
```

### Behavior contract

1. **Boot.** `WsClient.connect()` opens the WS against `config.url` (path `/ws`) **with the WebSocket subprotocol `crowdaq.v1`** — SPEC-CRWDQ-020 rejects any upgrade missing that subprotocol with HTTP `400` and no upgrade. The URL is resolved at boot by reading `xiboIC.info()` for the tailnet base — same multi-bar pattern as v1. On the WS `open` event, the client immediately sends a `DeviceRegistration` envelope per D-GRH-61. The payload shape is the SPEC-CRWDQ-017 `DeviceRegistrationPayload`:
   ```json
   {
     "schema_version": 1,
     "channel": "control",
     "message_type": "DeviceRegistration",
     "ts": "<RFC 3339 UTC>",
     "payload": {
       "bar_id": "<UUID>",
       "display_id": "<UUID>",
       "player_sw_version": "<build version>",
       "last_seq": null,
       "last_config_hash": null
     }
   }
   ```
   `last_seq` and `last_config_hash` are `null` on a first connect; on a reconnect they MAY carry the last seen values to assist server-side resume (the server treats both as advisory — the re-push is unconditional per D-GRH-49).
2. **Read.** Incoming WS text messages are line-split on `\n`; each line is fed to `Deserializer.parse(line)`. The server emits one JSON object per WS text message (D-GRH-42); the deserializer never accumulates across newlines. A binary WS message is dropped + journaled (the server itself closes `4000 malformed_frame` for binary, but the client also defends).
3. **Validate envelope.** `Deserializer.parse` delegates to the SPEC-CRWDQ-017 `parseLine`, which enforces the full envelope contract: `schema_version === 1`, `channel` ∈ `CHANNELS`, `message_type` ∈ the 20-value closed enum, `(channel, message_type)` matches `canonicalChannel`, and the seq-bearing rule (`seq` required on `GameEvent` / `GameStateRequest`, absent on all others). Any violation throws a typed `WireError`; the deserializer catches it and returns a `parse_error` marker carrying the `WireError.code` as `reason`. The client journals a `schema_violation_received` entry (extension of the D-GRH-29 set) and drops the frame.
4. **Dispatch.** Parsed frames go to the dispatcher. Control-channel frames (`ConfigPush`, `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `HeartbeatAck`, `SyncRequest`, `PlayerConnected`, `PlayerDisconnected`) route to their registered handler. Game-data-channel frames (`GameState`, `GameEvent`, `DisplayEvent`, `FixtureList`) route similarly; the dispatcher additionally tracks per-`game_id` seq for `GameEvent`.
5. **Re-push sequence on (re)connect.** Per D-GRH-49 + D-GRH-61, after `DeviceRegistration` the server pushes, in this exact order: `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState`(s) (ordered by `schedule_slot_index` ascending) → `ProgramSlot`(s) → `GameState` snapshot(s) (one per distinct `game_id`). The dispatcher records this sequence as an ordinary event stream (no special-case "re-push parser"); the per-type handlers are responsible for being correct under the assumption that they receive the canonical first-frame in this order on every connect.
6. **Heartbeat.** Every `heartbeatIntervalMs` (default 30s) the client emits a `Heartbeat` envelope. The payload is the SPEC-CRWDQ-017 `HeartbeatPayload` — `Heartbeat` is NOT a seq-bearing message, so the envelope carries no `seq`:
   ```json
   {
     "schema_version": 1,
     "channel": "control",
     "message_type": "Heartbeat",
     "ts": "<RFC 3339 UTC>",
     "payload": {
       "player_local_ts": "<RFC 3339 UTC>",
       "config_hash": "<current player config_hash>"
     }
   }
   ```
   The server replies with a `HeartbeatAck` whose payload is `{ server_ts, rtt_ms, config_hash_ok }` (SPEC-CRWDQ-017 `HeartbeatAckPayload`) — also no `seq`. On receipt the client calls `Heartbeat.onAck()`, clearing the outstanding marker. If `HeartbeatAck.config_hash_ok === false`, the server will send a fresh `ConfigPush` immediately after the ack (SPEC-CRWDQ-020); the client takes no special action — the registered `ConfigPush` handler (SPEC-CRWDQ-014) processes it normally. If `Heartbeat.outstanding()` reports an unacked heartbeat sent more than `ackTimeoutMs` ago, the client closes the WS with code `1000` ("normal closure") and triggers reconnect.
7. **Reconnect.** Backoff per `ReconnectPolicy` (exponential, full jitter, bounded `initialDelayMs..maxDelayMs`). The `reconnect` lifecycle event fires before each attempt, carrying the attempt ordinal and the backoff delay. A reconnect is triggered by: a transport `error`, a server-initiated WS close with any of the SPEC-CRWDQ-020 codes (`1001`, `4000`, `4001`, `4002`, `4003`, `4004`, `4006`), or the player's own `ackTimeoutMs` liveness close. A close initiated by `WsClient.close()` (code `1000`, no pending reconnect) does NOT reconnect. Every reconnect re-emits `DeviceRegistration` (D-GRH-61 — single-message handshake for first connect and reconnects alike). The dispatcher's per-type handlers consume the full re-push sequence idempotently (each handler is responsible for hash/seq deduplication; SPEC-CRWDQ-014 already specifies this for `ConfigPush`).
   > **OPEN QUESTION:** SPEC-CRWDQ-020 close code `4004 "unknown_bar"` indicates the `bar_id` in `DeviceRegistration` has no `BarPreferences` row. Reconnecting with the same `bar_id` will loop on `4004`. The backend spec does not define a player-side back-off ceiling for an unrecoverable registration rejection. Recommend: on three consecutive `4004` closes the player surfaces a terminal error state and stops reconnecting until the layout is republished. Confirm with backend owner before implementation.
8. **Seq-gap recovery.** Per D-GRH-63: the dispatcher records the highest seen `seq` per `game_id` (only for `game_id`s currently in the active `ProgramSlot`). When a `GameEvent` arrives with `seq > lastSeq + 1`, `GameStateRequester.requestForGap(gameId, lastSeq)` fires. The request is a `GameStateRequest` envelope; `GameStateRequest` IS a seq-bearing message, so the envelope carries its own request-ordinal `seq` (SPEC-CRWDQ-017), and the payload is the `GameStateRequestPayload` `{ game_id, from_seq }`:
   ```json
   {
     "schema_version": 1,
     "channel": "game_data",
     "message_type": "GameStateRequest",
     "ts": "<RFC 3339 UTC>",
     "seq": "<request ordinal, monotonic>",
     "game_id": "<game_id>",
     "payload": { "game_id": "<game_id>", "from_seq": "<lastSeq>" }
   }
   ```
   Outstanding requests are coalesced per `game_id` (only one in flight). A `GameState` frame is itself a full snapshot and a recovery point: `GameState` carries no `seq` (SPEC-CRWDQ-017 — `seq` is absent on snapshot messages). On receipt, the per-game gap detector for that `game_id` resets, and the next `GameEvent` seq becomes the new baseline.
   > **Note on the S3 backend behavior:** SPEC-CRWDQ-020 states that in slice S3 the `GameStateRequest` handler does NOT replay seq gaps — it answers any `GameStateRequest` (even `from_seq > 0`) with the current `GameState` sentinel snapshot. NATS-backed gap replay arrives in SPEC-CRWDQ-021. The player's recovery path is therefore correct as written: it requests, receives a snapshot, and re-baselines. The player does not assume the server replayed the missing events.
9. **Wire format.** Outbound frames are built via the SPEC-CRWDQ-017 `buildEnvelope` and encoded with `serialize` (a single JSON object terminated by exactly one `\n`). Binary frames are never produced; an inbound binary WS message is dropped + journaled.

### Logical channels

There is one physical WS. Routing into logical channels is purely a function of `message_type` per D-GRH-48 and the SPEC-CRWDQ-017 `canonicalChannel` pinning table:

| Logical channel | Server→player frames |
|-----------------|----------------------|
| control | `ConfigPush`, `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `HeartbeatAck`, `SyncRequest`, `PlayerConnected`, `PlayerDisconnected` |
| game_data | `GameState`, `GameEvent`, `DisplayEvent`, `FixtureList` |
| player → server | `DeviceRegistration` (control), `Heartbeat` (control), `GameStateRequest` (game_data) |

`canonicalChannel` (SPEC-CRWDQ-017) is authoritative: `GameState`, `GameEvent`, `DisplayEvent`, `GameStateRequest`, `FixtureList` → `game_data`; all other 15 → `control`. The deserializer never needs its own pinning table — `parseLine` already rejects a mispinned `(channel, message_type)` pair with `UnpinnedChannelError`.

The `JournalSync` POST path is explicitly out of scope here — D-GRH-52 routes it via HTTP, owned by SPEC-CRWDQ-061.

### Generated types

`types.ts` is imported (or re-exported) from the SPEC-CRWDQ-017 wire-protocol module barrel `src/wire/index.ts`. Per the SPEC-CRWDQ-017 stack note, `crowdaq-backend` is TypeScript — there is no Go→TS codegen step; the player runtime consumes the *same source types* from the published module path. The plugin owns no hand-authored wire types. Drift between the wire module and any consumer is a SPEC-CRWDQ-017 concern; this spec assumes it.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| WebSocket browser API | 3 remote-owned | `FakeWebSocket` adapter implementing the `addEventListener`/`send`/`close` surface and the subprotocol-negotiation field; injected via `WsClientConfig`. No real network. |
| Server frames | 3 remote-owned | Test driver pushes JSON strings into `FakeWebSocket.message`. Fixtures stored under `tests/fixtures/wire/*.jsonl` mirroring real GameDeliveryService output (full enveloped frames). |
| SPEC-CRWDQ-017 `parseLine` / `buildEnvelope` / `serialize` | 1 in-process | Real call — the deserializer wraps the real `parseLine`; outbound frames are built with the real `buildEnvelope`. No mock of the wire module. |
| Per-type handlers | 2 local-substitutable | `RecordingHandler` for each registered type; assert ordered receipt. No mocks of dispatcher internals. |
| Clock (heartbeat cadence, ack timeout, backoff) | system boundary | Vitest fake timers per INV-FACTORY-17. |
| LocalStorage / journal | 2 local-substitutable | In-memory journal sink; assert event types and payload shape. |
| `Date.now`, `performance.now` | system boundary | Fake clock injected. |

Test cases:

- Open + subprotocol: `FakeWebSocket` records the requested subprotocol; assert it is exactly `crowdaq.v1`.
- Open + `DeviceRegistration` sent as first outbound frame; assert the payload is a valid `DeviceRegistrationPayload` with `bar_id`, `display_id`, `player_sw_version` set and `last_seq` / `last_config_hash` both `null` on first connect.
- Full re-push fixture (`fixtures/wire/re-push-happy.jsonl`): handlers fire in order `ConfigPush → ScheduleWindow → AssetManifest → PlannedState → ProgramSlot → GameState`; PlannedStates arrive ordered by `schedule_slot_index` ascending; no out-of-order delivery to handlers.
- Parse-error frame: handler not invoked, journal records `schema_violation_received` with `raw` snippet and `reason` ∈ the seven `WireError` codes.
- Unknown `message_type`: `parseLine` throws `UnknownMessageTypeError`; deserializer returns `parse_error` with `reason: 'unknown_message_type'`; frame journaled + dropped; no handler invocation.
- Mispinned frame (e.g. `GameState` on `channel: control`): `parseLine` throws `UnpinnedChannelError`; journaled + dropped.
- Seq-rule violation: a `GameEvent` with no `seq` → `reason: 'missing_seq'`; a `Heartbeat`-shaped inbound frame carrying `seq` → `reason: 'unexpected_seq'`; both journaled + dropped.
- Empty / whitespace-only line: deserializer returns `{ kind: 'empty_line' }`; no journal entry, no handler invocation.
- Heartbeat cadence: at t=30s exactly one `Heartbeat` outbound, payload carrying `player_local_ts` and `config_hash`, no `seq` field present; at t=60s (= `ackTimeoutMs`) with no `HeartbeatAck` received the client closes the WS with code `1000` and emits a `reconnect` lifecycle event.
- Heartbeat ack: a `HeartbeatAck` (any contents) received clears the outstanding marker via `Heartbeat.onAck()`; a second `HeartbeatAck` arriving with no outstanding heartbeat is a no-op (no crash).
- HeartbeatAck `config_hash_ok: false`: the following `ConfigPush` frame is delivered to the registered `ConfigPush` handler; the transport takes no special action.
- Reconnect on transport error: `FakeWebSocket` rejects open once, then succeeds; backoff delay observed within `initialDelayMs..maxDelayMs`; `DeviceRegistration` re-emitted exactly once per successful open; `reconnect` event carries `attempt` and `delayMs`.
- Reconnect on server close: `FakeWebSocket` close with code `4002 heartbeat_timeout` triggers a reconnect; close with code `1000` from `WsClient.close()` does NOT.
- Seq-gap recovery: feed `GameEvent` seq 1, 2, 3, then 7 for game G in active `ProgramSlot` → exactly one `GameStateRequest` outbound, payload `{ game_id: G, from_seq: 3 }`, envelope carrying its own `seq` and `channel: game_data`. Second concurrent gap on same G during outstanding request → coalesced (no second outbound).
- After a `GameState` snapshot for game G, the gap detector resets: a following `GameEvent` at any seq re-baselines without emitting a `GameStateRequest`.
- Game-id not in active `ProgramSlot`: seq gap observed but no `GameStateRequest` issued (per D-GRH-63 "triggered only for games currently being rendered").
- Duplicate handler registration: `Dispatcher.register` for an already-registered `message_type` throws `DuplicateHandlerError` carrying `messageType`.
- Binary frame: dropped + journaled; client does not crash.
- Frame larger than 1 MB: dropped + journaled (defensive cap, prevents OOM on a runaway server).

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md` common vocabulary.

- `JSONL` — one JSON object per `\n`-terminated line (D-GRH-42).
- `Envelope` — the SPEC-CRWDQ-017 frame wrapper: `schema_version`, `channel`, `message_type`, `ts`, `seq?`, `bar_id?`, `game_id?`, `payload`.
- `seq` — monotonic per-source counter; present only on `GameEvent` (per `(bar_id, game_id)`) and `GameStateRequest` (request ordinal). Absent on `Heartbeat`, `HeartbeatAck`, `GameState`, and every other type.
- `re-push sequence` — the server's authoritative ordered set of frames after `DeviceRegistration`: `ConfigPush → ScheduleWindow → AssetManifest → PlannedState(s) → ProgramSlot(s) → GameState(s)` (D-GRH-49 + D-GRH-61, exactly as SPEC-CRWDQ-020 emits it).
- `ack-timeout` — `2 × heartbeatIntervalMs` (default 60s); the player-side liveness-loss reconnect trigger. Distinct from the server's own 90s heartbeat timeout (SPEC-CRWDQ-020 / D-GRH-59) — the two mechanisms are independent.
- `subprotocol` — the WS `Sec-WebSocket-Protocol` value `crowdaq.v1`, mandatory on every connect (SPEC-CRWDQ-020).

## Acceptance Criteria

- [ ] `modules/widget-v2/src/transport/WsClient.ts` exports `WsClient`, `WsClientConfig`, `ReconnectPolicy`, and `LifecycleInfo` matching the interface above; `connect()` opens the WS with subprotocol `crowdaq.v1` and resolves on the first server-pushed frame (per D-GRH-61 the `ConfigPush` arrival implicitly acknowledges registration).
- [ ] On every successful WS open (first connect and reconnect), the client emits exactly one `DeviceRegistration` envelope as the first outbound message; its payload is a valid SPEC-CRWDQ-017 `DeviceRegistrationPayload` with `bar_id`, `display_id`, `player_sw_version`, `last_seq`, and `last_config_hash`.
- [ ] `Deserializer.parse(line)` returns a typed `ServerFrame` for every server-to-player `message_type` (the 16 in the `ServerFrame` union), a `{kind: 'empty_line'}` marker for an empty/whitespace-only line, and a `{kind: 'parse_error', reason}` marker (where `reason` is one of the seven SPEC-CRWDQ-017 `WireError` codes) for any malformation; it never throws — it wraps the SPEC-CRWDQ-017 `parseLine` and catches every `WireError`.
- [ ] `Dispatcher.register(messageType, handler, channel)` allows exactly one handler per `message_type`; a second registration throws `DuplicateHandlerError`. Handlers are invoked synchronously in receipt order per logical channel.
- [ ] The dispatcher tracks per-`game_id` `seq` only for `game_id`s in the active `ProgramSlot`; seq gaps trigger exactly one `GameStateRequest` per gap, coalesced per `game_id` while outstanding; a `GameState` snapshot frame resets the per-game gap detector (the next `GameEvent` re-baselines the seq).
- [ ] `Heartbeat` emits a no-`seq` `Heartbeat` envelope at `heartbeatIntervalMs` cadence with a `HeartbeatPayload` (`player_local_ts`, `config_hash`); `Heartbeat.onAck()` (called on any `HeartbeatAck`) clears the outstanding marker; if `outstanding()` exceeds `ackTimeoutMs` the client closes the socket (WS code `1000`) and triggers reconnect via `ReconnectPolicy`.
- [ ] Reconnect uses exponential backoff with full jitter bounded by `initialDelayMs..maxDelayMs`; the `reconnect` lifecycle event fires before each attempt carrying `attempt` and `delayMs`. Reconnect is triggered by a transport error, a server-initiated close with any SPEC-CRWDQ-020 code (`1001`, `4000`–`4004`, `4006`), or the player's `ackTimeoutMs` liveness close; it is NOT triggered by a `WsClient.close()` (code `1000`) call.
- [ ] All schema violations and unknown-type frames produce a `schema_violation_received` journal entry (extending D-GRH-29) and never reach a registered handler.
- [ ] Binary frames and frames > 1 MB are dropped + journaled; the client does not crash.
- [ ] All wire types and the `parseLine` / `buildEnvelope` / `serialize` helpers are imported from the SPEC-CRWDQ-017 wire-protocol module barrel (no hand-rolled type or parser duplicates in `transport/types.ts` or `transport/Deserializer.ts`).
- [ ] Test suite covers the cases enumerated under "Test cases" — fixtures live under `modules/widget-v2/tests/fixtures/wire/*.jsonl` and contain full envelopes; no mocking of `Deserializer`, `Dispatcher`, `Heartbeat`, or the SPEC-CRWDQ-017 wire module (INV-FACTORY-16).
- [ ] Heartbeat, deserializer, dispatcher, and the SPEC-CRWDQ-017 wire module are real instances under test; only `WebSocket`, clock, and journal sink are substituted (INV-FACTORY-17).
