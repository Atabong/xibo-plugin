---
spec_id: SPEC-CRWDQ-063
title: Widget v2 OverrideInjection handler
status: impl-ready
owner: player-runtime/widget-v2/overrides
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-049]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-063 — Widget v2 OverrideInjection handler

> **NOTE — producer + delivery EXIST; this is a phase-1 canned-overlay
> handler.** The backend producer (admin `POST /override-injection`,
> SPEC-CRWDQ-081 — shipped) and the NATS delivery path
> (`BAR_CONTROL` → `override-injection` leaf → `OverrideInjection`) both
> exist and are testable end-to-end. The wire contract below is the
> ACTUAL emitted frame, not a forward projection. The only deferred item
> is `payload_ref` CONTENT delivery (a future schema bump, D-GRH-56); it
> does NOT block this handler — `payload_ref` is always `null` in phase-1
> and the handler renders a built-in canned overlay keyed on
> `override_class`.

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S4 — End-to-end demo (initial wiring); expanded surface lands with S9 / S10 |
| Plane epic | CRWDQ-5 (initial wiring), CRWDQ-10 / CRWDQ-11 (full surface) |
| Decisions referenced | D-GRH-24, D-GRH-56, D-GRH-58, D-GRH-76 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed); `modules/widget-v2/src/overrides/OverrideSuppressionState.ts` (co-owned with SPEC-CRWDQ-049) |
| New files | `modules/widget-v2/src/overrides/OverrideInjectionHandler.ts`, `modules/widget-v2/src/overrides/OverrideSuppressionState.ts`, `modules/widget-v2/src/overrides/OverrideOverlayRenderer.ts`, `modules/widget-v2/src/overrides/overrideClassTreatment.ts`, `modules/widget-v2/tests/overrides/*.test.ts` |

> **Backend authority note — the wire contract is the standard; the
> player conforms.** `OverrideInjection` is a declared control-channel
> `MessageType` (`crowdaq-backend` `src/wire/message-type.ts`) with the
> payload typed at `src/wire/types.ts:61-69`. The actual emitted frame is
> built in `crowdaq-backend/src/admin/handlers/override-injection/handler.ts:130-155`
> (`buildOverrideEnvelope`). The handler comment at lines 131-139 is the
> binding statement of intent: the operator's `text` and `display_form`
> are **admin-request + audit-log only** and are deliberately NOT placed
> on the wire; the time-bounded window is carried as `valid_to`; the
> overlay content is a FUTURE out-of-band delivery via `payload_ref`
> (deferred per D-GRH-56). The player NEVER receives operator-authored
> text in phase-1.

## Module

`player-runtime :: widget-v2 :: overrides` — the player-side handler for
`OverrideInjection` frames. Subscribes via `Dispatcher`, renders a
**built-in canned overlay** chosen by `override_class`, writes the
`overrideSuppressionState` token consumed by SPEC-CRWDQ-049, manages the
override window via a wall-clock timer, and resolves cleanly on window
expiry or precedence-based supersede.

This handler is **self-contained**. Phase-1 the override carries no
operator content on the wire (only a class), so it is NOT routed through
`PlannedStateActivator` and is NOT a `PlannedState`. It is its own
canned-overlay renderer with bundled copy and assets. The previous
"re-enter the activator with an embedded PlannedState" model is removed —
there is no embedded PlannedState on the wire.

## Current shape

- No override handling in v1. The MVP widget has no out-of-band interrupt path; SSE events mutate text in place.
- D-GRH-24 establishes three override trigger categories (game lifecycle transition, excitement threshold, human operator) and the dwell-bypass rule: overrides bypass D-DWELL-01 (15s minimum dwell for a mode change) and D-DWELL-02 (8s minimum for an in-mode switch). The player implements bypass — the canned overlay activates immediately, it does not wait for any dwell minimum. The backend owns trigger semantics.
- D-GRH-56 frames `OverrideInjection` as an exceptional, operator-triggered, **time-bounded** overlay. The window is carried on the wire as `[valid_from, valid_to]` (`valid_to = valid_from + override_window_ms`, server-computed). `payload_ref` is the future hook for operator content; it is always `null` today.
- D-GRH-58 establishes the rendering priority stack: `OverrideInjection` > `PlannedState` > `MessagingLane`. The override suppresses messaging-lane overlays for its full lifetime via the binary `overrideSuppressionState` token.
- D-GRH-76 splits safe-mode reasons: a backend-planned safe (`safe_reason`) is patron-visible; a player-runtime safe (`runtime_reason`) is journal-only. A render failure of the canned overlay falls in the runtime bucket — journal it; do not render an enum-specific copy on screen.

## Proposed deep interface

### Wire frame

`OverrideInjection` is a SPEC-CRWDQ-017 `Envelope<OverrideInjectionPayload>`
on the `control` channel (`seq` absent, `bar_id` present). The handler
receives the parsed envelope from the `Dispatcher`; the override fields
live in `payload`. The payload shape below is copied verbatim from
`crowdaq-backend/src/wire/types.ts:61-69` and matches the frame emitted by
`buildOverrideEnvelope` (`handler.ts:130-155`).

```ts
// modules/widget-v2/src/overrides/OverrideInjectionHandler.ts
export interface OverrideInjectionHandler {
  /**
   * Registered as the Dispatcher handler for `OverrideInjection`.
   * Validates the window, sets overrideSuppressionState.isActive=true on
   * activation, renders the canned overlay for override_class, and arms a
   * wall-clock timer to auto-clear at valid_to. Idempotent on a duplicate
   * override_id. Precedence governs supersede.
   */
  handle(frame: OverrideInjectionFrame): Promise<void>;
}

/**
 * OverrideInjectionFrame is the SPEC-CRWDQ-017 Envelope<OverrideInjectionPayload> —
 * consumed, not independently owned. The payload field set is defined by
 * SPEC-CRWDQ-017's src/wire/types.ts:61-69 and emitted by the backend's
 * buildOverrideEnvelope (crowdaq-backend src/admin/handlers/override-injection/handler.ts).
 */
export interface OverrideInjectionFrame {
  schema_version: number;                 // 1 in phase-1
  channel: 'control';                     // OverrideInjection pins to the control channel
  message_type: 'OverrideInjection';
  ts: string;                             // RFC 3339 UTC — server publish time
  bar_id: string;                         // present on the wire
  payload: OverrideInjectionPayload;      // seq is ABSENT for OverrideInjection
}

/**
 * The ACTUAL wire payload (crowdaq-backend src/wire/types.ts:61-69).
 * NO operator text, NO display_form, NO embedded PlannedState render
 * fields — none of business_mode / template_id / theme_id /
 * program_slot_id / ad_slot_id / dwell_target_ms / transition / fires_at /
 * interrupt_class exist on the wire. The player chooses a built-in canned
 * overlay from override_class.
 */
export interface OverrideInjectionPayload {
  override_id: string;
  bar_id: string;
  override_class:
    | 'emergency_safety'
    | 'scoreboard_correction'
    | 'operator_alert'
    | 'system_maintenance';
  payload_ref: string | null;            // ALWAYS null in phase-1 (future content hook, D-GRH-56)
  valid_from: string;                     // RFC3339 UTC — window start
  valid_to: string | null;               // RFC3339 UTC — window end (= valid_from + override_window_ms);
                                          // null = indefinite (holds until superseded)
  precedence: number;                     // ALWAYS 0 in phase-1 (general rule encoded for forward-compat)
}
```

> **NOTE — `payload_ref` is the only deferred item, and it does NOT block
> this handler.** The producer (`handler.ts`, SPEC-CRWDQ-081, shipped) and
> the delivery path (`src/delivery/nats/router.ts` — the `override-injection`
> leaf maps to `OverrideInjection` on `BAR_CONTROL`,
> `BAR_CONTROL_TYPE_FOR_LEAF['override-injection']`) both exist and route
> to connected players. `OverrideInjection` is explicitly NOT in the
> re-push sequence (`src/delivery/repush/builder.ts` — fire-and-forget,
> best-effort; SPEC-CRWDQ-081 "Reconnect — NOT in re-push"), so the
> handler does not expect re-delivery on reconnect. The only future work
> is `payload_ref` CONTENT delivery (a future schema bump per D-GRH-56):
> when the backend later sends a non-null `payload_ref`, the resolved
> content REPLACES the canned copy. Phase-1 `payload_ref` is `null`, so
> the canned overlay is always used. The handler MUST tolerate a non-null
> `payload_ref` by falling back to the canned overlay for `override_class`
> (forward-compatible, no crash) until content resolution lands.

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
// modules/widget-v2/src/overrides/OverrideOverlayRenderer.ts
/**
 * Self-contained renderer for the built-in canned overlays. Each
 * override_class maps to a fixed treatment (see overrideClassTreatment.ts).
 * Copy and assets are BUNDLED (generic/canned) — no operator text is on
 * the wire in phase-1. The renderer mounts the chosen overlay into the
 * host and detaches it on clear. It does NOT use PlannedStateActivator,
 * ProgramSlotResolver, AssetManifestStore, or any template family.
 */
export interface OverrideOverlayRenderer {
  /** Mount the canned overlay for the class. Returns a detach handle. */
  mount(treatment: OverrideTreatment, host: HTMLElement): () => void;
}
```

```ts
// modules/widget-v2/src/overrides/overrideClassTreatment.ts
/**
 * The phase-1 class → canned-overlay treatment mapping. Copy is
 * generic/canned (NOT operator text). When a non-null payload_ref is
 * delivered in a future schema bump, the resolved content REPLACES
 * `cannedCopy`; phase-1 always uses cannedCopy.
 */
export type OverrideVisualForm = 'fullscreen' | 'top-banner';

export interface OverrideTreatment {
  form: OverrideVisualForm;
  /** Higher = stronger visual priority within a single rendered overlay. */
  visualPriority: number;
  cannedCopy: string;
}

export const OVERRIDE_CLASS_TREATMENT: Record<
  OverrideInjectionPayload['override_class'],
  OverrideTreatment
> = {
  emergency_safety:      { form: 'fullscreen',  visualPriority: 3, cannedCopy: /* high-contrast safety card */ '…' },
  system_maintenance:    { form: 'fullscreen',  visualPriority: 2, cannedCopy: /* maintenance card */ '…' },
  scoreboard_correction: { form: 'top-banner',  visualPriority: 1, cannedCopy: 'Scoreboard under review' },
  operator_alert:        { form: 'top-banner',  visualPriority: 0, cannedCopy: 'Notice' },
};
```

### Class → canned-overlay treatment (phase-1)

| `override_class` | Visual form | Treatment | Canned copy (generic, bundled — NOT operator text) |
|------------------|-------------|-----------|-----------------------------------------------------|
| `emergency_safety` | Fullscreen | High-contrast safety card. **Highest** visual priority. | Generic safety copy |
| `system_maintenance` | Fullscreen | Maintenance card. | Generic maintenance copy |
| `scoreboard_correction` | Top banner | Banner. | "Scoreboard under review" |
| `operator_alert` | Top banner / toast | Banner/toast. | "Notice" |

The `visualPriority` ranking above governs only intra-overlay rendering
(e.g. which fullscreen card wins if two were ever co-rendered); the live
active-slot selection is governed by wire `precedence` (see Supersede).

### Wiring

The override handler is registered against the control channel:

```ts
dispatcher.register('OverrideInjection', (frame) => handler.handle(frame), 'control');
```

`OverrideSuppressionState` is constructed once at boot and threaded into
both the `OverrideInjectionHandler` (writer) and the `MessagingLaneOverlay`
context (reader, per SPEC-CRWDQ-049). No global singleton — the boot
module owns the instance.

### Activation flow

For an incoming `OverrideInjection` envelope (fields read from `frame.payload`):

1. **Duplicate check.** If `payload.override_id` matches the currently-active override, no-op (re-push idempotency — kept even though the backend does not re-push).
2. **Precedence gate.** If an override is already active, apply the Supersede rules below. If the incoming override is suppressed (strictly lower precedence), journal `override_suppressed_lower_precedence` and stop here.
3. **Window evaluation.** Read `now()` once. Compute the window `[valid_from, valid_to]`:
   - If `valid_to !== null` and `now >= valid_to` (already expired on arrival): drop, journal `override_expired_on_arrival`, do NOT render, do NOT touch suppression.
   - If `now < valid_from` (future): arm a wall-clock timer for `valid_from`; on fire, run steps 4–6. (Do not render or suppress until then.)
   - If `valid_from <= now` and (in window or `valid_to === null`): activate immediately (steps 4–6). Dwell bypass per D-GRH-24 — no minimum-dwell wait.
4. **Set suppression.** `overrideSuppressionState.setActive(true)` fires listeners synchronously; SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick.
5. **Render canned overlay.** Resolve `override_class` → `OverrideTreatment` via `OVERRIDE_CLASS_TREATMENT`. `OverrideOverlayRenderer.mount(treatment, host)`. If `payload_ref` is non-null (forward-compat), fall back to `treatment.cannedCopy` (content resolution is deferred — never crash). Journal `override_activated` with `override_id`, `override_class`, `precedence`.
6. **Arm auto-clear.** If `valid_to !== null`: `armUntil(valid_to, onWindowExpiry)` (a single wall-clock timer — this REPLACES both the old DwellTimer dwell and the old OverrideTimeoutClock TTL). If `valid_to === null`: the override is **indefinite** — arm no expiry timer; journal `override_indefinite`; it holds until superseded.
7. **Clear (window expiry or supersede).** On the auto-clear timer firing OR a supersede:
   - Detach the overlay (call the renderer's detach handle).
   - `overrideSuppressionState.setActive(false)` — overlay listeners resume.
   - Journal `override_resolved` with `override_id` and `resolved_by: 'window' | 'supersede'`.

### Supersede (precedence-based)

The handler maintains a **single active override slot**. An
`OverrideInjection` arriving while another override is active:

- **Same `override_id`:** idempotent no-op (step 1).
- **`incoming.precedence > active.precedence`:** the incoming supersedes. Journal `override_resolved` for the displaced active override with `resolved_by: 'supersede'`, detach it, then activate the incoming from step 3. Suppression remains `true` across the swap (no flicker — no flap to `false`).
- **Equal precedence (tie):** most-recent-wins (last write). Same swap as above; the incoming becomes active, the prior journals `override_resolved` with `resolved_by: 'supersede'`.
- **`incoming.precedence < active.precedence` (strictly lower):** ignored while the active override holds. Journal `override_suppressed_lower_precedence` with the incoming `override_id`. The active override is untouched.

> Phase-1 `precedence` is always `0`, so the live behaviour is
> last-write-wins (equal-precedence tie path). The general rule is encoded
> for forward-compat: when the backend later varies `precedence`, the
> higher one wins and lower ones are suppressed.

### Out of scope

- Backend trigger logic (game lifecycle, excitement threshold, operator action) — owned by `crowdaq-backend`. The player executes whatever `OverrideInjection` arrives.
- Operator-authored overlay content (`text` / `display_form`) — admin-request + audit-log only; NOT on the wire in phase-1 (`handler.ts:131-139`). The player renders bundled canned copy keyed on `override_class`.
- `payload_ref` content resolution — deferred to a future schema bump (D-GRH-56). Phase-1 `payload_ref` is `null`; the handler tolerates a non-null value by falling back to canned copy.
- Re-push on reconnect — the backend does NOT re-push `OverrideInjection` (SPEC-CRWDQ-081 "Reconnect — NOT in re-push"). The handler does not expect re-delivery; it relies on the active-slot state surviving the WS reconnect in-process.
- Anti-flap coalescing — D-GRH-24 explicitly assigns this to the backend.
- Per-override messaging-lane suppression (per-flag bypass) — D-GRH-58 specifies binary, no per-flag.
- `PlannedStateActivator` re-entry, `ProgramSlot` / `AdSlot` resolution, `AssetManifest` pre-fetch, and template families — the canned overlay is self-contained and does NOT touch any of these.

### depends_on rationale

`depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-049]`.

- **SPEC-CRWDQ-022 (Dispatcher)** — kept; the handler registers as the `OverrideInjection` control-channel handler.
- **SPEC-CRWDQ-049 (OverrideSuppressionState consumer)** — kept; this spec is the writer of the co-owned suppression token (049 = reader).
- **SPEC-CRWDQ-023 (PlannedStateActivator)** — REMOVED. The canned-overlay model is self-contained and does not re-enter the activator. There is no embedded PlannedState on the wire.
- **SPEC-CRWDQ-064 (AssetManifestStore)** — REMOVED. Canned overlays use bundled assets/copy; no manifest pre-fetch.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022; handler registers as the `OverrideInjection` handler. |
| `OverrideSuppressionState` | 1 in-process | Real instance — this spec owns it. |
| `OverrideOverlayRenderer` | 1 in-process | Real instance — this spec owns it; assert DOM mount/detach. |
| `MessagingLaneOverlay` (suppression listener) | 1 in-process | Real instance from SPEC-CRWDQ-049 — assert `data-suppressed` flips synchronously. |
| Auto-clear / future-arm timer | system boundary | Fake timers; assert arm at `valid_to` / `valid_from`. |
| WS source | 2 local-substitutable | Real WS fixture (in-process WebSocket server) per the SPEC-CRWDQ-027 e2e pattern. |
| Journal sink | 2 local-substitutable | In-memory. |
| Wall clock | system boundary | Frozen `Date.now()`. |

Test cases:

- **Activate in-window canned overlay (render swap < 250 ms).** Send an `OverrideInjection` with `override_class: 'emergency_safety'`, `valid_from <= now < valid_to`. Assert: the fullscreen safety overlay is mounted; total wall-clock from arrival to overlay DOM visible ≤ 250 ms (real WS fixture, real renderer); journal `override_activated`.
- **Class → treatment mapping.** For each `override_class`, assert the rendered overlay matches the treatment table (`emergency_safety`/`system_maintenance` → fullscreen; `scoreboard_correction`/`operator_alert` → top banner with the canned copy).
- **Dwell bypass (immediate activation).** An override arrives while a `PlannedState` is rendering. Assert: the override overlay activates immediately, without waiting for any D-DWELL minimum (D-GRH-24).
- **Override sets suppression.** Send an override. Assert: `overrideSuppressionState.isActive === true` after step 4; the SPEC-CRWDQ-049 overlay layer has `data-suppressed="true"` in the same tick.
- **Auto-clear at `valid_to`.** Override with a 10 s window. Advance the wall clock past `valid_to`. Assert: the timer fires; overlay detached; suppression flips to `false`; `MessagingLaneOverlay` resumes; journal `override_resolved` with `resolved_by: 'window'`.
- **Expired on arrival.** Override with `valid_to` already in the past. Assert: NOT rendered; suppression NOT set; journal `override_expired_on_arrival`.
- **Future activation.** Override with `valid_from` in the future. Assert: not rendered initially; advance the wall clock to `valid_from`; the overlay then activates and suppression sets.
- **Indefinite override (`valid_to === null`).** Send an override with `valid_to: null`. Assert: it activates and holds (no auto-clear timer armed); journal `override_indefinite`. It clears only on supersede.
- **Supersede by higher precedence.** Active override `precedence: 0`; incoming `precedence: 1`. Assert: the prior journals `override_resolved` with `resolved_by: 'supersede'`; the incoming is active; suppression stayed `true` (no flap to `false`).
- **Supersede on equal-precedence tie (last-write-wins).** Active override `precedence: 0`; incoming `precedence: 0`, different `override_id`. Assert: the incoming becomes active (last write); the prior journals `resolved_by: 'supersede'`.
- **Lower precedence suppressed.** Active override `precedence: 1`; incoming `precedence: 0`. Assert: the incoming is NOT rendered; the active override is untouched; journal `override_suppressed_lower_precedence`.
- **Idempotent re-push.** The same `override_id` twice. Assert: exactly one mount, exactly one suppression set, no duplicate journals.
- **Forward-compat non-null `payload_ref`.** Send an override with a non-null `payload_ref`. Assert: no crash; the canned overlay for `override_class` is rendered (content resolution deferred).
- **`runtime_reason` is journal-only (D-GRH-76).** Simulate a renderer mount failure. Assert: the journal contains `runtime_reason: 'render_error'`; the rendered DOM does NOT contain the string `"render_error"`, `"unavailable"`, or any enum-specific copy outside the canned overlay template.

## Vocabulary

- `OverrideInjection`, `override_id`, `override_class`, `payload_ref`, `valid_from`, `valid_to`, `precedence` — SPEC-CRWDQ-017 `OverrideInjectionPayload` (`crowdaq-backend src/wire/types.ts:61-69`). `OverrideInjection` is an `Envelope<OverrideInjectionPayload>` on the control channel (`seq` absent, `bar_id` present).
- "canned overlay" — the built-in, bundled-copy overlay rendered per `override_class` in phase-1 (no operator content on the wire).
- "dwell bypass" — D-GRH-24; the override activates immediately, bypassing dwell minimums.
- "rendering priority stack", "binary suppression" — D-GRH-58.
- `overrideSuppressionState` — the shared token contract defined in SPEC-CRWDQ-049, written here.
- "precedence-based supersede" — single active slot; higher precedence wins, tie = last-write-wins, lower is suppressed.
- `runtime_reason` — D-GRH-76, journal-only.
- `safe_reason` — D-GRH-76, patron-visible; explicitly NOT written by this spec.

## Acceptance Criteria

- [ ] `OverrideInjectionHandler.handle(frame)` is registered as the dispatcher's `OverrideInjection` handler on the control channel; `frame` is a SPEC-CRWDQ-017 `Envelope<OverrideInjectionPayload>` (`bar_id` present, `seq` absent) and the handler reads `override_id`, `bar_id`, `override_class`, `payload_ref`, `valid_from`, `valid_to`, `precedence` from `frame.payload` — and NO PlannedState render fields (none exist on the wire).
- [ ] The handler renders a built-in canned overlay chosen by `override_class` per the treatment table (`emergency_safety`/`system_maintenance` → fullscreen card; `scoreboard_correction` → top banner "Scoreboard under review"; `operator_alert` → top banner/toast "Notice"). Copy is bundled/canned — no operator text is read from the wire.
- [ ] A non-null `payload_ref` is tolerated (forward-compat): the handler falls back to the canned overlay for `override_class` and does not crash; phase-1 `payload_ref` is always `null`.
- [ ] On activation, `overrideSuppressionState.setActive(true)` fires synchronously; SPEC-CRWDQ-049's overlay layer flips to `data-suppressed="true"` in the same tick. On clear, `setActive(false)` runs and the overlay layer resumes.
- [ ] The override activates immediately on arrival when in-window (dwell bypass, D-GRH-24); it does NOT wait for any D-DWELL minimum.
- [ ] Window handling: an override already expired on arrival (`valid_to` in the past) is dropped and journals `override_expired_on_arrival` (no render, no suppression); a future override (`now < valid_from`) arms a wall-clock timer and activates at `valid_from`.
- [ ] Auto-clear: when `valid_to !== null`, a single wall-clock timer fires at `valid_to`, detaching the overlay, clearing suppression, and journaling `override_resolved` with `resolved_by: 'window'`. This replaces the former DwellTimer-dwell and OverrideTimeoutClock-TTL model.
- [ ] `valid_to === null` is treated as an indefinite override: it activates, holds until superseded, arms no expiry timer, and journals `override_indefinite`.
- [ ] Precedence-based supersede on a single active slot: `incoming.precedence > active.precedence` supersedes; equal precedence is last-write-wins; both displace the active override and journal `override_resolved` with `resolved_by: 'supersede'` (suppression stays `true` across the swap, no flap to `false`).
- [ ] An incoming override with strictly lower precedence than the active one is ignored while the active holds and journals `override_suppressed_lower_precedence`.
- [ ] The same `override_id` re-push is a no-op (exactly one mount, exactly one suppression set, no duplicate journals) — kept even though the backend does not re-push on reconnect (SPEC-CRWDQ-081).
- [ ] `runtime_reason` (D-GRH-76) is journal-only — a canned-overlay render failure journals `runtime_reason: 'render_error'` and NEVER renders the enum value on screen.
- [ ] Tests cover: in-window activation < 250 ms, class→treatment mapping, dwell bypass, suppression set/clear, auto-clear at `valid_to`, expired-on-arrival, future activation, indefinite (`valid_to: null`), supersede by higher precedence, equal-precedence last-write-wins, lower-precedence suppressed, idempotent re-push, non-null `payload_ref` fallback, and journal-only `runtime_reason`.
- [ ] No mocks of `Dispatcher`, `OverrideOverlayRenderer`, `MessagingLaneOverlay`, or `OverrideSuppressionState` (INV-FACTORY-16); only the WS source, wall clock, timers, and journal sink are substituted (INV-FACTORY-17).
