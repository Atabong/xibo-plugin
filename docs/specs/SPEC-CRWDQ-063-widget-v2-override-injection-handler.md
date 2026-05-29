---
spec_id: SPEC-CRWDQ-063
title: Widget v2 OverrideInjection handler
status: impl-ready
owner: player-runtime/widget-v2/overrides
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-023, SPEC-CRWDQ-049, SPEC-CRWDQ-064]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-063 — Widget v2 OverrideInjection handler

> **NOTE — backend integration dependency (non-blocking).** This handler
> can be implemented and contract-tested against the SPEC-CRWDQ-017 wire
> types now. It cannot be E2E-verified (SPEC-CRWDQ-027 smoke) until the
> backend producer + delivery path for `OverrideInjection` lands — see the
> backend-dependency note in the OPEN QUESTION below.

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S4 — End-to-end demo (initial wiring); expanded surface lands with S9 / S10 |
| Plane epic | CRWDQ-5 (initial wiring), CRWDQ-10 / CRWDQ-11 (full surface) |
| Decisions referenced | D-GRH-24, D-GRH-56, D-GRH-58, D-GRH-76, D-SCHEMA-08 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed); `modules/widget-v2/src/render/PlannedStateActivator.ts` (consumed); `modules/widget-v2/src/render/DwellTimer.ts` (consumed); `modules/widget-v2/src/render/TransitionExecutor.ts` (consumed) |
| New files | `modules/widget-v2/src/overrides/OverrideInjectionHandler.ts`, `modules/widget-v2/src/overrides/OverrideSuppressionState.ts`, `modules/widget-v2/src/overrides/OverrideTimeoutClock.ts`, `modules/widget-v2/tests/overrides/*.test.ts` |

> **Backend authority note — backend integration dependency (non-blocking).**
> `OverrideInjection` is a declared control-channel `MessageType` in the
> wire protocol (`crowdaq-backend` `src/wire/message-type.ts:9`) and its
> payload (`OverrideInjectionPayload`, `src/wire/types.ts:61-69`) mirrors
> `PlannedStatePayload` (D-GRH-56). As of this writing the backend has no
> code path that constructs, dispatches, or re-pushes an
> `OverrideInjection` frame — the producer + delivery path is not yet
> authored. This handler can still be implemented and contract-tested
> against the wire types now; the backend producer must land before it can
> be exercised at runtime / E2E (see the OPEN QUESTION). The frame-shape
> facts below are cross-checked against the wire types.

## Module

`player-runtime :: widget-v2 :: overrides` — the player-side handler for `OverrideInjection` frames. Subscribes via `Dispatcher`, cancels the active `DwellTimer`, runs the override transition, mounts the override's `PlannedState`-shaped payload through the existing `PlannedStateActivator`, writes the `overrideSuppressionState` token consumed by SPEC-CRWDQ-049, manages the override's own dwell, and resolves cleanly on natural rotation, supersede, or TTL/timeout.

This spec owns the override path. The shared render orchestration (`PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`) is reused unchanged from SPEC-CRWDQ-023 — the override is not a separate template family; it is a dispatch path that re-enters the activator with the override's embedded `PlannedState`-shaped payload.

## Current shape

- No override handling in v1. The MVP widget has no out-of-band interrupt path; SSE events mutate text in place.
- D-GRH-24 establishes three override trigger categories (game lifecycle transition, excitement threshold, human operator) and the dwell-bypass rule: overrides bypass D-DWELL-01 (15s minimum dwell for a mode change) and D-DWELL-02 (8s minimum for an in-mode switch). The player implements bypass; the backend owns trigger semantics.
- D-SCHEMA-08 establishes the wire shape: `override_id`, `fires_at`, plus the render fields a `PlannedState` carries (D-GRH-56) — `interrupt_class`, `business_mode`, `template_id`, `theme_id`, `dwell_target_ms`, `transition`, `program_slot_id`, `ad_slot_id`. **The render-field types follow SPEC-CRWDQ-017's `PlannedStatePayload`:** `transition` is a catalog-name `string` (NOT the `{animation_id, duration_ms}` object of D-GRH-50/56), `theme_id` is `string | null` (the wire value; the activator resolves it to a three-state `ResolvedTheme`), and `interrupt_class` is constrained to SPEC-CRWDQ-017's `InterruptClass` (`scheduled | exceptional_override`). D-SCHEMA-08's `major_sports_moment` value is NOT in SPEC-CRWDQ-017's `InterruptClass`; SPEC-CRWDQ-017, the wire spec, governs — an override is always `exceptional_override`.
- D-GRH-58 establishes the rendering priority stack: `OverrideInjection` > `PlannedState` > `MessagingLane`. The override suppresses messaging-lane overlays for its full lifetime.
- D-GRH-76 splits safe-mode reasons: a backend-planned safe (`safe_reason`) is patron-visible; a player-runtime safe (`runtime_reason`) is journal-only. An override TTL/timeout-driven safe falls in the runtime bucket — journal it; do not render an enum-specific copy on screen.

## Proposed deep interface

### Wire frame

`OverrideInjection` is a SPEC-CRWDQ-017 `Envelope<OverrideInjectionPayload>` — every wire frame is an envelope (`schema_version`, `channel`, `message_type`, `ts`, optional `seq`/`bar_id`/`game_id`, `payload`). The handler receives the parsed envelope from the `Dispatcher`; the override fields live in `payload`.

```ts
// modules/widget-v2/src/overrides/OverrideInjectionHandler.ts
export interface OverrideInjectionHandler {
  /**
   * Registered as the Dispatcher handler for `OverrideInjection`.
   * Cancels the active dwell, runs the override transition, mounts
   * the override's PlannedState-shaped payload via PlannedStateActivator,
   * sets overrideSuppressionState.isActive=true, arms the override
   * dwell. Idempotent on a duplicate override_id.
   */
  handle(frame: OverrideInjectionFrame): Promise<void>;
}

/**
 * OverrideInjectionFrame is the SPEC-CRWDQ-017 Envelope<OverrideInjectionPayload> —
 * consumed, not independently owned. The render fields inside the payload mirror
 * PlannedStatePayload (D-GRH-56). The exact OverrideInjectionPayload field set is
 * defined by SPEC-CRWDQ-017's src/wire/types.ts (one of its 20 payload interfaces);
 * the fields below are the D-SCHEMA-08 contract this handler depends on.
 */
export interface OverrideInjectionFrame {
  schema_version: number;                 // 1 in phase-1
  channel: 'control';                     // OverrideInjection pins to the control channel
  message_type: 'OverrideInjection';
  ts: string;                             // RFC 3339 UTC — server publish time
  payload: OverrideInjectionPayload;
}

export interface OverrideInjectionPayload {
  override_id: string;
  fires_at: string;                       // ISO 8601 UTC; D-SCHEMA-08 — when the override should activate
  interrupt_class: 'exceptional_override'; // SPEC-CRWDQ-017 InterruptClass is 'scheduled'|'exceptional_override';
                                          // an override is always 'exceptional_override' (D-SCHEMA-08 also
                                          // lists 'major_sports_moment', which SPEC-CRWDQ-017 does not — SPEC-017 governs)
  business_mode: string;                  // routed through PlannedStateActivator
  template_id: string;
  theme_id: string | null;                // SPEC-CRWDQ-017 PlannedStatePayload.theme_id (null = default theme);
                                          // the activator resolves it to a three-state ResolvedTheme (SPEC-CRWDQ-023)
  dwell_target_ms: number;
  transition: string;                     // catalog-name string — SPEC-CRWDQ-017 PlannedStatePayload.transition
                                          // is a string, not an {animation_id, duration_ms} object
  program_slot_id: string | null;
  ad_slot_id: string | null;
}
```

> **OPEN QUESTION (1) — BACKEND DEPENDENCY (non-blocking): `OverrideInjection`
> has no backend producer or delivery mechanism yet (backend code cross-check).**
> As of this writing the `crowdaq-backend` source has NO code path that
> produces or delivers an `OverrideInjection` frame.
>
> - `OverrideInjection` is a declared wire message type
>   (`src/wire/message-type.ts:9`) and wire payload (`OverrideInjectionPayload`,
>   `src/wire/types.ts:61-69`), but a search of the source finds ZERO
>   constructions of an `OverrideInjection` envelope — nothing builds one.
> - It is absent from the re-push sequence
>   (`src/delivery/repush/builder.ts:135-205` — `ConfigPush →
>   ScheduleWindow → AssetManifest → PlannedState* → ProgramSlot* →
>   GameState*`).
> - The NATS fan-out router (`src/delivery/nats/router.ts`) has no route
>   for it — BAR_CONTROL handles only `ConfigPush / MessagingLane /
>   PlayerConnected / PlayerDisconnected`, GAME_EVENTS only `GameState /
>   GameEvent / DisplayEvent`. An `OverrideInjection` would be `term()`-ed.
>
> Resolution: implement this handler against the SPEC-CRWDQ-017 wire
> contract now and contract-test it (dwell bypass, suppression, activator
> re-entry, TTL) with the WS boundary driven by a fixture. The backend
> producer + delivery path must land before the handler can be exercised
> at runtime / E2E (SPEC-CRWDQ-027 smoke). That work is (a) a producer
> that emits an `OverrideInjection` frame on one of the trigger categories
> (D-GRH-24: game lifecycle / excitement / operator), (b) a delivery path
> — a dispatched `OverrideInjection` frame on the control channel routed
> to connected players — and (c) a defined delivery contract for any
> referenced `ProgramSlot` / `AdSlot` (the "inline" D-SCHEMA-08 form; this
> is also the `AdSlot`-delivery gap flagged by SPEC-CRWDQ-041). The handler
> design below is the shape to build against today.

```ts
// modules/widget-v2/src/overrides/OverrideSuppressionState.ts
/**
 * The shared token contract established by SPEC-CRWDQ-049 (consumer)
 * and written by this spec (producer). Single source of truth for
 * "is an override currently active." Listener fanout used by
 * MessagingLaneOverlay and any future overlay that must hide during
 * overrides (D-GRH-58 binary suppression).
 *
 * SPEC-CRWDQ-049 consumes the read-only view { isActive, subscribe };
 * this spec adds the writer method setActive.
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

For an incoming `OverrideInjection` envelope (fields below are read from `frame.payload`):

1. **Duplicate check.** If `payload.override_id` matches the currently-active override, no-op (re-push idempotency).
2. **Cancel active dwell.** The shared `DwellTimer.cancel()` halts the in-flight `PlannedState`'s dwell. This is the dwell-bypass per D-GRH-24 — no waiting for D-DWELL-01/02 minimums.
3. **Set suppression.** `overrideSuppressionState.setActive(true)` fires listeners synchronously; SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick.
4. **Resolve embedded `ProgramSlot` / `AdSlot` (if any).** If `payload.program_slot_id` is non-null and the slot is not in `ProgramSlotResolver`, the override is one of the D-SCHEMA-08 "inline" forms. Apply the same 5 s buffer rule as SPEC-CRWDQ-023 step 1 (see the OPEN QUESTION on the adjacent-push contract).
5. **Run override transition.** `TransitionExecutor.run(payload.transition, host)`. Per D-GRH-24 the override's `transition` field is the wire-specified catalog name; the default fall-back uses the same catalog-miss path as SPEC-CRWDQ-023.
6. **Mount via shared activator.** Build a `PlannedState`-shaped object from `frame.payload` (carrying `business_mode`, `template_id`, `theme_id`, `program_slot_id`, `ad_slot_id`, `dwell_target_ms`, `transition` straight through — the override's render fields ARE `PlannedStatePayload` fields per D-GRH-56) plus a synthetic `state_id = "override:" + override_id`, and route it through `PlannedStateActivator.activate(...)`. The activator runs the mount, the theme resolution (`theme_id` → `ResolvedTheme`), and the pending-apply paths exactly as for a regular `PlannedState` — overrides reuse, not duplicate, the template families.
7. **Arm override dwell.** `DwellTimer.arm(payload.dwell_target_ms, onOverrideBoundary)`. On boundary, the player re-evaluates the wall clock against the active `ScheduleWindow` (per D-SCHEMA-08 there is no explicit resume pointer) and clears suppression (step 9).
8. **Arm TTL.** `OverrideTimeoutClock.armUntil(fires_at + dwell_target_ms + GRACE_MS, onTimeout)`, where `fires_at` is `payload.fires_at` and `GRACE_MS = 2000`. If the wall-clock end passes without `onOverrideBoundary` firing (clock skew, suspended tab, etc.), `onTimeout` forces the resolve path. Journals `override_ttl_timeout`.
9. **Resolve.** On a natural dwell boundary OR TTL OR supersede by a new `PlannedState`:
   - Run the outgoing transition (the exit form is derived by `TransitionExecutor` from the override's `transition` catalog name; default mapping on a catalog miss).
   - Detach the override's mounted instance.
   - `overrideSuppressionState.setActive(false)` — overlay listeners resume.
   - Journal `override_resolved` with `override_id`, `resolved_by: 'dwell' | 'ttl' | 'supersede'`, and `actual_dwell_ms`.
   - If TTL-driven: ALSO journal a `runtime_reason: 'render_error'` per D-GRH-76 (a stuck override is a render-side failure). It does NOT render an enum-specific safe — the fallback is governed by the next valid frame.

### Supersede

An `OverrideInjection` arriving while another override is active:

- Different `override_id`: cancel the prior override's `DwellTimer` and TTL, journal `override_resolved` for the prior with `resolved_by: 'supersede'`, then run the new override from step 2 above. Suppression remains `true` across the transition (no flicker on the overlay layer).
- Same `override_id`: idempotent no-op (step 1).

A regular `PlannedState` arriving while an override is active:

- Buffered, not applied. The override holds priority per D-GRH-58 (`OverrideInjection > PlannedState`). On override resolve (any reason), the buffered `PlannedState` is dispatched. The buffer size is 1 — a second buffered `PlannedState` replaces the first (last-write-wins).
- Journal `planned_state_buffered_during_override` on buffer; `planned_state_resumed_after_override` on dispatch.

### Asset readiness (D-SCHEMA-08)

D-SCHEMA-08 specifies that the server pushes an `AssetManifest` alongside the `OverrideInjection` so the player can pre-fetch. This spec consumes — does not re-derive — the `AssetManifestStore` from SPEC-CRWDQ-064. Pre-fetch is initiated on `AssetManifest` arrival; the override's `fires_at` lead time allows the fetch to complete before activation.

If the override mounts and any required asset is missing from the manifest cache, the activator's existing miss paths run (catalog miss → default; ad asset miss → SPEC-CRWDQ-041 behavior). The override handler adds no new fallback paths — it reuses the activator's, which is the point of routing overrides through it.

### Out of scope

- Backend trigger logic (game lifecycle, excitement threshold, operator action) — owned by `crowdaq-backend`. The player executes whatever `OverrideInjection` arrives.
- Anti-flap coalescing — D-GRH-24 explicitly assigns this to the backend ("the player does not need to debounce — coalescing is the backend's responsibility").
- Per-override messaging-lane suppression (per-flag bypass) — D-GRH-58 specifies binary, no per-flag.
- Cross-window resume pointer logic — D-SCHEMA-08 says "no explicit resume pointer: when override dwell completes, the player re-evaluates the wall clock against the active `ScheduleWindow`." That re-evaluation is the standard activator path on the next inbound `PlannedState`, not new logic here.

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
- **Dwell bypass.** An override arrives at t=1s into a `dwell_target_ms: 30000` slot. Assert: the override mounts; the prior slot's dwell timer is cancelled BEFORE its `onBoundary` would have fired (the cancel happens at t≈1s, not t≈30s). D-GRH-24 dwell-bypass.
- **Override sets suppression.** Send an override. Assert: `overrideSuppressionState.isActive === true` after step 3 of the activation flow; the SPEC-CRWDQ-049 overlay layer has `data-suppressed="true"`.
- **Override clears suppression on natural rotation.** Override has `dwell_target_ms: 10000`. Advance the fake clock 10 s past arm. Assert: `onOverrideBoundary` fires; suppression flips to `false`; `MessagingLaneOverlay` resumes cycling; journal `override_resolved` with `resolved_by: 'dwell'`.
- **TTL timeout.** Override arrives with `fires_at = now`, `dwell_target_ms = 10000`. Suspend the dwell timer (simulate a tab freeze: do NOT advance the monotonic clock past 10 s) but advance the wall clock past `fires_at + 10s + 2s` grace. Assert: `OverrideTimeoutClock` fires; the force-resolve path runs; journals `override_ttl_timeout` AND `override_resolved` with `resolved_by: 'ttl'` AND `runtime_reason: 'render_error'`.
- **Supersede by a new override.** Send override A; at t=2s send override B (different `override_id`). Assert: override A journals `override_resolved` with `resolved_by: 'supersede'`; override B is the active mounted slot; suppression remained `true` throughout (no listener flap to `false`).
- **Idempotent re-push.** The same `override_id` twice. Assert: exactly one mount, exactly one suppression set, no duplicate journals.
- **PlannedState arriving during an override is buffered.** Mount an override. Send a `PlannedState` (different `state_id`). Assert: it is NOT applied; journal `planned_state_buffered_during_override`. Resolve the override (advance the clock). Assert: the buffered `PlannedState` is dispatched; journal `planned_state_resumed_after_override`.
- **Two PlannedStates buffered → last wins.** As above, then send a second `PlannedState`. Assert: the first is dropped; only the second is dispatched on resolve.
- **Override with an inline `program_slot_id` not in the resolver.** Send an override referencing an unknown `program_slot_id` without an adjacent `ProgramSlot` frame. Within 5 s send the matching `ProgramSlot`. Assert: the override mounts. Same flow, no `ProgramSlot` arrival within 5 s. Assert: journal `template_buffer_timeout` (reused from SPEC-CRWDQ-023); fall-through to safe per the standard activator path.
- **Transition catalog miss.** Override `transition: 'nonexistent'` (an unknown catalog name). Assert: the default fade runs; journal `transition_catalog_miss`; the mount still completes.
- **runtime_reason is journal-only (D-GRH-76).** TTL fires. Assert: the journal contains `runtime_reason: 'render_error'`; the rendered DOM does NOT contain the string `"render_error"`, `"unavailable"`, or any enum-specific copy outside the generic safe template (handled by the next valid frame, not this spec).

## Vocabulary

- `OverrideInjection`, `override_id`, `interrupt_class`, `fires_at` — D-SCHEMA-08; wire-field types per SPEC-CRWDQ-017 `OverrideInjectionPayload` / `PlannedStatePayload`. `OverrideInjection` is a SPEC-CRWDQ-017 `Envelope<OverrideInjectionPayload>` on the control channel.
- "dwell bypass" — D-GRH-24.
- "rendering priority stack", "binary suppression" — D-GRH-58.
- `overrideSuppressionState` — the shared token contract defined in SPEC-CRWDQ-049, written here.
- `runtime_reason` — D-GRH-76, journal-only.
- `safe_reason` — D-GRH-76, patron-visible; explicitly NOT written by this spec.

## Acceptance Criteria

- [ ] `OverrideInjectionHandler.handle(frame)` is registered as the dispatcher's `OverrideInjection` handler on the control channel; `frame` is a SPEC-CRWDQ-017 `Envelope<OverrideInjectionPayload>` and the handler reads the override fields from `frame.payload`.
- [ ] On override arrival, the active `DwellTimer` is cancelled before its `onBoundary` would have fired — verified by asserting the prior slot's `onBoundary` callback is NOT invoked in the test (D-GRH-24 dwell bypass).
- [ ] `overrideSuppressionState.setActive(true)` fires synchronously during activation (between transition start and mount); SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick.
- [ ] The override is mounted via `PlannedStateActivator` using a synthesized state shape (`state_id = "override:" + override_id`); the same template families used for a regular `PlannedState` render the override — no duplicate template code paths.
- [ ] The override's own dwell is armed via the shared `DwellTimer.arm(payload.dwell_target_ms, ...)`; `OverrideTimeoutClock.armUntil(payload.fires_at + dwell_target_ms + 2000ms, ...)` arms in parallel.
- [ ] On a natural dwell boundary, journal `override_resolved` with `resolved_by: 'dwell'` and `actual_dwell_ms`; `overrideSuppressionState.setActive(false)`; the messaging-lane overlay resumes.
- [ ] On TTL fire, journal `override_ttl_timeout` AND `override_resolved` with `resolved_by: 'ttl'` AND `runtime_reason: 'render_error'`; suppression cleared; force-detach runs.
- [ ] A regular `PlannedState` arriving while an override is active is buffered (size 1, last-write-wins); journals `planned_state_buffered_during_override`; on override resolve, the buffered state is dispatched and journals `planned_state_resumed_after_override`.
- [ ] A new `OverrideInjection` with a different `override_id` while one is active supersedes: the prior journals `override_resolved` with `resolved_by: 'supersede'`; the new override mounts; suppression stays `true` across the swap (no listener flap to `false`).
- [ ] The same `override_id` re-push is a no-op (exactly one mount, exactly one suppression set, no duplicate journals).
- [ ] The render swap from override arrival to override DOM visible completes within 250 ms in the real-WS fixture test (instant-transition adapter), exercising the dispatch + cancel path.
- [ ] `runtime_reason` (D-GRH-76) is journal-only — the override path NEVER renders the `runtime_reason` enum value on screen; patron-facing copy is owned by the next valid frame.
- [ ] Tests cover: mid-dwell render swap < 250 ms, dwell bypass, suppression set/clear on natural rotation, TTL timeout with `runtime_reason` journal, supersede by a new override, idempotent re-push, `PlannedState` buffering during an override, two-buffered-last-wins, inline `ProgramSlot` arrival, transition catalog miss.
- [ ] No mocks of `Dispatcher`, `PlannedStateActivator`, `DwellTimer`, `MessagingLaneOverlay`, or `OverrideSuppressionState` (INV-FACTORY-16); only the WS source, clock, transition timing, and journal sink are substituted (INV-FACTORY-17).
