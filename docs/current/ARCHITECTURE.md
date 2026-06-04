# CROWDAQ Xibo Plugin — Architecture (widget-v2)

_Status: widget-v2 scaffold. The wire-protocol barrel + the Node toolchain
are built and CI-gated; the transport, ConfigPush consumer, and render
templates are spec'd but not yet built (see § Implementation status)._

> **Two widget generations ship side-by-side.** This document describes
> **widget-v2** (`modules/widget-v2/`), a TypeScript bundle speaking a
> **WebSocket + JSONL wire protocol**. The legacy **v1** widget
> (`modules/crowdaq-widget.xml`, **SSE**) is unchanged and still ships; its
> docs are archived under [`docs/archive/v1/`](archive/v1/README.md). The
> v1→v2 cutover is operator-driven via the Xibo layout authoring surface.

> **Source of truth for the wire surface:**
> [`modules/widget-v2/src/wire.ts`](../modules/widget-v2/src/wire.ts), a
> vendored faithful copy of **SPEC-CRWDQ-017**. The detailed reference is
> [`docs/WIRE_PROTOCOL.md`](WIRE_PROTOCOL.md); the planned-surface specs are
> catalogued in [`docs/specs/index.md`](specs/index.md). Anywhere this prose
> contradicts `wire.ts` or a SPEC-CRWDQ-NNN spec, the code/spec wins.

---

## High-level data flow

A single persistent WebSocket per display carries a JSONL stream of typed
envelopes from the CROWDAQ backend's GameDeliveryService to the widget-v2
bundle running in the Xibo Player's Chromium runtime.

```
+----------------------+   WebSocket    +------------------------+
|  crowdaq-backend     |   (one per     |  Xibo Player (bar PC)  |
|  GameDeliveryService |    display,    |  Chromium runtime      |
|  (Temporal + NATS +  |    JSONL text  |  +------------------+  |
|   AdminGateway)      |    frames,     |  | widget-v2 bundle |  |
|                      |    bidirec-    |  | (@crowdaq/       |  |
|  buildEnvelope() --> |    tional)     |  |  widget-v2)      |  |
|  serialize() -------)| =============> |  |  parseLine() --> |  |
|                      | <============= |  |  Dispatcher ---> |  |
|                      |  Heartbeat /   |  |  render templates|  |
|                      |  GameStateReq /|  +------------------+  |
|                      |  DeviceReg /   |  +----------+---------+ |
|                      |  JournalSync   |             |           |
+----------------------+                +-------------|-----------+
                                                      v
                                            +--------------------+
                                            |  Bar TV / display  |
                                            +--------------------+
```

Direction split (per SPEC-CRWDQ-022): of the 20 message types, four are
**player→server** (`DeviceRegistration`, `Heartbeat`, `GameStateRequest`,
`JournalSync`); the player can *receive* the remaining 16. The widget-v2
bundle is delivered to the player as part of the layout HTML exactly as a
custom Xibo widget; the CMS itself is not on the WebSocket path.

---

## The envelope

Every frame is an `Envelope` ([`wire.ts:90`](../modules/widget-v2/src/wire.ts)):

```ts
interface Envelope<P = unknown> {
  schema_version: number;    // CURRENT_SCHEMA_VERSION = 1
  channel: 'control' | 'game_data';
  message_type: MessageType; // 20-value closed enum
  ts: string;                // RFC 3339 UTC
  seq?: number;              // only on GameEvent / GameStateRequest
  bar_id?: string;
  game_id?: string;
  payload: P;                // typed per message_type
}
```

Outbound frames are built with `buildEnvelope` and serialized with
`serialize` (one JSON object + a single `\n`); inbound frames are parsed with
`parseLine`. The full field rules, payload interfaces, and API contract are
in [`docs/WIRE_PROTOCOL.md`](WIRE_PROTOCOL.md).

---

## The two channels

There is **one physical WebSocket**; the channel is a routing classification
pinned by the message type, not a separate connection. `canonicalChannel`
([`wire.ts:83`](../modules/widget-v2/src/wire.ts)) is authoritative:

| Channel | Message types |
|---------|---------------|
| `control` | `DeviceRegistration`, `ConfigPush`, `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `Heartbeat`, `HeartbeatAck`, `SyncRequest`, `JournalSync`, `PlayerConnected`, `PlayerDisconnected` |
| `game_data` | `GameState`, `GameEvent`, `DisplayEvent`, `GameStateRequest`, `FixtureList` |

A frame whose `channel` disagrees with the canonical pin is rejected at parse
time (`UnpinnedChannelError`).

---

## Message types (20-value closed enum)

`MESSAGE_TYPES` ([`wire.ts:33`](../modules/widget-v2/src/wire.ts)). Grouped by
canonical channel:

### Control (15)

| Type | Purpose |
|------|---------|
| `DeviceRegistration` | Player→server handshake on (re)connect; advertises last seq + config hash. |
| `ConfigPush` | Bar-preferences snapshot + config hash + config object. |
| `ScheduleWindow` | A scheduled-slot time window (bounds, schedule hash, slot count). |
| `PlannedState` | Active render state for a slot: business mode, template, theme, dwell, transition, slot refs. |
| `ProgramSlot` | Game/fixture content for a slot (primary game + id lists). |
| `AdSlot` | An ad placement: class, creative/URI ref, policy. |
| `OverrideInjection` | Time-bounded scheduling override with precedence. |
| `AssetManifest` | Cacheable assets (uri/hash/size/content-type) for a bar. |
| `MessagingLane` | Overlay text (banner/ticker/toast) with a validity window. |
| `Heartbeat` | Player→server liveness ping (player ts + config hash). |
| `HeartbeatAck` | Server ack: server ts, RTT, config-hash-ok flag. |
| `SyncRequest` | Resync request (reason + optional since-seq). |
| `JournalSync` | Player→server journal batch for a time range. |
| `PlayerConnected` | Connection lifecycle notice. |
| `PlayerDisconnected` | Disconnection lifecycle notice (optional reason). |

### Game-data (5)

| Type | Purpose |
|------|---------|
| `GameState` | Full game snapshot (scores, period, clock, signals, badges, sport context). No `seq` — a recovery point. |
| `GameEvent` | Seq-bearing delta (goal/card/sub/period/shot/var/penalty) at a clock. |
| `DisplayEvent` | Bar-scoped display event (class/text/duration). |
| `GameStateRequest` | Player→server recovery request from a given seq (seq-bearing). |
| `FixtureList` | Upcoming fixtures within a window. |

---

## Schema version, seq, and channel-pinning rules

- **`schema_version`** is the integer `1` (`CURRENT_SCHEMA_VERSION`,
  [`wire.ts:419`](../modules/widget-v2/src/wire.ts)). Any other value is
  rejected (`UnsupportedSchemaVersionError`).
- **`channel` is pinned** by `canonicalChannel(message_type)` — the builder
  sets it and the parser enforces it; callers never free-choose it.
- **`seq` is present iff** the type is in `SEQ_BEARING`
  ([`wire.ts:65`](../modules/widget-v2/src/wire.ts)) — exactly `GameEvent`
  and `GameStateRequest`. Missing on a seq-bearing type → `MissingSeqError`;
  present on any other type → `UnexpectedSeqError`. For `GameEvent`, the
  payload `seq` must equal the envelope `seq`.
- **`payload` is required**; `bar_id` / `game_id` are optional strings.

---

## Error taxonomy

`WireError` ([`wire.ts:341`](../modules/widget-v2/src/wire.ts)) is the
abstract base; `WireErrorCode` is a closed union of seven parse codes plus
the outbound `serialize` code:

| Code | Meaning |
|------|---------|
| `malformed_frame` | Non-string input, embedded newline, invalid JSON, non-object frame, or a missing/mistyped envelope field. |
| `unknown_channel` | `channel` not in `CHANNELS`. |
| `unknown_message_type` | `message_type` not in `MESSAGE_TYPES`. |
| `unpinned_channel` | `channel` disagrees with the canonical pin. |
| `unsupported_schema_version` | `schema_version` is an integer but not `1`. |
| `missing_seq` | Seq-bearing type with no `seq`. |
| `unexpected_seq` | Non-seq-bearing type carrying a `seq`. |
| `serialize` | Outbound-only: `buildEnvelope`/`marshal`/`serialize` failure. |

The first seven are the codes the planned transport's deserializer surfaces
as parse-error reasons; see [`docs/WIRE_PROTOCOL.md`](WIRE_PROTOCOL.md) for
the per-code classes and carried fields.

---

## Render & config orchestration (planned)

The wire barrel is the only built surface today. The runtime that consumes it
is specified across the 16 `docs/specs/SPEC-CRWDQ-*` specs but **not yet
built**. The intended shape:

- **Transport** — [SPEC-CRWDQ-022](specs/SPEC-CRWDQ-022-widget-v2-websocket-client.md)
  owns the single per-display `WsClient`, the JSONL `Deserializer` (wrapping
  `parseLine`), the per-`message_type` `Dispatcher` into per-channel handler
  tables, the 30s outbound `Heartbeat` with ack-timeout liveness, exponential
  reconnect with the `crowdaq.v1` subprotocol, and the per-`game_id` seq-gap
  `GameStateRequest` recovery path. It is the **universal blocker** — every
  render template and the metrics ping consume its dispatcher.

- **ConfigPush consumer** —
  [SPEC-CRWDQ-014](specs/SPEC-CRWDQ-014-widget-v2-configpush-consumer.md)
  receives `ConfigPush` frames off the dispatcher, validates the full
  bar-preferences payload closed-shape, persists it to LocalStorage
  (`crowdaq.widgetV2.barPreferences`), tracks `config_hash` for drift, and
  queues a preference apply for the **next dwell boundary** (never a forced
  re-render).

- **Render orchestration** —
  [SPEC-CRWDQ-023](specs/SPEC-CRWDQ-023-widget-v2-single-game-template.md)
  (the `single_game` template) introduces the shared orchestration that every
  other template reuses: `PlannedStateActivator` (activates a `PlannedState`,
  resolves slots, runs the transition, mounts the template, arms the dwell
  timer, and dispatches `reconcile` events), `ProgramSlotResolver`,
  `GameStateStore` (snapshot upsert + seq-ordered `GameEvent` apply +
  per-game subscriptions), `DwellTimer`, and `TransitionExecutor` (named
  transition catalog → AssetManifest cache → default fade). Theme is resolved
  three-state (`set`/`default`/`unset`), with the per-slot
  `PlannedStatePayload.theme_id` overriding the bar-wide `ConfigPush` theme.

- **Asset cache** —
  [SPEC-CRWDQ-064](specs/SPEC-CRWDQ-064-widget-v2-asset-manifest-store.md)
  (`AssetManifestStore`) backs transition assets and ad creatives.

- **Templates & overlays** — the remaining business-mode templates fan out
  after 023: multiple_games
  ([031](specs/SPEC-CRWDQ-031-widget-v2-multiple-games-template.md)), fixtures
  ([034](specs/SPEC-CRWDQ-034-widget-v2-fixtures-template.md)), ads
  ([041](specs/SPEC-CRWDQ-041-widget-v2-ad-templates.md)), recap
  ([046](specs/SPEC-CRWDQ-046-widget-v2-recap-template.md)), the MessagingLane
  overlay ([049](specs/SPEC-CRWDQ-049-widget-v2-messaging-lane-overlay.md)),
  safe_info ([052](specs/SPEC-CRWDQ-052-widget-v2-safe-info-template.md)),
  ambient ([053](specs/SPEC-CRWDQ-053-widget-v2-ambient-template.md)),
  OverrideInjection handling
  ([063](specs/SPEC-CRWDQ-063-widget-v2-override-injection-handler.md)), and
  the composites single_game_with_ads
  ([065](specs/SPEC-CRWDQ-065-widget-v2-single-game-with-ads-template.md)) and
  fixtures_with_live_game
  ([066](specs/SPEC-CRWDQ-066-widget-v2-fixtures-with-live-game-template.md)).

- **Observability** — player-side metrics ping
  ([061](specs/SPEC-CRWDQ-061-widget-v2-player-metrics-ping.md)) and the e2e
  smoke test ([027](specs/SPEC-CRWDQ-027-widget-v2-e2e-smoke-test.md), the M2
  gate).

See [`docs/specs/buildorder.md`](specs/buildorder.md) for the
dependency-linearized sequence.

---

## Implementation status

| Surface | Status | Where |
|---------|--------|-------|
| Wire protocol barrel (envelope, 20-type enum, channel pinning, seq rule, error taxonomy, `buildEnvelope`/`marshal`/`serialize`/`parseLine`/`parseReader`) | **BUILT** | [`modules/widget-v2/src/wire.ts`](../modules/widget-v2/src/wire.ts), re-exported by [`src/index.ts`](../modules/widget-v2/src/index.ts) |
| Node toolchain (ESLint, tsc, Vitest+jsdom, tsup) + path-scoped CI job | **BUILT** | `modules/widget-v2/` (`package.json`, configs), `.github/workflows/ci.yml` (`widget-v2` job) |
| WebSocket transport / dispatcher / heartbeat / seq-gap recovery | **PLANNED** | [SPEC-CRWDQ-022](specs/SPEC-CRWDQ-022-widget-v2-websocket-client.md) |
| ConfigPush consumer + local cache + apply | **PLANNED** | [SPEC-CRWDQ-014](specs/SPEC-CRWDQ-014-widget-v2-configpush-consumer.md) |
| Render orchestration + `single_game` template | **PLANNED** | [SPEC-CRWDQ-023](specs/SPEC-CRWDQ-023-widget-v2-single-game-template.md) |
| AssetManifestStore + all other templates/overlays/observability | **PLANNED** | specs 064, 027, 031, 034, 041, 046, 049, 052, 053, 061, 063, 065, 066 |

Today `src/index.ts` re-exports only `./wire.js`; the transport and templates
will be re-exported here as they arrive.

---

## Build & packaging

`modules/widget-v2/` is a Node 20 TypeScript package (`@crowdaq/widget-v2`,
v0.1.0) built with **tsup**. The `widget-v2` CI job
(`.github/workflows/ci.yml`) is path-scoped to `modules/widget-v2/**` and runs
`npm ci` → ESLint (`--max-warnings=0`) → `tsc --noEmit` → Vitest (jsdom) →
`tsup` build, so it does not run on PHP-only changes. The v1 PHP/contract/JS
jobs are unaffected.

---

## Relationship to v1

| Aspect | v1 (archived) | v2 (this doc) |
|--------|---------------|---------------|
| Manifest | `modules/crowdaq-widget.xml` | `modules/widget-v2/` (TS bundle) |
| Transport | SSE (`GET /events/{eventId}/stream`) | WebSocket + JSONL |
| Frame model | 5 SSE event types | 20-value enveloped `message_type` enum, two channels |
| Direction | server→widget only | bidirectional |
| Config | Xibo widget properties baked at publish | runtime `ConfigPush` (planned) |
| Multi-bar | `display:<field>` from `xiboIC.info()` | `DeviceRegistration` bar/display ids (planned) |
| Docs | [`docs/archive/v1/`](archive/v1/README.md) | this doc + [`WIRE_PROTOCOL.md`](WIRE_PROTOCOL.md) |

v1 is documented in full under [`docs/archive/v1/`](archive/v1/README.md) and
still ships side-by-side with v2.
