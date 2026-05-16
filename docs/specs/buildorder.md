# xibo-plugin spec build order

Dependency-linearized build sequence for the 16 `xibo-plugin` specs[^grill]. Each spec respects its `Blocked-by` constraint plus the milestone gating from `xibo/docs/specs/SPEC-CATALOG.md` (M1 → M2 → M3).

Generated: 2026-05-15

## Critical-path observations

1. **SPEC-CRWDQ-022 is the universal blocker.** Every render template + the journal ping consume the WS client + dispatcher. It must land before any template work starts.
2. **SPEC-CRWDQ-023 is the second blocker.** It introduces the shared render orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`) that every other template plugs into. After 023 the rest fan out in parallel.
3. **SPEC-CRWDQ-014 (ConfigPush) is independent of 022 in scope** but depends on backend SPEC-CRWDQ-013 landing first. It lives in M1.
4. **SPEC-CRWDQ-027 is the M2 gate** — its assertions require 014, 022, 023 plus backend's SPEC-CRWDQ-026 to be green.
5. **SPEC-CRWDQ-052 blocks SPEC-CRWDQ-053** because ambient falls back to safe_info on empty manifest.
6. **SPEC-CRWDQ-064 (AssetManifestStore) is a third early blocker** introduced by the grill amendments. It only blocks on 022, lands in M1, and unblocks every asset-bearing template (053 ambient, 041 with-ads, 065 single_game_with_ads) plus the override pre-fetch path (063). It consolidates the `AssetManifestStore` interface that 034/041/053 informally referenced.
7. **SPEC-CRWDQ-049 establishes the `overrideSuppressionState` token; SPEC-CRWDQ-063 writes it.** The two specs share a contract — 049 is the consumer (overlay reads), 063 is the producer (override handler writes). 063's first-cut wiring lands with S4 but the full surface (TTL, buffer, supersede) lands with the M2 overlay work in S10.
8. **SPEC-CRWDQ-065 is the heaviest fan-in among the new specs.** It composes 023 (single_game), 041 (AdPanel + grid shell), and 064 (AssetManifestStore for rotation). It is M3 work.
9. **SPEC-CRWDQ-066 (`fixtures_with_live_game`) composes 023 + 034 only.** It is the canonical S7 mixed-state composite — earlier than 065 in dependency order, lands in M2.

## M1 — Foundations

Specs that ship before the first end-to-end demo (S4 cut-line).

```
SPEC-CRWDQ-014 — Widget v2 ConfigPush consumer with local cache + apply
SPEC-CRWDQ-022 — Widget v2 WebSocket client + wire-protocol deserializer
SPEC-CRWDQ-023 — Widget v2 single_game render template
SPEC-CRWDQ-064 — Widget v2 AssetManifestStore                                (grill amendment)
```

Order within M1:
- `SPEC-CRWDQ-014` can run independently (its only blocker is backend SPEC-CRWDQ-013).
- `SPEC-CRWDQ-022` waits for backend SPEC-CRWDQ-017 (wire-protocol envelope + TS twin).
- `SPEC-CRWDQ-023` waits for `SPEC-CRWDQ-022` AND `SPEC-CRWDQ-014` (the pending-apply boundary contract).
- `SPEC-CRWDQ-064` waits for `SPEC-CRWDQ-022` only; runs in parallel with `SPEC-CRWDQ-023` and `SPEC-CRWDQ-014`. The store has no dependencies on the render orchestration.

Note: SPEC-CRWDQ-063 (`OverrideInjection` handler) is parented to S4 but listed under M2 below — it is blocked by SPEC-CRWDQ-049 (suppression-state contract), which lands in M2. The S4 catalog row remains the canonical home for the slice; the build order respects the 049 edge.

## M2 — First end-to-end demo + fan-outs

After SPEC-CRWDQ-023 lands, the remaining render templates fan out and run in parallel.

```
SPEC-CRWDQ-027 — Widget v2 e2e smoke test on player side                  (gates M2 cut)
SPEC-CRWDQ-031 — Widget v2 multiple_games (2x2 grid) render template
SPEC-CRWDQ-034 — Widget v2 fixtures render template
SPEC-CRWDQ-046 — Widget v2 recap render template
SPEC-CRWDQ-049 — Widget v2 overlay layer for MessagingLane render
SPEC-CRWDQ-052 — Widget v2 safe_info render template
SPEC-CRWDQ-053 — Widget v2 ambient render template
SPEC-CRWDQ-063 — Widget v2 OverrideInjection handler                      (grill amendment)
SPEC-CRWDQ-066 — Widget v2 fixtures_with_live_game template               (grill amendment)
```

Order within M2:
- `SPEC-CRWDQ-027` is the gate — once 014/022/023 plus backend 026 are green, 027 must pass before any of the other M2 templates merge.
- `SPEC-CRWDQ-031`, `034`, `046`, `049`, `052` can all run in parallel once 022/023 land.
- `SPEC-CRWDQ-053` must run after `SPEC-CRWDQ-052` (fallback target).
- `SPEC-CRWDQ-063` must run after `SPEC-CRWDQ-049` (suppression-state token contract). Soft dependency on `SPEC-CRWDQ-064` for pre-fetch; the override path works without pre-fetch via the activator's miss handling, so 063 can land before 064 if scheduling demands.
- `SPEC-CRWDQ-066` must run after `SPEC-CRWDQ-023` AND `SPEC-CRWDQ-034`. It can run in parallel with `SPEC-CRWDQ-046`, `049`, `052` once both blockers are green.

## M3 — Ads + observability

```
SPEC-CRWDQ-041 — Widget v2 ad render template + fixtures_with_ads composite
SPEC-CRWDQ-061 — Widget v2 player-side metrics ping
SPEC-CRWDQ-065 — Widget v2 single_game_with_ads template                  (grill amendment)
```

Order within M3:
- `SPEC-CRWDQ-041` waits for `SPEC-CRWDQ-031` AND `SPEC-CRWDQ-034` (composes both) plus backend `SPEC-CRWDQ-039`.
- `SPEC-CRWDQ-061` only needs `SPEC-CRWDQ-022` (for `WsClient` lifecycle) and `SPEC-CRWDQ-014` (for the `intervals.journal_sync` config field). Conceptually it can ship earlier — placed in M3 because the backend journal-read API (`SPEC-CRWDQ-059`) is also S13, and end-to-end assertions only make sense once both halves are live.
- `SPEC-CRWDQ-065` waits for `SPEC-CRWDQ-023` (single_game base), `SPEC-CRWDQ-041` (`AdPanel` + grid shell + `AdSlotResolver`), AND `SPEC-CRWDQ-064` (`AssetManifestStore`). It is the heaviest fan-in of any spec in the M3 set.

## Linearized ASCII graph

```
                                  [backend SPEC-CRWDQ-013]
                                              │
                                              ▼
       [backend SPEC-CRWDQ-017] ── SPEC-CRWDQ-014 ◀── ConfigPush wire publisher
                  │                           │
                  ▼                           │
            SPEC-CRWDQ-022 ◀──────────────────┘
                  │
                  ├──────────────── SPEC-CRWDQ-064 ── (AssetManifestStore)         [grill]
                  │                       │
                  ▼                       │
            SPEC-CRWDQ-023 ───────────── (shared render orchestration)
                  │
                  ├── SPEC-CRWDQ-027 ──── [needs backend SPEC-CRWDQ-026]
                  │
                  ├── SPEC-CRWDQ-031 ──── [needs backend SPEC-CRWDQ-030]
                  │           │
                  │           └─── SPEC-CRWDQ-041 ── [needs backend SPEC-CRWDQ-039]
                  │                          │
                  │                          └─── SPEC-CRWDQ-065 ◀── SPEC-CRWDQ-064  [grill]
                  │
                  ├── SPEC-CRWDQ-034 ──── [needs backend SPEC-CRWDQ-033]
                  │           │
                  │           ├─── (composed in 041)
                  │           └─── SPEC-CRWDQ-066 ── (fixtures + live tile)        [grill]
                  │
                  ├── SPEC-CRWDQ-046 ──── [needs backend SPEC-CRWDQ-045]
                  ├── SPEC-CRWDQ-049 ──── [needs backend SPEC-CRWDQ-048]
                  │           │
                  │           └─── SPEC-CRWDQ-063 ── (override handler)            [grill]
                  │                       ▲
                  │                       │  (soft) ──── SPEC-CRWDQ-064
                  │
                  ├── SPEC-CRWDQ-052 ──── [needs backend SPEC-CRWDQ-051]
                  │           │
                  │           └─── SPEC-CRWDQ-053 ── (fallback target)
                  │
                  └── SPEC-CRWDQ-061 ──── [needs backend SPEC-CRWDQ-059]
```

## Parallelism notes

After SPEC-CRWDQ-023 lands, eight template specs (031, 034, 046, 049, 052, 061, 064, 066) can run concurrently in separate agents — they don't share files. SPEC-CRWDQ-053 must serialize on 052 (fallback target). SPEC-CRWDQ-041 must serialize on 031 + 034 (it composes both). SPEC-CRWDQ-066 must serialize on 023 + 034 (composes both). SPEC-CRWDQ-063 must serialize on 049 (suppression token contract). SPEC-CRWDQ-065 must serialize on 023 + 041 + 064 (heaviest fan-in). SPEC-CRWDQ-064 itself only blocks on 022 and can land in M1 alongside 014/023. SPEC-CRWDQ-027 sits orthogonally as the M2 gate — it's a pure test spec touching no production code outside `tests/e2e/`.

## See also

- [`index.md`](index.md) — repo-level spec catalog.
- [`xibo/docs/specs/SPEC-CATALOG.md`](https://github.com/Atabong/xibo) — cross-repo source of truth, including the master build order across `crowdaq-backend`, `xibo-plugin`, `proxmox-infra`, `founding`.

[^grill]: The 2026-05-15 grill amendments added four specs (063, 064, 065, 066) and three decisions (D-GRH-74 R2 blob backend, D-GRH-75 ConfigPush.intervals, D-GRH-76 safe-mode reason split). SPEC-CRWDQ-064 promotes the `AssetManifestStore` interface — previously referenced informally by 034, 041, 053 — into an owned, M1-foundation spec. SPEC-CRWDQ-063 makes the `OverrideInjection` handler a first-class spec (was implicit in D-GRH-24 and D-SCHEMA-08). SPEC-CRWDQ-065 fills the D-GRH-30 mode #5 (`single_game_with_ads`) gap explicitly flagged in SPEC-CRWDQ-041's catalog-flag note. SPEC-CRWDQ-066 fills the D-GRH-30 mode #7 (`fixtures_with_live_game`) mixed-state composite that SPEC-CRWDQ-034 explicitly defers.
