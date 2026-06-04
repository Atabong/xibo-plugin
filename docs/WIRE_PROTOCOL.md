# widget-v2 wire protocol reference

Detailed reference for the CROWDAQ widget-v2 wire surface — the typed
JSONL envelope, the channel/`message_type` model, the payload interfaces,
the error taxonomy, and the builder/serializer/parser API.

> **Source of truth.** Everything below mirrors
> [`modules/widget-v2/src/wire.ts`](../modules/widget-v2/src/wire.ts), which
> is a **vendored, faithful in-repo copy of SPEC-CRWDQ-017** (the
> wire-protocol surface that lives canonically in `crowdaq-backend`,
> `src/wire/*`). SPEC-CRWDQ-017 is not published as an installable npm
> package consumable by `xibo-plugin`, so widget-v2 vendors it. The copy is
> kept **structurally identical** to the backend original — the backend
> splits the surface across `channel.ts` / `message-type.ts` / `envelope.ts`
> / `types.ts` / `errors.ts` / `serialize.ts` / `parse.ts` behind a barrel;
> the plugin folds it into one `src/wire.ts` because the contract pins a
> single owning module. The only deliberate divergence is that physical
> layout — so drift between the two is a mechanical diff. `wire.ts` is the
> single owner of these symbols in widget-v2: there is no hand-rolled
> parser, type set, or error taxonomy anywhere else under
> `modules/widget-v2`. This file is **built today** (re-exported through
> [`src/index.ts`](../modules/widget-v2/src/index.ts)); the transport
> (SPEC-CRWDQ-022) that consumes it is planned, not yet built.

For the higher-level data flow and the planned render/config surface, see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Envelope

Every frame — inbound and outbound — is an `Envelope` (`wire.ts:90`):

```ts
interface Envelope<P = unknown> {
  schema_version: number;   // CURRENT_SCHEMA_VERSION = 1
  channel: Channel;         // 'control' | 'game_data'
  message_type: MessageType;// one of the 20-value closed enum
  ts: string;               // RFC 3339 UTC string, non-empty
  seq?: number;             // present ONLY on GameEvent / GameStateRequest
  bar_id?: string;          // optional; string when present
  game_id?: string;         // optional; string when present
  payload: P;               // typed per message_type via PayloadFor<T>
}
```

Field rules (enforced by `buildEnvelope` on the way out and `parseLine` on
the way in):

- **`schema_version`** must be the integer `1`. `CURRENT_SCHEMA_VERSION` is
  exported as `1 as const` (`wire.ts:419`); the parser rejects any other
  value with `UnsupportedSchemaVersionError`.
- **`channel`** must equal `canonicalChannel(message_type)` — the channel is
  pinned by the message type, never free-chosen (see § Channel pinning).
- **`ts`** must be a non-empty string (treated as RFC 3339 UTC; the wire
  layer checks non-emptiness, not full RFC 3339 grammar).
- **`seq`** must be a JS safe integer and is present **iff** the message type
  is seq-bearing (`GameEvent`, `GameStateRequest`). Present-but-not-allowed →
  `UnexpectedSeqError`; required-but-absent → `MissingSeqError`.
- **`bar_id` / `game_id`** are optional; when present they must be strings.
- **`payload`** is required and must be present (a missing or `undefined`
  `payload` is a `MalformedFrameError`).

`PayloadFor<T>` (`wire.ts:287`) is the conditional type that maps each
`MessageType` to its concrete payload interface, so `Envelope<PayloadFor<T>>`
is fully typed per message type.

---

## Channels

Two logical channels, a closed two-value set (`wire.ts:24`):

```ts
const CHANNELS = ['control', 'game_data'] as const;
type Channel = (typeof CHANNELS)[number];
```

`isChannel(v)` (`wire.ts:27`) is the runtime guard. There is **one physical
WebSocket** per display; "channel" is a routing classification of the
`message_type`, not a separate socket.

---

## Message types (the 20-value closed enum)

`MESSAGE_TYPES` (`wire.ts:33`) is the authoritative closed enum;
`isMessageType(v)` (`wire.ts:60`) is the runtime guard. Fifteen types pin to
`control`, five to `game_data`.

### Control channel (15)

| `message_type` | Payload | Purpose |
|----------------|---------|---------|
| `DeviceRegistration` | `DeviceRegistrationPayload` | Player→server handshake on (re)connect: identifies the bar/display and advertises last-seen seq + config hash. |
| `ConfigPush` | `ConfigPushPayload` | Server→player bar-preferences snapshot + config hash + the config object. |
| `ScheduleWindow` | `ScheduleWindowPayload` | A time window of scheduled slots for a bar (window bounds, schedule hash, slot count). |
| `PlannedState` | `PlannedStatePayload` | The active render state for a schedule slot — business mode, template, theme, dwell, transition, slot references. |
| `ProgramSlot` | `ProgramSlotPayload` | The game/fixture content bound to a slot (primary game + game/fixture id lists). |
| `AdSlot` | `AdSlotPayload` | An ad placement: ad class, creative/URI ref, and policy. |
| `OverrideInjection` | `OverrideInjectionPayload` | A time-bounded override of normal scheduling, with precedence. |
| `AssetManifest` | `AssetManifestPayload` | The set of cacheable assets (uri/hash/size/content-type) for a bar. |
| `MessagingLane` | `MessagingLanePayload` | An overlay text message (banner / ticker / toast) with a validity window. |
| `Heartbeat` | `HeartbeatPayload` | Player→server liveness ping carrying player local ts + current config hash. |
| `HeartbeatAck` | `HeartbeatAckPayload` | Server→player ack: server ts, measured RTT, and whether the player's config hash is current. |
| `SyncRequest` | `SyncRequestPayload` | Request for a resync, with a reason and an optional since-seq. |
| `JournalSync` | `JournalSyncPayload` | Player→server journal batch for a time range. |
| `PlayerConnected` | `PlayerConnectedPayload` | Connection lifecycle notice (bar/display/session, connected-at). |
| `PlayerDisconnected` | `PlayerDisconnectedPayload` | Disconnection lifecycle notice with an optional reason. |

### Game-data channel (5)

| `message_type` | Payload | Purpose |
|----------------|---------|---------|
| `GameState` | `GameStatePayload` | Full game snapshot (scores, period, clock, signals, badges, sport context). No `seq` — every snapshot is a recovery point. |
| `GameEvent` | `GameEventPayload` | A seq-bearing delta for a game (goal/card/sub/period/shot/var/penalty) at a clock with a delta payload. |
| `DisplayEvent` | `DisplayEventPayload` | A bar-scoped display event (class/text/duration) with an arbitrary payload. |
| `GameStateRequest` | `GameStateRequestPayload` | Player→server recovery request: re-send game state from a given seq. Seq-bearing (request ordinal). |
| `FixtureList` | `FixtureListPayload` | Upcoming fixtures for a bar within a window (fixture/game ids, teams, kickoff). |

> The transport spec (SPEC-CRWDQ-022) further classifies four of these 20 as
> **player→server only** (`DeviceRegistration`, `Heartbeat`,
> `GameStateRequest`, `JournalSync`), leaving 16 that a player can *receive*.
> That player/server direction split is a transport-layer concern; the wire
> module itself pins only the `(message_type → channel)` mapping below.

---

## Channel pinning (`canonicalChannel`)

`canonicalChannel(t)` (`wire.ts:83`) is the authoritative pinning table. The
five game-data types are a `Set` (`GAME_DATA_TYPES`, `wire.ts:74`); every
other type pins to `control`:

| Result channel | Message types |
|----------------|---------------|
| `game_data` | `GameState`, `GameEvent`, `DisplayEvent`, `GameStateRequest`, `FixtureList` |
| `control` | all other 15 |

The envelope's `channel` field is not free-chosen: `buildEnvelope` sets it
from `canonicalChannel`, and `parseLine` rejects a frame whose `channel`
disagrees with the canonical pin (`UnpinnedChannelError`).

---

## Seq-bearing rule

`SEQ_BEARING` (`wire.ts:65`) is the closed set of message types that **must**
carry a `seq`; `isSeqBearing(t)` (`wire.ts:70`) is the guard:

```ts
const SEQ_BEARING = new Set<MessageType>(['GameEvent', 'GameStateRequest']);
```

- A seq-bearing type with no `seq` → `MissingSeqError` on parse (and
  `buildEnvelope` throws `SerializeError`).
- A non-seq-bearing type carrying a `seq` → `UnexpectedSeqError` on parse
  (and `buildEnvelope` throws `SerializeError`).
- `seq`, when present, must be a `Number.isSafeInteger`.
- For `GameEvent` only, `buildEnvelope` additionally cross-checks that
  `payload.seq === envelope.seq` (the payload mirrors the envelope seq);
  a mismatch throws `SerializeError` (`wire.ts:459`).

---

## Payload interfaces

Each interface is summarized below; see `wire.ts` for the exact field types.

### Control payloads

- **`DeviceRegistrationPayload`** (`wire.ts:103`) — `bar_id`, `display_id`,
  `player_sw_version`, `last_seq` (`number | null`), `last_config_hash`
  (`string | null`).
- **`ConfigPushPayload`** (`wire.ts:111`) — `config_hash`, `bar_id`,
  `display_id`, `config` (`Record<string, unknown>`).
- **`ScheduleWindowPayload`** (`wire.ts:118`) — `window_id`, `bar_id`,
  `window_start`, `window_end`, `schedule_hash`, `slot_count`.
- **`PlannedStatePayload`** (`wire.ts:129`) — `state_id`, `window_id`,
  `schedule_slot_index`, `valid_from`, `interrupt_class`
  (`'scheduled' | 'exceptional_override'`), `business_mode`, `template_id`,
  `theme_id` (`string | null`), `dwell_target_ms`, `transition` (a
  closed-enum catalog **name string**, not an object), `program_slot_id`
  (`string | null`), `ad_slot_id` (`string | null`).
- **`ProgramSlotPayload`** (`wire.ts:144`) — `program_slot_id`,
  `primary_game_id` (`string | null`), `game_ids[]`, `fixture_ids[]`.
- **`AdSlotPayload`** (`wire.ts:151`) — `ad_slot_id`, `ad_class`, `ad_ref`,
  `ad_ref_type` (`'creative_asset' | 'external_uri'`), `policy`.
- **`OverrideInjectionPayload`** (`wire.ts:159`) — `override_id`, `bar_id`,
  `override_class`, `payload_ref` (`string | null`), `valid_from`,
  `valid_to` (`string | null`), `precedence`.
- **`AssetManifestPayload`** (`wire.ts:169`) — `manifest_id`, `bar_id`,
  `generated_at`, `assets[]` where each asset is
  `{ asset_id, uri, hash, size_bytes, content_type }`.
- **`MessagingLanePayload`** (`wire.ts:182`) — `bar_id`, `lane_id`, `text`,
  `display_form` (`'banner' | 'ticker' | 'toast'`), `dwell_ms`,
  `valid_from`, `valid_until`.
- **`HeartbeatPayload`** (`wire.ts:192`) — `player_local_ts`, `config_hash`.
- **`HeartbeatAckPayload`** (`wire.ts:197`) — `server_ts`, `rtt_ms`,
  `config_hash_ok` (boolean).
- **`SyncRequestPayload`** (`wire.ts:203`) — `reason`, `since_seq`
  (`number | null`).
- **`JournalSyncPayload`** (`wire.ts:208`) — `bar_id`, `display_id`,
  `from_ts`, `to_ts`, `entries[]` (each an arbitrary record).
- **`PlayerConnectedPayload`** (`wire.ts:216`) — `bar_id`, `display_id`,
  `connected_at`, `session_id`.
- **`PlayerDisconnectedPayload`** (`wire.ts:223`) — `bar_id`, `display_id`,
  `disconnected_at`, `session_id`, `reason` (`string | null`).

### Game-data payloads

- **`GameStatePayload`** (`wire.ts:233`) — `game_id`, `sport`, `home_score`,
  `away_score`, `period`, `clock`, `signals[]`, `badges[]`, `sport_context`
  (`Record<string, unknown>`). Carries **no** `seq`.
- **`GameEventPayload`** (`wire.ts:247`) — `game_id`, `seq`, `kind`
  (`'goal' | 'card' | 'sub' | 'period' | 'shot' | 'var' | 'penalty'`),
  `at_clock`, `delta` (`Record<string, unknown>`). The payload `seq` mirrors
  the envelope `seq`.
- **`DisplayEventPayload`** (`wire.ts:255`) — `display_event_id`, `bar_id`,
  `event_class`, `text`, `duration_ms`, `payload`.
- **`GameStateRequestPayload`** (`wire.ts:264`) — `game_id`, `from_seq`.
- **`FixtureListPayload`** (`wire.ts:269`) — `bar_id`, `generated_at`,
  `window_start`, `window_end`, `fixtures[]` where each fixture is
  `{ fixture_id, game_id, sport, league, home_team, away_team, kickoff_ts }`.

---

## Error taxonomy

All wire errors derive from the abstract `WireError` (`wire.ts:341`), which
carries a `code: WireErrorCode` and sets `name` to the concrete subclass.
`WireErrorCode` (`wire.ts:331`) is a closed union of **seven parse codes plus
the `serialize` code** (eight total):

| `code` | Class | Raised when |
|--------|-------|-------------|
| `malformed_frame` | `MalformedFrameError` (`wire.ts:349`) | Not a string, embedded newline/CR, invalid JSON, non-object frame, or a missing/mistyped required envelope field (`schema_version`, `channel`, `message_type`, `ts`, `payload`, optional `bar_id`/`game_id`, bad `seq` type). |
| `unknown_channel` | `UnknownChannelError` (`wire.ts:353`) | `channel` is a string but not in `CHANNELS`. Carries `got`. |
| `unknown_message_type` | `UnknownMessageTypeError` (`wire.ts:362`) | `message_type` is a string but not in `MESSAGE_TYPES`. Carries `got`. |
| `unpinned_channel` | `UnpinnedChannelError` (`wire.ts:371`) | `channel` disagrees with `canonicalChannel(message_type)`. Carries `message_type`, `got_channel`, `want_channel`. |
| `unsupported_schema_version` | `UnsupportedSchemaVersionError` (`wire.ts:384`) | `schema_version` is an integer but not `1`. Carries `got`, `want`. |
| `missing_seq` | `MissingSeqError` (`wire.ts:395`) | A seq-bearing type arrives with no `seq`. Carries `message_type`. |
| `unexpected_seq` | `UnexpectedSeqError` (`wire.ts:404`) | A non-seq-bearing type carries a `seq`. Carries `message_type`. |
| `serialize` | `SerializeError` (`wire.ts:413`) | Thrown by `buildEnvelope` / `marshal` / `serialize` on the **outbound** path (bad `schema_version`/`ts`/`message_type`, seq-rule violation, `GameEvent` payload/envelope seq mismatch, `JSON.stringify` failure, or a serialized frame containing a raw newline). |

The first seven are the `parseLine` codes the transport layer surfaces as
its `ParseErrorReason`. `serialize` is the outbound-only code.

---

## API contract

### `buildEnvelope<T>(args): Envelope<PayloadFor<T>>` (`wire.ts:431`)

Builds a typed, validated envelope. `args` (`BuildEnvelopeArgs<T>`,
`wire.ts:421`): `message_type`, `payload`, `ts`, optional `seq`, `bar_id`,
`game_id`, `schema_version` (defaults to `CURRENT_SCHEMA_VERSION`). It:

- validates `schema_version` is an integer, `ts` is a non-empty string, and
  `message_type` is a string;
- sets `channel = canonicalChannel(message_type)` (never taken from the
  caller);
- enforces the seq-bearing rule (required/forbidden, safe integer) and the
  `GameEvent` payload-seq cross-check;
- omits `seq`/`bar_id`/`game_id` from the result object when `undefined`;
- throws `SerializeError` on any violation.

### `marshal(e): string` (`wire.ts:485`)

Serializes an envelope to its frame bytes **without** a trailing newline —
suitable for a NATS message body or a single WS text-frame payload. Throws
`SerializeError` if `e` is not an object, if `JSON.stringify` fails or yields
non-string, or if the JSON somehow contains a raw `\n`/`\r`.

### `serialize(e): string` (`wire.ts:512`)

`marshal(e) + '\n'` — one JSONL frame terminated by exactly one `\n`.

### `parseLine(line): Envelope | null` (`wire.ts:529`)

Parses one JSONL line into a typed `Envelope`. Returns `null` for an
empty/whitespace-only line. Tolerates a single trailing `\r` (CRLF input
handed in without the `\n`) but rejects an **embedded** newline or CR
(`MalformedFrameError`). Validates the full envelope contract — schema
version, channel, message type, channel pinning, seq rule, `ts`, optional
string fields, and payload presence — throwing the appropriate `WireError`
subclass on any violation. The transport's `Deserializer` (SPEC-CRWDQ-022)
wraps this and converts thrown `WireError`s into a `parse_error` marker so it
never throws across the dispatch boundary.

### `parseReader(source, fn): Promise<void>` (`wire.ts:659`)

Streams JSONL frames from an `AsyncIterable<string | Uint8Array>`. Splits on
`\n`, tolerates a trailing `\r` per line, skips empty lines, buffers a
partial trailing line across chunk boundaries, and decodes UTF-8 with a
streaming `TextDecoder`. Invokes `fn(envelope)` (awaited) per parsed frame,
stops on the first parse error, and flushes the final buffered line on clean
EOF.

---

## Drift policy

Because `wire.ts` is a vendored copy of the backend SPEC-CRWDQ-017 surface,
any change to the backend wire contract must be mirrored here mechanically.
Treat a structural diff between `crowdaq-backend/src/wire/*` (concatenated)
and `modules/widget-v2/src/wire.ts` as a defect: the field sets, the 20-value
enum, the pinning table, the seq-bearing set, and the eight error codes must
match exactly.
