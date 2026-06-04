# PLAN-20260529-182239 — Widget v2 player runtime (M1 foundation slice)

Planner mode: **Spec-Impl**. 16 implementable `SPEC-CRWDQ` specs under `docs/specs/`
describe a greenfield `modules/widget-v2/` TypeScript subtree. This plan decomposes
them into implementation issues, ordered by `buildorder.md`, and isolates the **next
executable vertical slice (M1 foundations)**.

## Intent

Stand up the Widget v2 player runtime: replace the v1 SSE `EventSource` widget with a
single persistent JSONL WebSocket per display to the backend `GameDeliveryService`,
consuming the closed wire-protocol message set, applying bar preferences at runtime,
caching assets, and rendering business-mode templates (starting with `single_game`).
v2 ships as a **new** XML manifest (`<type>crowdaq-widget-v2</type>`) side-by-side with
the untouched v1 `modules/crowdaq-widget.xml`; cutover is operator-driven.

## Root cause / opportunity

The repo today is **PHP/XML-only** — there is no TypeScript toolchain, no `package.json`,
no `tsconfig`, no Vitest, no jsdom, no Playwright. CI runs PHP lint + OpenAPI contract
validation only (`.github/workflows/ci.yml`). Every widget-v2 spec assumes a TS build,
Vitest+jsdom unit tests, and imports its wire types from the crowdaq-backend
**SPEC-CRWDQ-017 wire barrel** via the unresolved placeholder import `<spec-017-wire-barrel>`.

Therefore the first unit of work is **not** a spec — it is a toolchain + wire-module
integration scaffold that every spec compiles and tests against. Once that lands, the
build order fans out cleanly.

## Domain boundaries

`player-runtime :: widget-v2`, decomposed into bounded contexts (one subtree each):

- **transport** — physical WS session, JSONL deserialize, per-message-type dispatch,
  heartbeat liveness, seq-gap recovery. (SPEC-CRWDQ-022)
- **config** — ConfigPush consumer: validate, persist (LocalStorage), queue dwell-boundary
  apply, drift detection. (SPEC-CRWDQ-014)
- **render** — shared orchestration: PlannedState activation, ProgramSlot resolution,
  GameState store, dwell timer, transition executor, **AssetManifestStore** (asset cache).
  (SPEC-CRWDQ-023 orchestration + SPEC-CRWDQ-064 asset store)
- **templates** — per business-mode render families: single-game, multi-game, fixtures,
  recap, safe-info, ambient, with-ads composites. (023/031/034/041/046/052/053/065)
- **overlays** — MessagingLane out-of-band overlay layer. (SPEC-CRWDQ-049)
- **observability** — player-side journal store + metrics-ping sync. (SPEC-CRWDQ-061)
- **tests/e2e** — Playwright smoke against real staging GDS. (SPEC-CRWDQ-027)

## Domain core

Framework-free TypeScript: the render orchestration (activator, resolvers, stores, timers,
transition executor), the ConfigPush validation+apply state machine, and the asset
manifest diff/eviction logic. Pure logic over wire payloads, no DOM coupling beyond the
template adapters, no direct browser-API calls in core (those are ports).

## Ports

- `WsClient` — WebSocket transport boundary (injected `FakeWebSocket` in tests).
- `AssetFetcher` — HTTP `fetch()` boundary.
- `AssetCache` — IndexedDB persistence boundary (`MapAssetCache` in tests).
- `PreferenceStore` — LocalStorage persistence boundary (real jsdom storage in tests).
- journal sink — observability boundary (in-memory in tests).
- clock — `Date.now` / `performance.now` / timers (Vitest fake timers; system boundary).
- `TransitionExecutor` timing surface — animation boundary (`InstantTransitionAdapter` in tests).

## Adapters

Real browser `WebSocket`, `fetch()`, `IndexedDB`, `LocalStorage`, CSS `<link>` injection.
The wire-protocol types + `parseLine` / `buildEnvelope` / `serialize` helpers are an
**imported in-process dependency** from the crowdaq-backend SPEC-CRWDQ-017 module — not
an adapter the plugin owns; used real under test (INV-FACTORY-16).

## Application / use cases

1. Boot → open WS (`crowdaq.v1` subprotocol) → send `DeviceRegistration` → consume re-push
   sequence (`ConfigPush → ScheduleWindow → AssetManifest → PlannedState → ProgramSlot →
   GameState`).
2. ConfigPush received → validate closed-shape → persist → queue apply at next dwell boundary.
3. PlannedState{single_game} activated → resolve ProgramSlot + theme → run transition →
   mount template → arm dwell → re-render on GameState/GameEvent.
4. AssetManifest received → diff → pre-fetch → cache (hash-verified) → serve via get/ensure.
5. Heartbeat cadence + ack liveness → reconnect on loss; seq-gap → GameStateRequest recovery.

## Composition root

The widget bundle boot script (loaded by the v2 XML manifest stencil; mirrored by the e2e
`host.html`): reads `xiboIC.info()`/URL params, constructs `WsClient` with `WsClientConfig`,
constructs the `Dispatcher`, registers each per-message-type handler (`ConfigPushHandler`,
`AssetManifestStore.apply`, `PlannedStateActivator.activate`, GameState/GameEvent handlers),
threads the shared render-orchestration context object into the template families. The
boot script is exercised only by SPEC-CRWDQ-027 e2e — unit specs construct their slice
directly.

## Test strategy (per-dependency)

Two global invariants gate all suites:
- **INV-FACTORY-16** — no mocking of internal collaborators. Real `Dispatcher`,
  `GameStateStore`, `ProgramSlotResolver`, `PreferenceStore`, `AssetCache`,
  `AssetEvictionPolicy`, hash verifier, and the imported wire module are under test.
- **INV-FACTORY-17** — only system boundaries + remote-owned deps are substituted.

| Dependency | Category | Substitute |
|-----------|----------|-----------|
| Browser `WebSocket` | 3 remote-owned | `FakeWebSocket` adapter (records subprotocol/send/close) |
| Server frames | 3 remote-owned | JSONL fixtures `tests/fixtures/wire/*.jsonl` (full envelopes) |
| SPEC-CRWDQ-017 wire module | 1 in-process | Real import — no mock |
| Per-message-type handlers | 2 local-substitutable | `RecordingHandler` |
| `AssetFetcher` (HTTP) | 2 local-substitutable | `FakeAssetFetcher` (success/fail/slow/hash-mismatch) |
| `AssetCache` (IndexedDB) | 1 in-process / 2 | `MapAssetCache` in-memory |
| `PreferenceStore` (LocalStorage) | 1 in-process | Real jsdom storage |
| `TransitionExecutor` timing | 2 local-substitutable | `InstantTransitionAdapter` |
| `ConfigPushHandler` pending-apply | 2 local-substitutable | `PendingApplyProbe` / `ApplyQueueProbe` |
| Theme CSS injection | 2 local-substitutable | `StyleSheetRegistry` recorder |
| Journal sink | 2 local-substitutable | In-memory journal |
| Clock / timers | system boundary | Vitest fake timers; frozen `Date.now`/`performance.now` |
| Staging GDS / tailnet (e2e only) | 3 remote-owned | Real `wss://` + real tailnet — no fallback |

DOM is real (jsdom) for unit, real Chromium for e2e. Each spec's AC enumerates its own
test cases verbatim; the Generator implements them as-listed.

## Risks + assumptions

- **R1 (load-bearing): the SPEC-CRWDQ-017 wire module import is unresolved.** Every spec
  imports from `<spec-017-wire-barrel>`. The integration mechanism (npm git-dependency /
  vendored types / git submodule / published package) is undecided and the module may not
  yet exist on a consumable branch. ISS-001 must resolve this before any spec compiles.
- **R2:** the backend SPEC-CRWDQ-017 `ConfigPushPayload` must carry `display_id` and the
  full 9-value `BusinessMode` enum, or SPEC-CRWDQ-014's closed-shape validator rejects real
  frames. The spec flags this as a SPEC-CRWDQ-017 gap to confirm.
- **R3:** SPEC-CRWDQ-027 e2e depends on backend SPEC-CRWDQ-026 (integration stack) and
  SPEC-CRWDQ-028 (staging deploy) being green and reachable over tailnet from CI. Not
  satisfiable from this repo alone — gated, not blocking the unit slices.
- **R4:** `AdSlot` delivery to the player is a known backend gap; SPEC-CRWDQ-023's ad_slot
  branch + SPEC-CRWDQ-041/065 ad creative paint are contract-pinned but mostly unreachable
  until backend delivery lands. Implement the placeholder/empty-overlay path now.
- **Assumption:** Vitest + jsdom is the unit stack (every spec says so) and Playwright the
  e2e stack; no conflicting toolchain preference exists in-repo.
- **Assumption:** the v2 subtree is additive — v1 (`modules/crowdaq-widget.xml`, PHP CI
  gates) is untouched; the new TS CI job is additive to `.github/workflows/ci.yml`.

## Open questions for human

1. **Wire-module integration (BLOCKER for ISS-001).** How does `modules/widget-v2/` import
   the SPEC-CRWDQ-017 wire barrel from crowdaq-backend?
   *Recommended:* npm dependency on the backend package via git URL pinned to a tag (no
   `@latest`), re-exported through a single `modules/widget-v2/src/wire.ts` shim so all
   spec imports point at one local path; swap the underlying source if the backend later
   publishes to a registry. Confirms one source of wire truth (INV-FACTORY-16) without
   vendoring drift.
2. **Does the SPEC-CRWDQ-017 module exist on a consumable ref yet?** If not, ISS-001 should
   land a thin **type-only `.d.ts` mirror generated from SPEC-CRWDQ-017** as a temporary
   shim, with a tracking issue to replace it with the real import once the backend publishes.
   *Recommended:* proceed with the generated-from-spec shim to unblock the slice; do not
   hand-author divergent types.
3. **SPEC-CRWDQ-022 `4004 unknown_bar` reconnect ceiling.** Spec recommends 3 consecutive
   `4004` closes → terminal error state, stop reconnecting until layout republish.
   *Recommended:* implement the 3-strike ceiling as specified; flag to backend owner.

## Out of scope

- **SPEC-CRWDQ-063 (OverrideInjection handler)** — STATUS: BLOCKED. No backend producer/
  delivery path for `OverrideInjection` frames exists (verified against crowdaq-backend
  source). Design is complete; **must NOT be scheduled** until a backend producer lands.
- **SPEC-CRWDQ-066 (fixtures_with_live_game)** — STATUS: BLOCKED. The business mode does not
  exist in the backend's closed 8-member `businessMode` union and the dual-id `ProgramSlot`
  it needs is structurally impossible to produce. **Must NOT be scheduled.**
- v1 widget changes; PHP data-provider; any backend (crowdaq-backend) work; visual/pixel
  regression; reconnect e2e (stays in 022 unit suite).

## Decomposition — next vertical slice

`depends_on` encodes the `buildorder.md` graph. **The next executable slice is ISS-001
through ISS-005 (M1 foundations).** ISS-006+ are subsequent slices listed here for the
full Spec-Impl decomposition; they unblock as their dependencies close. The Generator
updates each spec's frontmatter `status` to `in-progress` at start and `implemented` when
done.

### M1 — next slice (executable now)

- **ISS-PLAN-20260529-182239-001 — Scaffold widget-v2 TypeScript toolchain + SPEC-CRWDQ-017 wire-module integration**
  - Acceptance sketch:
    - `modules/widget-v2/package.json`, `tsconfig.json`, `vitest.config.ts` exist; `npm test` runs Vitest+jsdom green on a trivial smoke test.
    - jsdom environment configured; `crypto.subtle`, `LocalStorage`, `IndexedDB` shims available to tests.
    - A single `modules/widget-v2/src/wire.ts` re-exports `Envelope`, all `*Payload` types, the 20-value `MessageType`, `CHANNELS`, `canonicalChannel`, `parseLine`, `buildEnvelope`, `serialize`, and the seven `WireError` codes from the SPEC-CRWDQ-017 source (per OQ-1/OQ-2 resolution).
    - ESLint + a type-check gate; no `@latest` version pins.
    - `.github/workflows/ci.yml` gains an additive Node job running `npm ci && npm test` scoped to `modules/widget-v2/**`; PHP jobs unchanged.
    - v1 `modules/crowdaq-widget.xml` untouched; build produces a v2 bundle artifact entry point.
  - Depends on: SPEC-CRWDQ-017 (crowdaq-backend, external) — resolve via OQ-1/OQ-2.
  - Domain context: composition/build (no bounded context); establishes the wire port for all specs.
  - Verification: `npm test` green in CI on a placeholder spec; a sample real-import test asserts `parseLine` round-trips a fixture envelope (proves the wire integration, not a stub).

- **ISS-PLAN-20260529-182239-002 — SPEC-CRWDQ-022 WebSocket client + wire-protocol deserializer** (`docs/specs/SPEC-CRWDQ-022-widget-v2-websocket-client.md`)
  - Acceptance sketch:
    - `transport/{WsClient,Deserializer,Dispatcher,Heartbeat,GameStateRequest,types}.ts` exported per the spec interfaces.
    - `connect()` opens with subprotocol `crowdaq.v1`, sends `DeviceRegistration` first on every open, resolves on first server frame.
    - `Deserializer.parse` wraps real `parseLine`, never throws; emits `empty_line` / `parse_error{reason∈7 WireError codes}` / typed `ServerFrame`.
    - `Dispatcher.register` one-handler-per-type (`DuplicateHandlerError`); synchronous receipt-order dispatch; per-`game_id` seq tracking for active-ProgramSlot games only.
    - Heartbeat 30s cadence + `ackTimeoutMs` liveness close (1000) → reconnect; exponential full-jitter backoff; reconnect triggers exactly per spec (incl. 4004 3-strike ceiling).
    - Seq-gap → single coalesced `GameStateRequest`; `GameState` snapshot re-baselines.
    - Schema violations + binary + >1MB frames journaled+dropped, never reach handlers.
  - Depends on: ISS-001.
  - Domain context: transport bounded context; port = `WsClient` (FakeWebSocket); consumes wire module.
  - Verification: Vitest suite over `tests/transport/*` with `tests/fixtures/wire/re-push-happy.jsonl` — handler order, parse-error markers, heartbeat/reconnect via fake timers, seq-gap coalescing all green; no mock of Deserializer/Dispatcher/Heartbeat/wire module.

- **ISS-PLAN-20260529-182239-003 — SPEC-CRWDQ-014 ConfigPush consumer with local cache + apply** (`docs/specs/SPEC-CRWDQ-014-widget-v2-configpush-consumer.md`)
  - Acceptance sketch:
    - `config/{ConfigPushHandler,PreferenceStore,ApplyPreferenceState,types}.ts`; wire types imported (no hand-rolled duplicates).
    - `handle()` never throws; returns `first_push|unchanged|replaced|rejected`; closed-shape validation of the 5 payload keys (incl. required `display_id`) + 10 `BarPreferencesWire` keys.
    - Theme three-state + coupling/extra-key rejections; IANA TZ via `Intl`; positive-safe-int `intervals`/`cache_ceiling_bytes`; `config_hash_missing`.
    - Persists full `ConfigPushPayload` to LocalStorage `crowdaq.widgetV2.barPreferences`; hash-equal = zero writes + 1 journal; hash-diff = save + evict + single `queueApply`.
    - `queueApply` single pending slot (replace not append); `superseded_by` journaling; no render-loop port.
  - Depends on: ISS-001, ISS-002.
  - Domain context: config bounded context; ports = `PreferenceStore` (real jsdom LocalStorage), asset-cache eviction (`InMemoryAssetCacheAdapter`), apply-queue probe.
  - Verification: Vitest+jsdom `tests/config/*` covers first/hash-match/hash-diff, schema-invalid (missing+extra+missing `display_id`), theme/`fallback_mode_order`/`intervals` violations, TZ, reconnect idempotency, supersede, full round-trip.

- **ISS-PLAN-20260529-182239-004 — SPEC-CRWDQ-064 AssetManifestStore** (`docs/specs/SPEC-CRWDQ-064-widget-v2-asset-manifest-store.md`)
  - Acceptance sketch:
    - `render/{AssetManifestStore,AssetCache,AssetFetcher,AssetEvictionPolicy}.ts` per interfaces.
    - `apply()` registered as `AssetManifest` control-channel handler; reads `frame.payload`; idempotent on identical (version, asset set); diff → stale-flag → promote → eager pre-fetch (cap 4, `needed_by` then lex order) → notify → journal.
    - `get()` synchronous hot-map read; `ensure()` fetch-on-demand with in-flight de-dup, retry, `AssetFetchError` on unknown id; SHA-256 verify (mismatch rejects, no write, journal).
    - Eviction: stale-first then LRU to ≤90% budget; persistence survives restart over seeded cache; IndexedDB-unavailable degrades in-memory + journal.
  - Depends on: ISS-001, ISS-002.
  - Domain context: render/asset-manifest bounded context; ports = `AssetFetcher` (FakeAssetFetcher), `AssetCache` (MapAssetCache), clock; real eviction policy + hash verifier.
  - Verification: Vitest `tests/render/asset-manifest/*` covers apply happy/idempotent, hit/miss, version-bump re-fetch, concurrent de-dup, pre-fetch cap, stale + LRU eviction, hash mismatch, restart survival, IndexedDB-unavailable, subscribe fanout.

- **ISS-PLAN-20260529-182239-005 — SPEC-CRWDQ-023 single_game template + shared render orchestration** (`docs/specs/SPEC-CRWDQ-023-widget-v2-single-game-template.md`)
  - Acceptance sketch:
    - `render/{PlannedStateActivator,ProgramSlotResolver,GameStateStore,DwellTimer,TransitionExecutor}.ts` + `templates/single-game/{SingleGameTemplate.ts,single-game.html,single-game.css}`.
    - Activator registered as `PlannedState` handler; branches on `business_mode==='single_game'`; idempotent on repeat `state_id`; buffers when ProgramSlot missing (5s timeout → fallback).
    - `primary_game_id` read from ProgramSlot (never a PlannedState.game_id); null cases → placeholder + `template_render_fallback` + dwell still armed.
    - 3-state theme resolution (`set`/`default`/`unset` preserved distinctly) per-slot override → bar `ThemeChoiceWire` → boot default; CSS swap only at dwell boundary on pending apply.
    - `GameStateStore` snapshot (always-apply, re-baseline) + event (seq-ordered, regression dropped) + `lastEvent`; subscription re-render without transition.
    - `TemplateInstance.reconcile?` optional contract + `TemplateReconcileEvent` union + activator dispatch/gate/journal rules; bare `SingleGameInstance` omits `reconcile?` (skip path).
    - `ad_slot_id` branch: null → bare mount; non-null → composite shell + empty overlay placeholder + `ad_slot_payload_unavailable` journal (AdSlotResolver probe).
  - Depends on: ISS-002, ISS-003 (and soft, non-blocking: ISS-004).
  - Domain context: render orchestration + templates/single-game; ports = Dispatcher (real), GameStateStore/ProgramSlotResolver (real), DwellTimer (fake timers), TransitionExecutor (InstantTransitionAdapter), AdSlotResolver/PendingApply/StyleSheetRegistry probes, journal.
  - Verification: Vitest+jsdom `tests/templates/single-game/*` covers happy path, re-push order, null program_slot/primary_game, idempotent, supersede, theme (3 paths), pending apply, seq regression, last-moment overlay, transition miss, dwell boundary, reconcile dispatch (5 cases), overlay-ad branch (4 cases).

### M2 — subsequent slice (unblocks after ISS-005)

- **ISS-PLAN-20260529-182239-006 — SPEC-CRWDQ-027 e2e smoke test** — depends ISS-003, ISS-005 + backend SPEC-CRWDQ-026/028 (external; gated by R3). Playwright `tests/e2e/*` + `host.html` + `.github/workflows/widget-v2-e2e.yml`; real `wss://` staging GDS, tailnet join, no mock fallback. M2 cut gate. Verification: the single smoke test asserts boot→DeviceRegistration→re-push subsequence→single_game DOM→heartbeat round-trip→clean 1000 close.
- **ISS-PLAN-20260529-182239-007 — SPEC-CRWDQ-031 multiple_games (2x2 grid) template + dwell** — depends ISS-005. `templates/multi-game/*` + `CardSet`; implements `reconcile?` card add/remove. Verification: grid render + dwell + card reconcile tests.
- **ISS-PLAN-20260529-182239-008 — SPEC-CRWDQ-034 fixtures template** — depends ISS-005, ISS-004. `templates/fixtures/*` + `render/FixtureListStore.ts`; badge assets via AssetManifestStore. Verification: fixture catalog render + feed_status + badge-miss fallback tests.
- **ISS-PLAN-20260529-182239-009 — SPEC-CRWDQ-046 recap template** — depends ISS-005, ISS-008, ISS-004. `templates/recap/*`. Verification: recap render tests.
- **ISS-PLAN-20260529-182239-010 — SPEC-CRWDQ-049 MessagingLane overlay** — depends ISS-005. `overlays/{MessagingLaneOverlay,MessagingLaneStore,OverlayLayer}.ts`; establishes `overrideSuppressionState` token (consumer side). Verification: overlay render + suppression-state tests.
- **ISS-PLAN-20260529-182239-011 — SPEC-CRWDQ-052 safe_info template** — depends ISS-005, ISS-003, ISS-004. `templates/safe-info/*` + `render/SafeStateController.ts`. Verification: safe-mode render + reason-split tests.
- **ISS-PLAN-20260529-182239-012 — SPEC-CRWDQ-053 ambient template** — depends ISS-011 (fallback target), ISS-004. `templates/ambient/*` + `AmbientPlaylist`; consumes `manifestEntries()` `ambient:` prefix filter. Verification: ambient playlist + empty-manifest→safe_info fallback tests.
- **ISS-PLAN-20260529-182239-013 — SPEC-CRWDQ-061 player-side metrics ping** — depends ISS-002, ISS-003. `observability/{JournalStore,JournalSyncClient,JournalBatcher,types}.ts`; HTTP `JournalSync` POST per D-GRH-52 using `intervals.journal_sync_ms`. Verification: batch + sync-client + interval tests.

### M3 — subsequent slice (unblocks after M2 fan-outs)

- **ISS-PLAN-20260529-182239-014 — SPEC-CRWDQ-041 ad render template + fixtures_with_ads composite** — depends ISS-007, ISS-008, ISS-004 (+ backend SPEC-CRWDQ-039). `templates/with-ads/{AdPanel,MultiGameWithAdsTemplate,FixturesWithAdsTemplate}.ts` + `render/AdSlotResolver.ts`. Verification: ad-panel + composite render + ad-asset-cache-miss tests.
- **ISS-PLAN-20260529-182239-015 — SPEC-CRWDQ-065 single_game overlay-ad rendering** — depends ISS-005, ISS-014, ISS-004. `templates/with-ads/SingleGameOverlayAd.ts`; implements the overlay composite the SPEC-CRWDQ-023 activator delegates to. Verification: overlay-ad creative paint + z-order + cache-miss tests (contract-pinned pending backend AdSlot delivery, R4).

### Blocked — not scheduled

- **SPEC-CRWDQ-063** (OverrideInjection handler) — STATUS: BLOCKED (no backend producer).
- **SPEC-CRWDQ-066** (fixtures_with_live_game) — STATUS: BLOCKED (mode + dual-id ProgramSlot impossible).

Re-evaluate both when the backend lands the missing producer/mode; designs are complete.
