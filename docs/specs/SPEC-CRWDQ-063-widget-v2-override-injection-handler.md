---
spec_id: SPEC-CRWDQ-063
title: Widget v2 OverrideInjection handler
status: draft
parent: S4
area: player-runtime/widget-v2/overrides
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-063 — Widget v2 OverrideInjection handler

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S4 — End-to-end demo (initial wiring); expanded surface lands with S9 / S10 |
| Plane epic | CRWDQ-5 (initial wiring), CRWDQ-10 / CRWDQ-11 (full surface) |
| Decisions referenced | D-GRH-24, D-SCHEMA-08, D-GRH-58, D-GRH-76 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed); `modules/widget-v2/src/render/PlannedStateActivator.ts` (consumed); `modules/widget-v2/src/render/DwellTimer.ts` (consumed); `modules/widget-v2/src/render/TransitionExecutor.ts` (consumed) |
| New files | `modules/widget-v2/src/overrides/OverrideInjectionHandler.ts`, `modules/widget-v2/src/overrides/OverrideSuppressionState.ts`, `modules/widget-v2/src/overrides/OverrideTimeoutClock.ts`, `modules/widget-v2/tests/overrides/*.test.ts` |
| Blocked by | SPEC-CRWDQ-022 (WS client + dispatcher), SPEC-CRWDQ-049 (overlay-suppression token contract — defines `overrideSuppressionState` shape this spec writes to) |

## Module

`player-runtime :: widget-v2 :: overrides` — the player-side handler for `OverrideInjection` frames. Subscribes via `Dispatcher`, cancels the active `DwellTimer`, runs the override transition, mounts the override's `PlannedState`-shaped payload through the existing `PlannedStateActivator`, writes the `overrideSuppressionState` token consumed by SPEC-CRWDQ-049, manages the override's own dwell, and resolves cleanly on natural rotation, supersede, or TTL/timeout.

This spec owns the override path. The shared render orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`) is reused unchanged from SPEC-CRWDQ-023 — the override is not a separate template family, it is a dispatch path that re-enters the activator with the override's embedded `PlannedState` shape.

## Current shape

- No override handling in v1. The MVP widget has no out-of-band interrupt path; SSE events mutate text in place.
- D-GRH-24 establishes three override trigger categories (game lifecycle transition, excitement threshold, human operator) and the dwell-bypass rule: overrides bypass D-DWELL-01 (15s minimum dwell for mode change) and D-DWELL-02 (8s minimum for in-mode switch). The player implements bypass; the backend owns trigger semantics.
- D-SCHEMA-08 establishes the wire shape: `override_id`, `fires_at`, `interrupt_class` (`exceptional_override | major_sports_moment`), `business_mode`, `template_id`, `theme_id`, `dwell_target_ms`, `transition`, `program_slot_id`, `ad_slot_id`. The same fields a `PlannedState` carries, plus override-specific framing.
- D-GRH-58 establishes the rendering priority stack: `OverrideInjection` > `PlannedState` > `MessagingLane`. The override suppresses messaging-lane overlays for its full lifetime.
- D-GRH-76 splits safe-mode reasons: backend-planned safe (`safe_reason`) is patron-visible; player-runtime safe (`runtime_reason`) is journal-only. Override TTL/timeout-driven safe falls in the runtime bucket — journal it; do not render an enum-specific copy on screen.

## Proposed deep interface

```ts
// modules/widget-v2/src/overrides/OverrideInjectionHandler.ts
export interface OverrideInjectionHandler {
  /**
   * Registered as the Dispatcher handler for `OverrideInjection`.
   * Cancels the active dwell, runs the override transition, mounts
   * the override's PlannedState shape via PlannedStateActivator,
   * sets overrideSuppressionState.isActive=true, arms the override
   * dwell. Idempotent on duplicate override_id.
   */
  handle(frame: OverrideInjectionFrame): Promise<void>;
}

export interface OverrideInjectionFrame {
  message_type: 'OverrideInjection';
  override_id: string;
  fires_at: string;                      // ISO 8601 UTC; D-SCHEMA-08
  interrupt_class: 'exceptional_override' | 'major_sports_moment';
  business_mode: string;                 // routed through PlannedStateActivator
  template_id: string;
  theme_id: string | null | '__unset__';
  dwell_target_ms: number;
  transition: { variant: string; duration_ms: number };
  program_slot_id: string | null;
  ad_slot_id: string | null;
}
```

```ts
// modules/widget-v2/src/overrides/OverrideSuppressionState.ts
/**
 * The shared token contract established by SPEC-CRWDQ-049 (consumer)
 * and written by this spec (producer). Single source of truth for
 * "is an override currently active." Listener fanout used by
 * MessagingLaneOverlay and any future overlay that must hide during
 * overrides (D-GRH-58 binary suppression).
 */
export interface OverrideSuppressionState {
  readonly isActive: boolean;
  setActive(active: boolean): void;
  subscribe(listener: (active: boolean) => void): () => void;
}
```

```ts
// modules/widget-v2/src/overrides/OverrideTimeoutClock.ts
/**
 * Wall-clock arm against `fires_at + dwell_target_ms`. Separate from
 * the standard DwellTimer because overrides have two independent
 * timing surfaces: the dwell of the override's own rendered slot
 * (DwellTimer, monotonic, same shape as a regular PlannedState), and
 * the wall-clock TTL after which a missed / stuck override is force-
 * cleared (this timer).
 */
export interface OverrideTimeoutClock {
  /** Arm against absolute wall time. Returns a cancel handle. */
  armUntil(wallClockEnd: Date, onTimeout: () => void): () => void;
}
```

### Wiring

The override handler is registered against the control channel:

```ts
dispatcher.register('OverrideInjection', (frame) => handler.handle(frame), 'control');
```

`OverrideSuppressionState` is constructed once at boot and threaded into both the `OverrideInjectionHandler` (writer) and the `MessagingLaneOverlay` context (reader, per SPEC-CRWDQ-049). No global singleton — the boot module owns the instance.

### Activation flow

For an incoming `OverrideInjection`:

1. **Duplicate check.** If `override_id` matches the currently-active override, no-op (re-push idempotency).
2. **Cancel active dwell.** The shared `DwellTimer.cancel()` halts the in-flight `PlannedState`'s dwell. This is the dwell-bypass per D-GRH-24 — no waiting for D-DWELL-01/02 minimums.
3. **Set suppression.** `overrideSuppressionState.setActive(true)` fires listeners synchronously; SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick.
4. **Resolve embedded `ProgramSlot` / `AdSlot` (if any).** If `program_slot_id` is non-null and the slot is not in `ProgramSlotResolver`, the override is one of the D-SCHEMA-08 "inline" forms — the server is expected to push the matching `ProgramSlot` frame adjacently. Apply the same 5s buffer rule as SPEC-CRWDQ-023 step 1.
5. **Run override transition.** `TransitionExecutor.run(frame.transition, host)`. Per D-GRH-24 the override's `transition` field is the wire-specified one; default fall-back uses the same catalog miss path as SPEC-CRWDQ-023.
6. **Mount via shared activator.** Build a `PlannedState`-shaped object from the override (`business_mode → mode`, `template_id`, `theme_id`, `program_slot_id`, `ad_slot_id`, `dwell_target_ms`, `transition`) plus a synthetic `state_id = "override:" + override_id` and route through `PlannedStateActivator.activate(...)`. The activator runs the mount and pending-apply paths exactly as for a regular `PlannedState` — overrides reuse, do not duplicate, the template families.
7. **Arm override dwell.** `DwellTimer.arm(frame.dwell_target_ms, onOverrideBoundary)`. On boundary, the player re-evaluates wall clock against the active `ScheduleWindow` (per D-SCHEMA-08 no explicit resume pointer) and clears suppression (step 9).
8. **Arm TTL.** `OverrideTimeoutClock.armUntil(fires_at + dwell_target_ms + GRACE_MS, onTimeout)`. `GRACE_MS = 2000`. If the wall-clock end passes without `onOverrideBoundary` firing (clock skew, suspended tab, etc.), `onTimeout` forces the resolve path. Journals `override_ttl_timeout`.
9. **Resolve.** On natural dwell boundary OR TTL OR supersede by a new `PlannedState`:
   - Run outgoing transition (per the override's `transition.variant` exit form; default mapping in `TransitionExecutor`).
   - Detach the override's mounted instance.
   - `overrideSuppressionState.setActive(false)` — overlay listeners resume.
   - Journal `override_resolved` with `override_id`, `resolved_by: 'dwell' | 'ttl' | 'supersede'`, `actual_dwell_ms`.
   - If TTL-driven: ALSO journal a `runtime_reason: 'render_error'` per D-GRH-76 (override stuck = render-side failure). Does NOT render an enum-specific safe — fallback is governed by the next valid frame.

### Supersede

An `OverrideInjection` arriving while another override is active:

- Different `override_id`: cancel the prior override's `DwellTimer` and TTL, journal `override_resolved` for the prior with `resolved_by: 'supersede'`, then run the new override from step 2 above. Suppression remains `true` across the transition (no flicker on the overlay layer).
- Same `override_id`: idempotent no-op (step 1).

A regular `PlannedState` arriving while an override is active:

- Buffered, not applied. The override holds priority per D-GRH-58 (`OverrideInjection > PlannedState`). On override resolve (any reason), the buffered `PlannedState` is dispatched. Buffer size is 1 — a second buffered `PlannedState` replaces the first (last-write-wins).
- Journal `planned_state_buffered_during_override` on buffer; `planned_state_resumed_after_override` on dispatch.

### Asset readiness (D-SCHEMA-08)

D-SCHEMA-08 specifies that the server pushes an `AssetManifest` alongside the `OverrideInjection` so the player can pre-fetch. This spec consumes — does not re-derive — the `AssetManifestStore` from SPEC-CRWDQ-064. Pre-fetch is initiated on `AssetManifest` arrival; the override's `fires_at` lead time allows the fetch to complete before activation.

If the override mounts and any required asset is missing from the manifest cache, the activator's existing miss paths run (catalog miss → default; ad asset miss → SPEC-CRWDQ-041 behavior). The override handler does not add new fallback paths — it reuses the activator's, which is the point of routing overrides through it.

### Out of scope

- Backend trigger logic (game lifecycle, excitement threshold, operator action) — owned by `crowdaq-backend`. The player executes whatever `OverrideInjection` arrives.
- Anti-flap coalescing — D-GRH-24 explicitly assigns to the backend ("the player does not need to debounce — coalescing is the backend's responsibility").
- Per-override messaging-lane suppression (per-flag bypass) — D-GRH-58 specifies binary, no per-flag.
- Cross-window resume pointer logic — D-SCHEMA-08 says "no explicit resume pointer: when override dwell completes, player re-evaluates wall clock against the active `ScheduleWindow`." That re-evaluation is the standard activator path on the next inbound `PlannedState`, not new logic here.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022; handler registers as the `OverrideInjection` handler. |
| `PlannedStateActivator` | 1 in-process | Real instance from SPEC-CRWDQ-023. |
| `OverrideSuppressionState` | 1 in-process | Real instance — this spec owns it. |
| `DwellTimer` | system boundary | Fake timers; assert cancel, arm, boundary firing. |
| `OverrideTimeoutClock` | system boundary | Fake timers; assert TTL fire. |
| `TransitionExecutor` | 2 local-substitutable | `InstantTransitionAdapter` from SPEC-CRWDQ-023 tests. |
| `MessagingLaneOverlay` (suppression listener) | 1 in-process | Real instance from SPEC-CRWDQ-049 — assert `data-suppressed` flips synchronously. |
| WS source | 2 local-substitutable | Real WS fixture (in-process WebSocket server) per the SPEC-CRWDQ-027 e2e pattern. |
| Journal sink | 2 local-substitutable | In-memory. |
| Wall clock | system boundary | Frozen `Date.now()`. |

Test cases:

- **Mid-dwell override (render swap inside 250 ms).** Mount a `single_game` `PlannedState` with `dwell_target_ms: 30000`. At t=5s send an `OverrideInjection`. Assert: `DwellTimer.cancel()` called; outgoing transition runs; override mount complete; total wall-clock from override arrival to override DOM visible ≤ 250 ms (real WS fixture, real `PlannedStateActivator`, instant-transition adapter — the 250 ms budget tests the dispatch + cancel path, not animation duration).
- **Dwell bypass.** Override arrives at t=1s into a `dwell_target_ms: 30000` slot. Assert: override mounts; the prior slot's dwell timer is cancelled BEFORE its `onBoundary` would have fired (i.e., the cancel happens at t≈1s, not t≈30s). D-GRH-24 dwell-bypass.
- **Override sets suppression.** Send override. Assert: `overrideSuppressionState.isActive === true` after step 3 of activation flow; the SPEC-CRWDQ-049 overlay layer has `data-suppressed="true"`.
- **Override clears suppression on natural rotation.** Override has `dwell_target_ms: 10000`. Advance fake clock 10s past arm. Assert: `onOverrideBoundary` fires; suppression flips to `false`; `MessagingLaneOverlay` resumes cycling; journal `override_resolved` with `resolved_by: 'dwell'`.
- **TTL timeout.** Override arrives with `fires_at = now`, `dwell_target_ms = 10000`. Suspend the dwell timer (simulate tab freeze: do NOT advance monotonic clock past 10s) but advance wall clock past `fires_at + 10s + 2s` grace. Assert: `OverrideTimeoutClock` fires; force-resolve path runs; journals `override_ttl_timeout` AND `override_resolved` with `resolved_by: 'ttl'` AND `runtime_reason: 'render_error'`.
- **Supersede by new override.** Send override A; at t=2s send override B (different `override_id`). Assert: override A journals `override_resolved` with `resolved_by: 'supersede'`; override B is the active mounted slot; suppression remained `true` throughout (no listener flap to `false`).
- **Idempotent re-push.** Same `override_id` twice. Assert: exactly one mount, exactly one suppression set, no duplicate journals.
- **PlannedState arriving during override is buffered.** Mount override. Send a `PlannedState` (different `state_id`). Assert: NOT applied; journal `planned_state_buffered_during_override`. Resolve override (advance clock). Assert: buffered `PlannedState` dispatched; journal `planned_state_resumed_after_override`.
- **Two PlannedStates buffered → last wins.** As above, then send a second `PlannedState`. Assert: first dropped; only second dispatched on resolve.
- **Override with inline `program_slot_id` not in resolver.** Send override referencing an unknown `program_slot_id` without an adjacent `ProgramSlot` frame. Within 5s send the matching `ProgramSlot`. Assert: override mounts. Same flow, no `ProgramSlot` arrival within 5s. Assert: journal `template_buffer_timeout` (reused from SPEC-CRWDQ-023); fall-through to safe per the standard activator path.
- **Transition catalog miss.** Override `transition.variant: 'nonexistent'`. Assert: default fade runs; journal `transition_catalog_miss`; mount still completes.
- **runtime_reason is journal-only (D-GRH-76).** TTL fires. Assert: journal contains `runtime_reason: 'render_error'`; the rendered DOM does NOT contain the string `"render_error"`, `"unavailable"`, or any enum-specific copy outside of the generic safe template (handled by the next valid frame, not this spec).

## Vocabulary

- `OverrideInjection`, `override_id`, `interrupt_class`, `fires_at` — D-SCHEMA-08.
- "dwell bypass" — D-GRH-24.
- "rendering priority stack", "binary suppression" — D-GRH-58.
- `overrideSuppressionState` — shared token contract defined in SPEC-CRWDQ-049, written here.
- `runtime_reason` — D-GRH-76, journal-only.
- `safe_reason` — D-GRH-76, patron-visible; explicitly NOT written by this spec.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-022 — `Dispatcher` for `OverrideInjection` routing.
- SPEC-CRWDQ-023 — `PlannedStateActivator`, `DwellTimer`, `TransitionExecutor`, `ProgramSlotResolver` (consumed unchanged).
- SPEC-CRWDQ-049 — `overrideSuppressionState` contract (consumer side). This spec implements the producer side of that contract.

**Soft dependency (asset path):**

- SPEC-CRWDQ-064 — `AssetManifestStore` for pre-fetch of override-required assets per D-SCHEMA-08. Not a hard blocker; the override path works without pre-fetch (assets resolved at mount time via the same activator miss paths).

**Blocks (downstream):**

- SPEC-CRWDQ-065 (`single_game_with_ads`) and SPEC-CRWDQ-066 (`fixtures_with_live_game`) — both consume the same `PlannedStateActivator`, and an override targeting either of these composite modes routes through this handler. No interface change is required; the templates are mounted via the shared activator regardless of source (regular `PlannedState` or override).

## Acceptance Criteria

- [ ] `OverrideInjectionHandler.handle(frame)` is registered as the dispatcher's `OverrideInjection` handler on the control channel.
- [ ] On override arrival, the active `DwellTimer` is cancelled before its `onBoundary` would have fired — verified by asserting the prior slot's `onBoundary` callback is NOT invoked in the test (D-GRH-24 dwell bypass).
- [ ] `overrideSuppressionState.setActive(true)` fires synchronously during activation (between transition start and mount); SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick.
- [ ] The override is mounted via `PlannedStateActivator` using a synthesized state shape (`state_id = "override:" + override_id`); the same template families used for regular `PlannedState` render the override — no duplicate template code paths.
- [ ] The override's own dwell is armed via the shared `DwellTimer.arm(frame.dwell_target_ms, ...)`; `OverrideTimeoutClock.armUntil(fires_at + dwell_target_ms + 2000ms, ...)` arms in parallel.
- [ ] On natural dwell boundary, journal `override_resolved` with `resolved_by: 'dwell'` and `actual_dwell_ms`; `overrideSuppressionState.setActive(false)`; messaging-lane overlay resumes.
- [ ] On TTL fire, journal `override_ttl_timeout` AND `override_resolved` with `resolved_by: 'ttl'` AND `runtime_reason: 'render_error'`; suppression cleared; force-detach runs.
- [ ] A regular `PlannedState` arriving while an override is active is buffered (size 1, last-write-wins); journals `planned_state_buffered_during_override`; on override resolve, the buffered state is dispatched and journals `planned_state_resumed_after_override`.
- [ ] A new `OverrideInjection` with a different `override_id` while one is active supersedes: prior journals `override_resolved` with `resolved_by: 'supersede'`; new override mounts; suppression stays `true` across the swap (no listener flap to `false`).
- [ ] Same `override_id` re-push is a no-op (exactly one mount, exactly one suppression set, no duplicate journals).
- [ ] Render swap from override arrival to override DOM visible completes within 250 ms in the real-WS fixture test (instant-transition adapter), exercising the dispatch + cancel path.
- [ ] `runtime_reason` (D-GRH-76) is journal-only — the override path NEVER renders the `runtime_reason` enum value on screen; patron-facing copy is owned by the next valid frame.
- [ ] Tests cover: mid-dwell render swap < 250 ms, dwell bypass, suppression set/clear on natural rotation, TTL timeout with runtime_reason journal, supersede by new override, idempotent re-push, PlannedState buffering during override, two-buffered-last-wins, inline `ProgramSlot` arrival, transition catalog miss.
- [ ] No mocks of `Dispatcher`, `PlannedStateActivator`, `DwellTimer`, `MessagingLaneOverlay`, or `OverrideSuppressionState` (INV-FACTORY-16); only the WS source, clock, transition timing, and journal sink are substituted (INV-FACTORY-17).
