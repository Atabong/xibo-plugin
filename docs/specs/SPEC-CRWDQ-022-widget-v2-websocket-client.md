---
spec_id: SPEC-CRWDQ-022
title: Widget v2 WebSocket client + wire-protocol deserializer
status: draft
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
| Decisions referenced | D-GRH-12, D-GRH-25, D-GRH-29, D-GRH-42, D-GRH-43, D-GRH-48, D-GRH-49, D-GRH-59, D-GRH-61, D-GRH-63, D-GRH-65 |
| Source files | `modules/crowdaq-widget.xml` (legacy v1 SSE — unchanged) |
| New files | `modules/widget-v2/src/transport/WsClient.ts`, `modules/widget-v2/src/transport/Deserializer.ts`, `modules/widget-v2/src/transport/Dispatcher.ts`, `modules/widget-v2/src/transport/Heartbeat.ts`, `modules/widget-v2/src/transport/types.ts`, `modules/widget-v2/src/transport/GameStateRequest.ts`, `modules/widget-v2/tests/transport/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: transport` — the single physical WebSocket session per display, the JSONL line-framed deserializer, the per-`message_type` dispatcher into per-channel handler tables (`ConfigPush` → SPEC-CRWDQ-014; `PlannedState` / `GameState` / etc. → SPEC-CRWDQ-023 and onward), the 30s bidirectional heartbeat, and the seq-gap `GameStateRequest` recovery path (D-GRH-63).

## Current shape

- The widget v1 stencil opens an SSE `EventSource` against `<apiBaseUrl>/events/<eventId>/stream`. Five SSE event names are dispatched inline in `<onRender>`: `score-update`, `moment`, `status`, `heartbeat`, `error`. The connection is per-event, not per-display.
- There is no notion of a control channel, a planned-state stream, an asset manifest, a game-data multiplex, or a heartbeat-with-seq. There is no shared protocol with `crowdaq-backend` services beyond the SSE shape documented in `docs/current/contract/openapi.yaml`.
- Reconnect on v1 is whatever `EventSource` does by default (browser-controlled backoff, no application-layer state).
- The v1 stencil consumes `apiBaseUrl` and `eventId` from Xibo widget properties at layout-publish time; per-bar resolution uses `xiboIC.info()` (`display:displayName`).

Widget v2 (per D-GRH-42 + D-GRH-48) replaces this entirely with one persistent WS connection per display to `GameDeliveryService`, JSONL framing, and the closed set of message types from D-GRH-25.

## Proposed deep interface

```ts
// modules/widget-v2/src/transport/WsClient.ts
export interface WsClient {
  /** Open the WebSocket and send DeviceRegistration. Resolves on first frame received. */
  connect(): Promise<void>;
  /** Send a player-to-server frame (DeviceRegistration, GameStateRequest, Heartbeat). */
  send(frame: PlayerToServerFrame): void;
  /** Close cleanly with `ws_close_clean`; no auto-reconnect. */
  close(): Promise<void>;
  /** Connection lifecycle observers. */
  on(event: 'open' | 'close' | 'error' | 'reconnect', listener: (info: LifecycleInfo) => void): void;
}

export interface WsClientConfig {
  url: string;                    // tailnet-resolved GameDeliveryService URL
  displayId: string;              // from xiboIC.info()
  playerVersion: string;          // baked at build time
  heartbeatIntervalMs: number;    // default 30000 (D-GRH-59)
  ackTimeoutMs: number;           // default 60000 (no HeartbeatAck within 2x → reconnect, D-GRH-59)
  reconnect: ReconnectPolicy;     // see below
}

export interface ReconnectPolicy {
  /** Exponential backoff with full jitter. */
  initialDelayMs: number;         // default 1000
  maxDelayMs: number;             // default 30000
  jitter: 'full' | 'none';        // default 'full'
}
```

```ts
// modules/widget-v2/src/transport/Deserializer.ts
export interface Deserializer {
  /**
   * Parse one JSONL line. Returns a typed envelope or a parse-error
   * marker. Never throws — bad frames are journaled and dropped per
   * D-GRH-29 (`schema_violation_received`).
   */
  parse(line: string): ServerFrame | { kind: 'parse_error'; raw: string; reason: ParseErrorReason };
}

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
```

```ts
// modules/widget-v2/src/transport/Dispatcher.ts
export type LogicalChannel = 'control' | 'game_data';

export interface Dispatcher {
  /** Register a per-message-type handler. One handler per type — second registration throws. */
  register<T extends ServerFrame>(messageType: T['message_type'], handler: FrameHandler<T>, channel: LogicalChannel): void;
  /** Route a parsed frame. Records seq gaps on the game-data channel and triggers GameStateRequest. */
  dispatch(frame: ServerFrame): void;
}

export type FrameHandler<F extends ServerFrame> = (frame: F) => void | Promise<void>;
```

```ts
// modules/widget-v2/src/transport/Heartbeat.ts
export interface Heartbeat {
  start(): void;   // begin 30s outbound cadence
  stop(): void;
  onAck(seq: number): void;
  /** Returns the seq of the last unacked outbound heartbeat, or null. */
  outstanding(): number | null;
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
  requestForGap(gameId: string, sinceSeq: number): void;
}
```

### Behavior contract

1. **Boot.** `WsClient.connect()` opens the WS against `config.url`. The URL is resolved at boot by reading `xiboIC.info()` for the tailnet base — same multi-bar pattern as v1. On `open`, the client sends `DeviceRegistration` per D-GRH-61:
   ```json
   { "message_type": "DeviceRegistration", "display_id": "...", "player_version": "...", "capabilities": ["jsonl"] }
   ```
2. **Read.** Incoming bytes are line-split on `\n`; each line is fed to `Deserializer.parse(line)`. The server is required to emit one JSON object per line (D-GRH-42); the deserializer never accumulates across newlines.
3. **Validate envelope.** Each frame must carry `message_type` ∈ the closed enum from D-GRH-25 + D-GRH-42. Frames missing `message_type`, with unknown `message_type`, or failing per-type schema (presence of required fields per D-GRH-21/D-GRH-60/D-GRH-73 etc.) journal a `schema_violation_received` (extension of D-GRH-29 set) and are dropped.
4. **Dispatch.** Parsed frames go to the dispatcher. Control-channel frames (`ConfigPush`, `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `HeartbeatAck`, `SyncRequest`) route to their registered handler. Game-data-channel frames (`GameState`, `GameStateSnapshot`, `GameEvent`, `DisplayEvent`, `FixtureList`) route similarly; the dispatcher additionally tracks per-`game_id` seq.
5. **Re-push sequence on (re)connect.** Per D-GRH-49 + D-GRH-61 the server pushes, in order, `ConfigPush` → `ScheduleWindow` → `AssetManifest` → active `PlannedState`(s) → `GameState` snapshot(s). The dispatcher records this sequence as an event stream (no special-case "re-push parser"); the per-type handlers are responsible for being correct under the assumption that they receive the canonical first-frame in this order on every connect.
6. **Heartbeat.** Every `heartbeatIntervalMs` (default 30s) the client emits:
   ```json
   { "message_type": "Heartbeat", "display_id": "...", "seq": <monotonic> }
   ```
   The server replies with `HeartbeatAck { seq }`. If `Heartbeat.outstanding()` indicates a `seq` older than `ackTimeoutMs` ago has not been acked, the client closes the WS with `ws_close_clean` and triggers reconnect.
7. **Reconnect.** Backoff per `ReconnectPolicy`. Every reconnect re-emits `DeviceRegistration` (D-GRH-61 — single-message handshake for first connect and reconnects alike). The dispatcher's per-type handlers consume the full re-push sequence idempotently (each handler is responsible for hash/seq deduplication; SPEC-CRWDQ-014 already specifies this for `ConfigPush`).
8. **Seq-gap recovery.** Per D-GRH-63: the dispatcher records the highest seen `seq` per `game_id` (only for `game_id`s currently in the active `ProgramSlot`). When a `GameEvent` arrives with `seq > lastSeq + 1`, `GameStateRequester.requestForGap(gameId, lastSeq)` fires. The request payload is `{ "message_type": "GameStateRequest", "game_id": "...", "since_seq": <lastSeq> }`. Outstanding requests are coalesced per `game_id` (only one in flight). On `GameStateSnapshot` response, the per-game seq tracker resets to the snapshot's seq.
9. **Wire format.** Outbound frames are encoded as a single JSON object per line via `JSON.stringify(frame) + '\n'`. Binary frames are rejected (drop + journal).

### Logical channels

There is one physical WS. Routing into logical channels is purely a function of `message_type` per D-GRH-48:

| Logical channel | Frames |
|-----------------|--------|
| control | `ConfigPush`, `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `HeartbeatAck`, `SyncRequest` |
| game_data | `GameState`, `GameStateSnapshot`, `GameEvent`, `DisplayEvent`, `FixtureList` |
| player → server | `DeviceRegistration`, `GameStateRequest`, `Heartbeat` |

The `JournalSync` POST path is explicitly out of scope here — D-GRH-52 routes it via HTTP, owned by SPEC-CRWDQ-061.

### Generated types

`types.ts` is imported (or re-exported) from the shared `pkg/wire/` TS twin generated by SPEC-CRWDQ-017. The plugin owns no hand-authored Go-equivalent types — the TS twin is the contract. Drift between the Go module and the TS twin is a SPEC-CRWDQ-017 concern; this spec assumes it.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| WebSocket browser API | 3 remote-owned | `FakeWebSocket` adapter implementing the `addEventListener`/`send`/`close` surface; injected via `WsClientConfig`. No real network. |
| Server frames | 3 remote-owned | Test driver pushes JSON strings into `FakeWebSocket.message`. Fixtures stored under `tests/fixtures/wire/*.jsonl` mirroring real GameDeliveryService output. |
| Deserializer schema check | 1 in-process | Real call; fixtures cover happy + 6 schema-violation cases. |
| Per-type handlers | 2 local-substitutable | `RecordingHandler` for each registered type; assert ordered receipt. No mocks of dispatcher internals. |
| Clock (heartbeat cadence, ack timeout) | system boundary | Vitest fake timers per INV-FACTORY-17. |
| LocalStorage / journal | 2 local-substitutable | In-memory journal sink; assert event types and payload shape. |
| `Date.now`, `performance.now` | system boundary | Fake clock injected. |

Test cases:

- Open + DeviceRegistration sent as first outbound frame; `player_version` and `capabilities: ["jsonl"]` present.
- Full re-push fixture (`fixtures/wire/re-push-happy.jsonl`): handlers fire in order `ConfigPush → ScheduleWindow → AssetManifest → PlannedState → GameState`; no out-of-order delivery to handlers.
- Parse-error frame: handler not invoked, journal records `schema_violation_received` with `raw` snippet and `reason`.
- Unknown `message_type`: journaled + dropped; no handler invocation.
- Heartbeat cadence: at t=30s exactly one `Heartbeat` outbound; at t=60s with no ack the client closes WS and emits `reconnect` lifecycle event.
- Heartbeat ack: ack with matching seq clears the outstanding marker; ack with stale seq is ignored (no crash).
- Reconnect: `FakeWebSocket` rejects open once, then succeeds; backoff delay observed; `DeviceRegistration` re-emitted exactly once per successful open.
- Seq-gap recovery: feed `GameEvent` seq 1, 2, 3, then 7 for game G in active `ProgramSlot` → exactly one `GameStateRequest { game_id: G, since_seq: 3 }` outbound. Second concurrent gap on same G during outstanding request → coalesced (no second outbound).
- Game-id not in active `ProgramSlot`: seq gap observed but no `GameStateRequest` issued (per D-GRH-63 "triggered only for games currently being rendered").
- Binary frame: dropped + journaled.
- Frame larger than 1 MB: dropped + journaled (defensive cap, prevents OOM on a runaway server).

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md` common vocabulary.

- `JSONL` — one JSON object per `\n`-terminated line (D-GRH-42).
- `seq` — monotonic per-source counter; per-`game_id` on `GameEvent`/`GameState`; per-connection on `Heartbeat`.
- `re-push sequence` — the server's authoritative ordered set of frames after `DeviceRegistration` (D-GRH-49 + D-GRH-61).
- `ack-timeout` — `2 × heartbeatIntervalMs`, reconnect trigger (D-GRH-59).

## Acceptance Criteria

- [ ] `modules/widget-v2/src/transport/WsClient.ts` exports `WsClient`, `WsClientConfig`, `ReconnectPolicy` matching the interface above; `connect()` resolves on the first server-pushed frame (per D-GRH-61 the `ConfigPush` arrival implicitly acknowledges registration).
- [ ] On every successful WS open (first connect and reconnect), the client emits exactly one `DeviceRegistration` frame as the first outbound message, with `display_id`, `player_version`, and `capabilities: ["jsonl"]`.
- [ ] `Deserializer.parse(line)` returns a typed envelope for every `message_type` in D-GRH-25 + D-GRH-42 (15 server-to-player types) and a `{kind: 'parse_error', reason}` for invalid JSON, missing `message_type`, unknown `message_type`, or per-type schema violation; never throws.
- [ ] `Dispatcher.register(messageType, handler, channel)` allows exactly one handler per `message_type`; a second registration throws. Handlers are invoked synchronously in receipt order per logical channel.
- [ ] The dispatcher tracks per-`game_id` `seq` only for `game_id`s in the active `ProgramSlot`; seq gaps trigger exactly one `GameStateRequest` per gap, coalesced per `game_id` while outstanding; `GameStateSnapshot` response resets the per-game seq baseline.
- [ ] `Heartbeat` emits at `heartbeatIntervalMs` cadence with monotonic `seq`; if `outstanding()` exceeds `ackTimeoutMs` the client closes the socket (`ws_close_clean`) and triggers reconnect via `ReconnectPolicy`.
- [ ] Reconnect uses exponential backoff with full jitter bounded by `initialDelayMs..maxDelayMs`; the `reconnect` lifecycle event fires before each attempt.
- [ ] All schema violations and unknown-type frames produce a `schema_violation_received` journal entry (extending D-GRH-29) and never reach a registered handler.
- [ ] Binary frames and frames > 1 MB are dropped + journaled; the client does not crash.
- [ ] All wire types are imported from the SPEC-CRWDQ-017 TS twin (no hand-rolled type duplicates in `transport/types.ts`).
- [ ] Test suite covers the cases enumerated under "Test cases" — fixtures live under `modules/widget-v2/tests/fixtures/wire/*.jsonl`; no mocking of `Deserializer`, `Dispatcher`, or `Heartbeat` internals (INV-FACTORY-16).
- [ ] Heartbeat, deserializer, and dispatcher are real instances under test; only `WebSocket`, clock, and journal sink are substituted (INV-FACTORY-17).
