# xibo-plugin spec build order

Dependency-linearized build sequence for the 12 `xibo-plugin` specs. Each spec respects its `Blocked-by` constraint plus the milestone gating from `xibo/docs/specs/SPEC-CATALOG.md` (M1 → M2 → M3).

Generated: 2026-05-15

## Critical-path observations

1. **SPEC-CRWDQ-022 is the universal blocker.** Every render template + the journal ping consume the WS client + dispatcher. It must land before any template work starts.
2. **SPEC-CRWDQ-023 is the second blocker.** It introduces the shared render orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`) that every other template plugs into. After 023 the rest fan out in parallel.
3. **SPEC-CRWDQ-014 (ConfigPush) is independent of 022 in scope** but depends on backend SPEC-CRWDQ-013 landing first. It lives in M1.
4. **SPEC-CRWDQ-027 is the M2 gate** — its assertions require 014, 022, 023 plus backend's SPEC-CRWDQ-026 to be green.
5. **SPEC-CRWDQ-052 blocks SPEC-CRWDQ-053** because ambient falls back to safe_info on empty manifest.

## M1 — Foundations

Specs that ship before the first end-to-end demo (S4 cut-line).

```
SPEC-CRWDQ-014 — Widget v2 ConfigPush consumer with local cache + apply
SPEC-CRWDQ-022 — Widget v2 WebSocket client + wire-protocol deserializer
SPEC-CRWDQ-023 — Widget v2 single_game render template
```

Order within M1:
- `SPEC-CRWDQ-014` can run independently (its only blocker is backend SPEC-CRWDQ-013).
- `SPEC-CRWDQ-022` waits for backend SPEC-CRWDQ-017 (wire-protocol envelope + TS twin).
- `SPEC-CRWDQ-023` waits for `SPEC-CRWDQ-022` AND `SPEC-CRWDQ-014` (the pending-apply boundary contract).

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
```

Order within M2:
- `SPEC-CRWDQ-027` is the gate — once 014/022/023 plus backend 026 are green, 027 must pass before any of the other M2 templates merge.
- `SPEC-CRWDQ-031`, `034`, `046`, `049`, `052` can all run in parallel once 022/023 land.
- `SPEC-CRWDQ-053` must run after `SPEC-CRWDQ-052` (fallback target).

## M3 — Ads + observability

```
SPEC-CRWDQ-041 — Widget v2 ad render template + fixtures_with_ads composite
SPEC-CRWDQ-061 — Widget v2 player-side metrics ping
```

Order within M3:
- `SPEC-CRWDQ-041` waits for `SPEC-CRWDQ-031` AND `SPEC-CRWDQ-034` (composes both) plus backend `SPEC-CRWDQ-039`.
- `SPEC-CRWDQ-061` only needs `SPEC-CRWDQ-022` (for `WsClient` lifecycle) and `SPEC-CRWDQ-014` (for the `intervals.journal_sync` config field). Conceptually it can ship earlier — placed in M3 because the backend journal-read API (`SPEC-CRWDQ-059`) is also S13, and end-to-end assertions only make sense once both halves are live.

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
                  ▼
            SPEC-CRWDQ-023 ───────────── (shared render orchestration)
                  │
                  ├── SPEC-CRWDQ-027 ──── [needs backend SPEC-CRWDQ-026]
                  │
                  ├── SPEC-CRWDQ-031 ──── [needs backend SPEC-CRWDQ-030]
                  │           │
                  │           └─── SPEC-CRWDQ-041 ── [needs backend SPEC-CRWDQ-039]
                  │
                  ├── SPEC-CRWDQ-034 ──── [needs backend SPEC-CRWDQ-033]
                  │           │
                  │           └─── (composed in 041)
                  │
                  ├── SPEC-CRWDQ-046 ──── [needs backend SPEC-CRWDQ-045]
                  ├── SPEC-CRWDQ-049 ──── [needs backend SPEC-CRWDQ-048]
                  ├── SPEC-CRWDQ-052 ──── [needs backend SPEC-CRWDQ-051]
                  │           │
                  │           └─── SPEC-CRWDQ-053 ── (fallback target)
                  │
                  └── SPEC-CRWDQ-061 ──── [needs backend SPEC-CRWDQ-059]
```

## Parallelism notes

After SPEC-CRWDQ-023 lands, six template specs (031, 034, 046, 049, 052, 061) can run concurrently in separate agents — they don't share files. SPEC-CRWDQ-053 is the only one that must serialize on 052. SPEC-CRWDQ-041 must serialize on 031 + 034 (it composes both). SPEC-CRWDQ-027 sits orthogonally as the M2 gate — it's a pure test spec touching no production code outside `tests/e2e/`.

## See also

- [`index.md`](index.md) — repo-level spec catalog.
- [`xibo/docs/specs/SPEC-CATALOG.md`](https://github.com/Atabong/xibo) — cross-repo source of truth, including the master build order across `crowdaq-backend`, `xibo-plugin`, `proxmox-infra`, `founding`.
