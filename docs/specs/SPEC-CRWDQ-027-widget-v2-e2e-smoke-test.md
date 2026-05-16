---
spec_id: SPEC-CRWDQ-027
title: Widget v2 e2e smoke test on player side (real WS, real BarPreferences)
status: draft
parent: S4
area: player-runtime/widget-v2/tests/e2e
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-027 — Widget v2 e2e smoke test on player side (real WS, real BarPreferences)

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S4 — Coverage → record → render (end-to-end) |
| Plane epic | CRWDQ-5 |
| Decisions referenced | D-GRH-29, D-GRH-42, D-GRH-49, D-GRH-59, D-GRH-61 |
| Source files | `modules/widget-v2/**` (consumed end-to-end) |
| New files | `modules/widget-v2/tests/e2e/smoke.spec.ts`, `modules/widget-v2/tests/e2e/playwright.config.ts`, `modules/widget-v2/tests/e2e/fixtures/staging.env`, `modules/widget-v2/tests/e2e/page-objects/WidgetPage.ts`, `.github/workflows/widget-v2-e2e.yml` |
| Blocked by | SPEC-CRWDQ-026 (backend e2e suite — provides staging stack invariants), SPEC-CRWDQ-023 (single_game template), SPEC-CRWDQ-014 (ConfigPush consumer) |

## Module

`player-runtime :: widget-v2 :: tests/e2e` — a Playwright-driven smoke test running widget v2 in headless Chromium against the staging `GameDeliveryService`. Asserts the full re-push handshake (`DeviceRegistration` → `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState` → `GameState`), renders one `single_game` frame, observes a heartbeat round-trip, and disconnects cleanly.

## Current shape

- No e2e suite exists for v2 today. Widget v1 is exercised manually via `bardemo-*` screenshots (see repo root). The CI runs `composer lint`, twig validation, and the release-zip job — none of which open a browser or speak the v2 protocol.
- The crowdaq-backend repo carries SPEC-CRWDQ-026 — an integration suite that spins up NATS/Temporal/Postgres/AdminGateway/GameScheduler/BarPlayerSchedulerService/GameDeliveryService and asserts the backend pipeline. That suite uses a "mock player" (an in-process WS client) for its terminal assertion. It does not exercise the real widget.
- This spec adds the symmetric player-side test: real widget v2 build, real headless Chromium, real WS against the staging GameDeliveryService URL the backend suite stands up.

The split is intentional per SPEC-CATALOG decomposition decision #3: backend-side e2e cannot share fixtures with the widget repo without coupling them; the two suites assert opposite ends of the same pipeline.

## Proposed deep interface

### Test runner choice

Playwright. Reasons specific to this case:
- Real Chromium runtime — matches the bar-PC `xibo-player` Chromium runtime (the v1 widget already runs there; v2 inherits).
- Built-in WebSocket recording (`page.on('websocket')`) gives us the protocol-message-sequence assertion D-GRH-29 implies without instrumenting the widget itself.
- Snapshot DOM assertions via `locator(...).innerHTML()` + serialization, suitable for the single rendered frame.

### Test fixture: staging stack

```
modules/widget-v2/tests/e2e/fixtures/staging.env
  STAGING_GDS_WS_URL=wss://<tailnet-host>/widget-v2
  STAGING_DISPLAY_ID=bar-e2e-display-1
  STAGING_BAR_ID=bar-e2e
  STAGING_EXPECTED_GAME_ID=e2e-fake-nfl-1
```

The values are populated by the SPEC-CRWDQ-028 staging deploy. The widget v2 test loader reads `staging.env` and constructs the boot URL accordingly. No long-lived secrets — tailnet identity is the auth boundary (D-GRH-43).

### Page object

```ts
// modules/widget-v2/tests/e2e/page-objects/WidgetPage.ts
export class WidgetPage {
  constructor(private page: Page) {}

  /** Navigate to a static HTML host page that boots widget-v2 with the given config. */
  async open(opts: { gdsUrl: string; displayId: string }): Promise<void>;

  /** Resolves when the widget has emitted its `dispatcher_ready` lifecycle event. */
  async waitForDispatcherReady(): Promise<void>;

  /** Resolves when a PlannedState{single_game} has been activated and the score panel is in DOM. */
  async waitForSingleGameRendered(): Promise<void>;

  /** Returns the full ordered list of message_type values observed on the WS in both directions. */
  async observedProtocolSequence(): Promise<{ direction: 'out' | 'in'; messageType: string }[]>;

  /** Returns the rendered home/away/score text. */
  async readScorePanel(): Promise<{ home: string; away: string; homeScore: string; awayScore: string }>;

  /** Trigger graceful disconnect. */
  async disconnect(): Promise<void>;
}
```

### Boot harness

A minimal static HTML page under `modules/widget-v2/tests/e2e/host.html` loads the built widget bundle (same artifact the Xibo widget XML will load in production) and a tiny boot script that reads URL query params (`?gds=...&displayId=...`) and constructs the `WsClient`. This is the bridge from Playwright to the actual widget runtime — no shim, no harness-specific code paths inside the widget bundle.

### Assertion set

For the single test case:

1. **Boot.** `WidgetPage.open({...staging})` navigates to `host.html?gds=...&displayId=...`. The dispatcher's `open` lifecycle event must fire within 5 s.
2. **DeviceRegistration outbound.** The first observed outbound frame is `DeviceRegistration` with the configured `display_id`, `player_version` non-empty, `capabilities: ["jsonl"]`.
3. **Full re-push inbound.** The next inbound frames are, in order: `ConfigPush`, `ScheduleWindow`, `AssetManifest`, at least one `PlannedState`, at least one `GameState`. The test asserts the ordered subsequence — it does not assert other frames are absent (the server may interleave `ProgramSlot`, `Heartbeat`, etc. — those are not part of the D-GRH-61 ordered guarantee but are valid).
4. **Single-game DOM.** Within 10 s of boot, `WidgetPage.waitForSingleGameRendered()` resolves; the score panel contains home/away team names and scores matching the staging `GameState` fixture. Snapshot DOM assertion on the `[data-testid="cdq-score"]` subtree.
5. **Heartbeat round-trip.** Within 35 s of boot (allowing for 30 s cadence + 5 s slack), exactly one outbound `Heartbeat` and one inbound `HeartbeatAck` with matching `seq` are observed.
6. **Graceful disconnect.** `WidgetPage.disconnect()` triggers `WsClient.close()`; an outbound `ws_close_clean` frame is observed; no `error` lifecycle event fires.

### CI integration

`.github/workflows/widget-v2-e2e.yml` runs on PRs touching `modules/widget-v2/**`. Requires the staging stack to be reachable from the GH Actions runner — the runner joins the tailnet via the existing `tailscale/github-action@v2` step the xibo-plugin repo already uses for `bar-pc` smoke tests (precedent: see infra docs). If the tailnet join fails, the job fails fast with the error message `tailnet_unavailable: skipping widget-v2 e2e` — the workflow does NOT degrade to a mocked WS server, because that would invalidate the spec's "real WS" guarantee.

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
| `GameDeliveryService` WebSocket | 3 remote-owned | Real connection to staging URL — no mock, no proxy. |
| Chromium runtime | 1 in-process | Real Playwright Chromium. |
| Tailnet | 3 remote-owned | Real tailnet join via existing GH Actions step. |
| Widget v2 bundle | 1 in-process | The exact built artifact that ships in the Xibo widget. No test-only code paths. |
| Staging `BarPreferences` row | 3 remote-owned | Pre-seeded by SPEC-CRWDQ-028 staging deploy; the test asserts the values arrive correctly, never writes them. |
| Staging `GameState` fixture | 3 remote-owned | Backend `RecordFixtureWorkflow` test driver from SPEC-CRWDQ-026 produces a deterministic `e2e-fake-nfl-1` game. |
| Time | system boundary | Real wall clock (this is a real e2e — no fake timers). Test polling uses `waitFor` with 30 s ceiling. |
| Journal capture | 2 local-substitutable | Browser console + Playwright `page.on('console')` records widget journal events for post-run inspection. |

### Failure modes the smoke explicitly catches

- Widget bundle build broken (`window.crowdaqWidgetV2` undefined at boot).
- WS URL resolution fails (xiboIC stub returns wrong shape).
- `DeviceRegistration` frame schema drift (test fails on missing `capabilities` field).
- Re-push ordering regression (server-side bug in `GameDeliveryService`).
- Theme CSS swap leaves the page un-styled (the assertion includes `data-theme` attribute presence).
- Heartbeat cadence regression (no outbound `Heartbeat` within 35 s).

### Run-time budget

Single test, ≤ 45 s wall-clock budget including 30 s heartbeat wait. CI total job time ≤ 5 minutes including build + tailnet join + browser launch.

## Vocabulary

Reference: `xibo/docs/specs/SPEC-CATALOG.md`.

- "real WS" — actual `wss://` connection to the staging `GameDeliveryService`, not a Node-side fake.
- "real `BarPreferences`" — the staging Postgres `crowdaq.bar_preferences` row, written by SPEC-CRWDQ-028 ops scripts.
- "snapshot DOM assertion" — `expect(locator).toHaveText(...)` and `toMatchSnapshot(...)` over the score-panel subtree; serialized to `tests/e2e/__snapshots__/single-game.snap`.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-026 — provides the staging stack (NATS/Temporal/Postgres/services) + the deterministic `e2e-fake-nfl-1` game fixture.
- SPEC-CRWDQ-023 — single_game template exists and renders.
- SPEC-CRWDQ-014 — ConfigPush consumer is wired (else the theme swap assertion is meaningless).
- SPEC-CRWDQ-022 — WS client and dispatcher are wired (else nothing connects).

**Blocks (downstream):**

- SPEC-CRWDQ-028 — staging dashboards include the e2e job's pass/fail signal.
- Every subsequent widget-v2 template spec (031, 034, 041, 046, 049, 052, 053) extends this e2e — they each add a matching smoke test case under `tests/e2e/` once the corresponding backend slice lands.

## Acceptance Criteria

- [ ] `modules/widget-v2/tests/e2e/smoke.spec.ts` contains exactly one Playwright test ("widget v2 boots, registers, renders single_game, heartbeats, disconnects").
- [ ] The test connects to the staging `GameDeliveryService` URL via `wss://` — no mocked WS, no in-process server, no localhost fallback.
- [ ] The first observed outbound WS frame is `DeviceRegistration` with the configured `display_id`, `player_version` non-empty, `capabilities: ["jsonl"]`.
- [ ] The inbound frame sequence within the first 10 s contains, in order, `ConfigPush` → `ScheduleWindow` → `AssetManifest` → `PlannedState` → `GameState` (other frames may interleave; the assertion is on the ordered subsequence per D-GRH-61).
- [ ] Within 10 s of boot, the DOM contains `[data-testid="cdq-score"]` with home/away team names and scores matching the staging `e2e-fake-nfl-1` `GameState` fixture; `data-theme` attribute present.
- [ ] Within 35 s of boot, exactly one outbound `Heartbeat` and one inbound `HeartbeatAck` with matching `seq` are observed (D-GRH-59 30 s cadence + 5 s slack).
- [ ] `WidgetPage.disconnect()` triggers a clean close; no `error` lifecycle event between disconnect call and process exit.
- [ ] The widget bundle loaded is the exact production-build artifact — no test-only code path inside the widget, no shimmed `WebSocket`, no instrumented dispatcher.
- [ ] CI workflow `.github/workflows/widget-v2-e2e.yml` runs on PRs touching `modules/widget-v2/**`, joins the tailnet via the existing `tailscale/github-action@v2` step, and fails fast with `tailnet_unavailable` if the join fails (no mock fallback).
- [ ] Test wall-clock budget ≤ 45 s; CI job total ≤ 5 minutes.
- [ ] Out-of-scope template families (multi-game, fixtures, with-ads, recap, safe, ambient) and reconnect cases are NOT exercised here — they have their own e2e tests in subsequent slices.
- [ ] No tailnet credentials, no secrets, no long-lived tokens committed (per repo memory: bar = adversarial physical environment; e2e runner is GH Actions, but the same hygiene applies — secrets via GH Action secrets only).
