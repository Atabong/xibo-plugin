---
spec_id: SPEC-CRWDQ-027
title: Widget v2 e2e smoke test on player side (real WS, real BarPreferences)
status: impl-ready
owner: player-runtime/widget-v2/tests/e2e
depends_on: [SPEC-CRWDQ-014, SPEC-CRWDQ-022, SPEC-CRWDQ-023, SPEC-CRWDQ-026, SPEC-CRWDQ-028]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-027 — Widget v2 e2e smoke test on player side (real WS, real BarPreferences)

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S4 — Coverage → record → render (end-to-end) |
| Plane epic | CRWDQ-5 |
| Decisions referenced | D-GRH-29, D-GRH-42, D-GRH-43, D-GRH-49, D-GRH-59, D-GRH-61 |
| Source files | `modules/widget-v2/**` (consumed end-to-end) |
| New files | `modules/widget-v2/tests/e2e/smoke.spec.ts`, `modules/widget-v2/tests/e2e/playwright.config.ts`, `modules/widget-v2/tests/e2e/fixtures/staging.env`, `modules/widget-v2/tests/e2e/page-objects/WidgetPage.ts`, `.github/workflows/widget-v2-e2e.yml` |

> **Backend authority note:** Every wire-contract assertion in this e2e
> test is cross-checked against the authoritative backend specs
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-017` (wire-protocol envelope) and
> `SPEC-CRWDQ-020` (GameDeliveryService WS server), and against the
> player-side transport spec `SPEC-CRWDQ-022`. An e2e test that asserts a
> wrong contract is worse than no test — it enshrines drift. The
> assertions below were corrected against those specs.

## Module

`player-runtime :: widget-v2 :: tests/e2e` — a Playwright-driven smoke test running widget v2 in headless Chromium against the staging `GameDeliveryService`. Asserts the full re-push handshake (`DeviceRegistration` → `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState` → `ProgramSlot` → `GameState`), renders one `single_game` frame, observes a heartbeat round-trip, and disconnects cleanly.

## Current shape

- No e2e suite exists for v2 today. Widget v1 is exercised manually via `bardemo-*` screenshots (see repo root). The CI runs `composer lint`, twig validation, and the release-zip job — none of which open a browser or speak the v2 protocol.
- The crowdaq-backend repo carries SPEC-CRWDQ-026 — an integration suite that spins up NATS/Temporal/Postgres/AdminGateway/GameScheduler/BarPlayerSchedulerService/GameDeliveryService and asserts the backend pipeline. That suite uses a "mock player" (an in-process WS client) for its terminal assertion. It does not exercise the real widget.
- This spec adds the symmetric player-side test: a real widget v2 build, real headless Chromium, a real WS against the staging `GameDeliveryService` URL the backend suite stands up.

The split is intentional per the SPEC-CATALOG decomposition decision #3: backend-side e2e cannot share fixtures with the widget repo without coupling them; the two suites assert opposite ends of the same pipeline.

## Wire-contract facts this test asserts against (SPEC-CRWDQ-017 / -020 / -022)

- The WS endpoint is `GET /ws` (SPEC-CRWDQ-020), and the upgrade MUST carry the WebSocket subprotocol `crowdaq.v1` — SPEC-CRWDQ-020 rejects an upgrade missing it with HTTP `400`. The `WsClient` (SPEC-CRWDQ-022) sends this subprotocol; a successful boot implicitly proves it.
- Every WS frame is a SPEC-CRWDQ-017 `Envelope`: `{ schema_version, channel, message_type, ts, seq?, bar_id?, game_id?, payload }`. Frames are NOT flat.
- The first outbound frame is a `DeviceRegistration` envelope whose payload is the SPEC-CRWDQ-017 `DeviceRegistrationPayload`: `{ bar_id, display_id, player_sw_version, last_seq, last_config_hash }`. There is **no `capabilities` field** and the version field is `player_sw_version`, not `player_version`.
- `Heartbeat` and `HeartbeatAck` are NOT seq-bearing (SPEC-CRWDQ-017 — only `GameEvent` and `GameStateRequest` carry `seq`). `HeartbeatAck`'s payload is `{ server_ts, rtt_ms, config_hash_ok }` — there is no `seq` to "match".
- `WsClient.close()` performs a WS close with code `1000` ("normal closure") — there is no `ws_close_clean` reason string (that was a fiction removed from SPEC-CRWDQ-022).
- The re-push order (SPEC-CRWDQ-020, D-GRH-49) is `ConfigPush → ScheduleWindow → AssetManifest → PlannedState(s) → ProgramSlot(s) → GameState(s)`.

## Proposed deep interface

### Test runner choice

Playwright. Reasons specific to this case:
- Real Chromium runtime — matches the bar-PC `xibo-player` Chromium runtime (the v1 widget already runs there; v2 inherits).
- Built-in WebSocket recording (`page.on('websocket')`) gives the protocol-message-sequence assertion D-GRH-29 implies without instrumenting the widget itself.
- Snapshot DOM assertions via `locator(...).innerHTML()` + serialization, suitable for the single rendered frame.

### Test fixture: staging stack

```
modules/widget-v2/tests/e2e/fixtures/staging.env
  STAGING_GDS_WS_URL=wss://<tailnet-host>/ws
  STAGING_DISPLAY_ID=bar-e2e-display-1
  STAGING_BAR_ID=bar-e2e
  STAGING_EXPECTED_GAME_ID=e2e-fake-nfl-1
```

The values are populated by the SPEC-CRWDQ-028 staging deploy. The WS path is `/ws` (SPEC-CRWDQ-020). The widget v2 test loader reads `staging.env` and constructs the boot URL accordingly. No long-lived secrets — tailnet identity is the auth boundary (D-GRH-43).

### Page object

```ts
// modules/widget-v2/tests/e2e/page-objects/WidgetPage.ts
export class WidgetPage {
  constructor(private page: Page) {}

  /** Navigate to a static HTML host page that boots widget-v2 with the given config. */
  async open(opts: { gdsUrl: string; displayId: string; barId: string }): Promise<void>;

  /** Resolves when the WsClient emits its `open` lifecycle event. SPEC-CRWDQ-022's
   *  closed lifecycle set is open|close|error|reconnect — there is no
   *  `dispatcher_ready` event; `open` (fired when connect() resolves on the first
   *  server frame) is the boot-ready signal. */
  async waitForOpen(): Promise<void>;

  /** Resolves when a PlannedState{single_game} has been activated and the score panel is in DOM. */
  async waitForSingleGameRendered(): Promise<void>;

  /** Returns the full ordered list of message_type values observed on the WS in both directions. */
  async observedProtocolSequence(): Promise<{ direction: 'out' | 'in'; messageType: string }[]>;

  /** Returns the negotiated WS subprotocol (expected: "crowdaq.v1"). */
  async observedSubprotocol(): Promise<string>;

  /** Returns the parsed payload of the first observed outbound DeviceRegistration frame. */
  async firstDeviceRegistrationPayload(): Promise<{
    bar_id: string; display_id: string; player_sw_version: string;
    last_seq: number | null; last_config_hash: string | null;
  }>;

  /** Returns the rendered home/away/score text. */
  async readScorePanel(): Promise<{ home: string; away: string; homeScore: string; awayScore: string }>;

  /** Trigger graceful disconnect (WsClient.close() — WS close code 1000). */
  async disconnect(): Promise<void>;

  /** Returns the WS close code observed on the Playwright websocket close event. */
  async observedCloseCode(): Promise<number>;
}
```

### Boot harness

A minimal static HTML page under `modules/widget-v2/tests/e2e/host.html` loads the built widget bundle (the same artifact the Xibo widget XML will load in production) and a tiny boot script that reads URL query params (`?gds=...&displayId=...&barId=...`) and constructs the `WsClient` (with the `crowdaq.v1` subprotocol per SPEC-CRWDQ-022/-020). This is the bridge from Playwright to the actual widget runtime — no shim, no harness-specific code paths inside the widget bundle.

### Assertion set

For the single test case:

1. **Boot.** `WidgetPage.open({...staging})` navigates to `host.html?gds=...&displayId=...&barId=...`. The `WsClient`'s `open` lifecycle event must fire within 5 s. A successful upgrade implicitly proves the `crowdaq.v1` subprotocol was sent (SPEC-CRWDQ-020 rejects an upgrade without it).
2. **DeviceRegistration outbound.** The first observed outbound frame is a `DeviceRegistration` envelope. Its payload is a valid SPEC-CRWDQ-017 `DeviceRegistrationPayload`: `bar_id` and `display_id` match the configured values, `player_sw_version` is non-empty, `last_seq` and `last_config_hash` are `null` (first connect). There is no `capabilities` field.
3. **Full re-push inbound.** The next inbound frames contain, in order, the subsequence `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState` → `ProgramSlot` → `GameState` (SPEC-CRWDQ-020 D-GRH-49 order). The test asserts the ordered subsequence — it does not assert other frames are absent (the server may interleave additional frames; the assertion is only that the named frames appear in this relative order).
4. **Single-game DOM.** Within 10 s of boot, `WidgetPage.waitForSingleGameRendered()` resolves; the score panel contains home/away team names and scores matching the staging `GameState` fixture. Snapshot DOM assertion on the `[data-testid="cdq-score"]` subtree; `data-theme` attribute present on the rendered `<section>`.
5. **Heartbeat round-trip.** Within 35 s of boot (30 s cadence + 5 s slack), exactly one outbound `Heartbeat` frame and one inbound `HeartbeatAck` frame are observed. The `Heartbeat` payload carries `player_local_ts` and `config_hash`; neither `Heartbeat` nor `HeartbeatAck` carries a `seq` field (SPEC-CRWDQ-017 — they are not seq-bearing). The assertion is presence + count, not seq-correlation.
6. **Graceful disconnect.** `WidgetPage.disconnect()` triggers `WsClient.close()`; the WebSocket closes with WS close code `1000` ("normal closure"), observed via Playwright's `websocket` close event; no `error` lifecycle event fires.

### CI integration

`.github/workflows/widget-v2-e2e.yml` runs on PRs touching `modules/widget-v2/**`. It requires the staging stack to be reachable from the GH Actions runner — the runner joins the tailnet via the existing `tailscale/github-action@v2` step the xibo-plugin repo already uses for `bar-pc` smoke tests. If the tailnet join fails, the job fails fast with the error message `tailnet_unavailable: skipping widget-v2 e2e` — the workflow does NOT degrade to a mocked WS server, because that would invalidate the spec's "real WS" guarantee.

### Out of scope (explicitly)

- Multi-game, fixtures, with-ads, recap, safe, ambient render templates. Each has its own e2e in their respective slices or in SPEC-CRWDQ-028's dashboard verification.
- `MessagingLane` overlay coexistence — covered when SPEC-CRWDQ-049 lands.
- Override interrupt behavior — out of scope for S4; first exercised in S7+.
- Visual / pixel comparison. DOM-level snapshot only.
- Reconnect behavior. The smoke test asserts the happy connect path; reconnect cases stay in the SPEC-CRWDQ-022 unit-test suite.

## Test strategy

This spec is itself a test spec — the "Test strategy" lens here documents how the e2e assertions are categorized.

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `GameDeliveryService` WebSocket | 3 remote-owned | Real connection to the staging URL — no mock, no proxy. |
| Chromium runtime | 1 in-process | Real Playwright Chromium. |
| Tailnet | 3 remote-owned | Real tailnet join via the existing GH Actions step. |
| Widget v2 bundle | 1 in-process | The exact built artifact that ships in the Xibo widget. No test-only code paths. |
| Staging `BarPreferences` row | 3 remote-owned | Pre-seeded by the SPEC-CRWDQ-028 staging deploy; the test asserts the values arrive correctly, never writes them. |
| Staging `GameState` fixture | 3 remote-owned | The backend `RecordFixtureWorkflow` test driver from SPEC-CRWDQ-026 produces a deterministic `e2e-fake-nfl-1` game. |
| Time | system boundary | Real wall clock (this is a real e2e — no fake timers). Test polling uses `waitFor` with a 30 s ceiling. |
| Journal capture | 2 local-substitutable | Browser console + Playwright `page.on('console')` records widget journal events for post-run inspection. |

### Failure modes the smoke explicitly catches

- Widget bundle build broken (`window.crowdaqWidgetV2` undefined at boot).
- WS URL resolution fails (xiboIC stub returns the wrong shape).
- Missing `crowdaq.v1` subprotocol (the upgrade is rejected `400` → `open` never fires).
- `DeviceRegistration` payload schema drift (the test fails if `bar_id` / `display_id` / `player_sw_version` are missing, or if the legacy `capabilities` / `player_version` shape reappears).
- Re-push ordering regression (a server-side bug in `GameDeliveryService`).
- Theme CSS swap leaves the page un-styled (the assertion includes `data-theme` attribute presence).
- Heartbeat cadence regression (no outbound `Heartbeat` within 35 s).
- A non-`1000` WS close code on a graceful disconnect.

### Run-time budget

A single test, ≤ 45 s wall-clock budget including the 30 s heartbeat wait. CI total job time ≤ 5 minutes including build + tailnet join + browser launch.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- "real WS" — an actual `wss://` connection to the staging `GameDeliveryService` at path `/ws`, not a Node-side fake.
- "real `BarPreferences`" — the staging Postgres `crowdaq.bar_preferences` row, written by the SPEC-CRWDQ-028 ops scripts.
- "snapshot DOM assertion" — `expect(locator).toHaveText(...)` and `toMatchSnapshot(...)` over the score-panel subtree; serialized to `tests/e2e/__snapshots__/single-game.snap`.
- `crowdaq.v1` — the mandatory WS subprotocol (SPEC-CRWDQ-020).

## Acceptance Criteria

- [ ] `modules/widget-v2/tests/e2e/smoke.spec.ts` contains exactly one Playwright test ("widget v2 boots, registers, renders single_game, heartbeats, disconnects").
- [ ] The test connects to the staging `GameDeliveryService` URL via `wss://` at path `/ws` with the `crowdaq.v1` subprotocol — no mocked WS, no in-process server, no localhost fallback.
- [ ] The first observed outbound WS frame is a `DeviceRegistration` envelope whose payload is a valid SPEC-CRWDQ-017 `DeviceRegistrationPayload`: `bar_id` and `display_id` match the configured values, `player_sw_version` is non-empty, `last_seq` and `last_config_hash` are `null`. The test fails if the legacy `capabilities` field or a `player_version` field appears.
- [ ] The inbound frame sequence within the first 10 s contains, in order, the subsequence `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState` → `ProgramSlot` → `GameState` (other frames may interleave; the assertion is on the ordered subsequence per SPEC-CRWDQ-020 / D-GRH-49).
- [ ] Within 10 s of boot, the DOM contains `[data-testid="cdq-score"]` with home/away team names and scores matching the staging `e2e-fake-nfl-1` `GameState` fixture; the rendered `<section>` carries a `data-theme` attribute.
- [ ] Within 35 s of boot, exactly one outbound `Heartbeat` and one inbound `HeartbeatAck` are observed; the `Heartbeat` payload carries `player_local_ts` + `config_hash`; neither frame carries a `seq` field (SPEC-CRWDQ-017 — `Heartbeat` / `HeartbeatAck` are not seq-bearing). The assertion is presence + count, not seq-correlation.
- [ ] `WidgetPage.disconnect()` triggers a `WsClient.close()`; the WebSocket closes with WS close code `1000`; no `error` lifecycle event fires between the disconnect call and process exit.
- [ ] The widget bundle loaded is the exact production-build artifact — no test-only code path inside the widget, no shimmed `WebSocket`, no instrumented dispatcher.
- [ ] CI workflow `.github/workflows/widget-v2-e2e.yml` runs on PRs touching `modules/widget-v2/**`, joins the tailnet via the existing `tailscale/github-action@v2` step, and fails fast with `tailnet_unavailable` if the join fails (no mock fallback).
- [ ] Test wall-clock budget ≤ 45 s; CI job total ≤ 5 minutes.
- [ ] Out-of-scope template families (multi-game, fixtures, with-ads, recap, safe, ambient) and reconnect cases are NOT exercised here — they have their own e2e tests in subsequent slices.
- [ ] No tailnet credentials, no secrets, no long-lived tokens committed — secrets via GH Action secrets only.
