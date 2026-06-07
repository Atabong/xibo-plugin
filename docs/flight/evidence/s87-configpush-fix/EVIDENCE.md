# S87 — ConfigPush schema_invalid loop + Heartbeat double-nest (widget side)

Flight-mode sweep, widget-only (xibo-plugin). Verified LIVE against the bar-demo
player over CDP on `100.87.200.121:9222`.

## TL;DR / PASS-FAIL

| Claim | Result |
| --- | --- |
| Heartbeat double-nest fixed; `HeartbeatAck config_hash_ok` flips false→true | **PASS** (live wire) |
| ConfigPush `schema_invalid` loop GONE on the widget side | **FAIL on the widget alone — by design**: the loop's root cause is a BACKEND camelCase `business_hours` bug (fixed separately in crowdaq-backend `src/delivery/repush/builder.ts`). The widget cannot and should not "fix" a malformed backend payload. Proven below: once the backend emits snake_case rows, the widget ACCEPTS the exact captured frame. |
| Widget ConfigPush validator hardened against the envelope wrapper keys | **PASS** (defensive; not the loop's cause) |

## Root-cause analysis (evidence-driven, against the REAL captured frame)

The directive's initial hypothesis was that the leftover envelope `channel` /
`payload` keys on the flattened frame made `validateConfigPush` reject every
ConfigPush. The live capture disproved that as the *loop* cause:

### Real inbound ConfigPush frame (CDP `Network.webSocketFrameReceived`, BEFORE)

```
{"schema_version":1,"channel":"control","message_type":"ConfigPush","ts":"2026-06-07T18:48:44.789Z",
 "payload":{"config_hash":"1103df1d…","bar_id":"1111…","display_id":"bar-demo",
  "preferences":{…,"business_hours":[
     {"dayOfWeek":"MON","openLocal":"04:00","closeLocal":"23:00"}, …],   ← camelCase (BACKEND BUG)
   …},
  "cache_ceiling_bytes":1073741824,"intervals":{…}},
 "bar_id":"1111…"}
```

Running this exact frame through the validator (vitest probe):

- The flattened frame's top-level keys DO include the leftover `channel` + `payload`
  (`config_hash,bar_id,display_id,preferences,cache_ceiling_bytes,intervals,schema_version,channel,message_type,ts,payload`).
- BUT the deployed s83 dispatch already reconstructs a clean 9-key frame via
  `toConfigPushFrame` before validating, so the leftover keys were NOT the reject.
- Both the s83-reconstructed path AND the raw flattened frame reject with
  `schema_invalid` **because of the camelCase `business_hours` keys**
  (`dayOfWeek`/`openLocal`/`closeLocal` vs required `day_of_week`/`open_local`/`close_local`).
- With `business_hours` in correct snake_case (UPPERCASE day), ALL paths PASS:
  `OK_S83={"ok":true,…}`, `OK_FLAT_WITH_CHANNEL={"ok":true,…}`,
  `OK_FLAT_DESER_OUTPUT={"ok":true,…}`.

**Conclusion:** the schema_invalid LOOP is a backend bug. The widget changes
below are correct and defensive but are NOT the loop's fix.

## Widget changes made

### 1. Heartbeat double-nested envelope (the real widget bug — MY fix)

Live capture of the SENT heartbeat (BEFORE) showed double wrapping:

```
SENT (BEFORE): {"schema_version":1,"channel":"control","message_type":"Heartbeat","ts":"…",
  "payload":{"schema_version":1,"channel":"control","ts":"…",
    "payload":{"player_local_ts":1780858244782,"config_hash":"1103df1d…"}}}
RECV (BEFORE): {"…","message_type":"HeartbeatAck","payload":{"server_ts":"…","rtt_ms":0,"config_hash_ok":false}}
```

The real fields were buried under `payload.payload`, so the server read a null
`payload.config_hash` and EVERY HeartbeatAck returned `config_hash_ok:false`
(config-drift detection masked).

Root cause: `WsClient.send()` is the single point that wraps a flat player frame
in the server envelope (`codec.buildEnvelope`). `HeartbeatLoop.emit()` AND
`GameStateRequestSender.requestForGap()` ALSO pre-wrapped before `send()`, so the
frame was wrapped twice. (`DeviceRegistration` was correct because
`sendRegistration()` passes the FLAT frame.)

Fix: `HeartbeatLoop` and `GameStateRequestSender` now emit the FLAT player frame;
`WsClient.send` does the single wrap.

Files:
- `modules/widget-v2/src/transport/Heartbeat.ts`
- `modules/widget-v2/src/transport/GameStateRequest.ts`

AFTER (live wire, build `s87-heartbeat-configpush`):

```
SENT (AFTER): {"schema_version":1,"channel":"control","message_type":"Heartbeat","ts":"2026-06-07T19:03:01.437Z",
  "payload":{"player_local_ts":1780858981437,"config_hash":"1103df1d…"}}     ← single envelope ✅
RECV (AFTER): {"…","message_type":"HeartbeatAck","payload":{"server_ts":"…","rtt_ms":0,"config_hash_ok":true}}   ← ✅ flipped
```

### 2. ConfigPush envelope-key hardening (defensive — not the loop cause)

- `EnvelopeFlatteningDeserializer` (`bootstrap.ts`) now `delete`s the envelope-only
  `channel` key after flattening. `payload` is KEPT (AssetManifestStore /
  OverrideInjectionHandler / MessagingLaneStore / FixtureListStore read
  `frame.payload`).
- `validateConfigPush` (`config/validate.ts`) tolerates the known envelope wrapper
  keys (`channel`, `payload`) via `hasExactKeysIgnoringEnvelope`, while still
  rejecting any genuinely unknown surplus key (D-GRH-73).

The other frame validators (PlannedState / GameState / AdSlot / asset_manifest)
read fields via dedicated extractors that already tolerate extra keys, so they
were not part of any closed-shape reject loop; the `channel` strip benefits them
too.

Files:
- `modules/widget-v2/src/config/validate.ts`
- `modules/widget-v2/src/bootstrap.ts`

## Tests

- `tests/config/configpush-envelope.test.ts` (new, 4): live-envelope ConfigPush
  ACCEPTED; stray `channel` tolerated; unknown surplus still rejected; other
  frames still flatten.
- `tests/transport/WsClient.test.ts` (new on-wire assertion): sent Heartbeat is a
  SINGLE envelope with `config_hash` at `payload.config_hash` (regression guard:
  no `payload.payload` / nested `schema_version` / `channel`).
- `Heartbeat`/`GameStateRequest`/`Dispatcher`/`wire-fixtures.seq-gap` tests
  updated to assert the FLAT sender output (envelope wrap is WsClient's job).
- **Full suite: 660 passed (96 files). `tsc --noEmit` clean.**

## Deploy (Flux CMS module, durable — S83 path, NO kubectl-cp)

- `node tools/package.mjs --build` → packaged module XML.
- xibo repo `infra/k8s/apps/cms/custom-modules/crowdaq-widget-v2.xml` updated
  byte-for-byte; provenance in `kustomization.yaml`.
  - module XML sha256: `52ce450061b2d982e293e4c0b2e929a1dca52544fd59c95a042d6a65b74272de`
  - bundle sha256: `b828b5b02dc17c28da9204f491566869a28d7290cb5f2cb2b1eceddd5acbe4aa`
  - BUILD_MARKER: `build:s87-heartbeat-configpush`
- Flux reconciled `xibo` GitRepository + `xibo-base` Kustomization to
  `main@40781be`. configMapGenerator suffix → `crowdaq-widget-v2-module-d8ht2b2m95`,
  forcing a Recreate rollout.
- In-pod sha verified: `/var/www/cms/custom/modules/crowdaq-widget-v2.xml` →
  `52ce450…` ✅.
- Player pickup: the CMS-side compiled widget cache `library/widget/9_17.html`
  was stale (`s83-bar-tz`); cleared it to force regeneration from the new module,
  restarted the player; the served file then carried `build:s87-heartbeat-configpush`.

## Durability proof

Hard `kubectl delete pod --grace-period=0 --force` of the CMS pod; the
replacement pod (`xibo-cms-658958c6c-bwsnh`) serves the IDENTICAL module sha256
`52ce450…`. The module is Flux/git-managed (not kubectl-cp'd) → survives pod loss.

## Commits / PRs

- xibo-plugin PR #109 (ConfigPush hardening) → main `7302ea3`.
- xibo-plugin PR #110 (heartbeat double-nest + marker) → main `b6ff914`.
- xibo PR #94 (deploy configpush) → main `e28a535`.
- xibo PR #95 (deploy heartbeat) → main `40781be`.

## Handoff

The ConfigPush schema_invalid loop will clear once the backend repush fix lands
(snake_case `business_hours`). At that point the live console
`config_push_received` should flip to `accepted:true` and preferences (incl. the
`America/Chicago` timezone in the captured frame) apply. The widget side is ready
and proven to accept the corrected frame.
