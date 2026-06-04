---
spec_id: SPEC-CRWDQ-049
title: Widget v2 overlay layer for MessagingLane render
status: impl-ready
owner: player-runtime/widget-v2/overlays/messaging-lane
depends_on: [SPEC-CRWDQ-022, SPEC-CRWDQ-023]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-049 — Widget v2 overlay layer for MessagingLane render

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S10 — MessagingLane (out-of-band text overlay) |
| Plane epic | CRWDQ-11 |
| Decisions referenced | D-GRH-29, D-GRH-57, D-GRH-58 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed) |
| New files | `modules/widget-v2/src/overlays/MessagingLaneOverlay.ts`, `modules/widget-v2/src/overlays/MessagingLaneStore.ts`, `modules/widget-v2/src/overlays/OverlayLayer.ts`, `modules/widget-v2/src/overlays/messaging-lane.css`, `modules/widget-v2/tests/overlays/*.test.ts` |

> **Backend authority note:** The `MessagingLane` wire frame consumed by
> this overlay is produced by the authoritative backend specs
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-047` (the `POST /messaging-lane`
> endpoint that validates the payload) and `SPEC-CRWDQ-048` (the NATS
> publisher), over the wire-protocol envelope of `SPEC-CRWDQ-017`. Every
> claim below about the `display_form` enum, the `dwell_ms` range, and the
> validity window is cross-checked against those specs. The backend is the
> source of truth.

## Module

`player-runtime :: widget-v2 :: overlays/messaging-lane` — the player overlay layer that subscribes to `MessagingLane` frames on the control channel (D-GRH-57), renders text overlays on top of the active `PlannedState` without reflow, honors per-message `display_form` and `dwell_ms`, and auto-expires on the wall-clock `valid_until`. Suppressed during an active `OverrideInjection` (D-GRH-58); resumes automatically when the override dwell ends if `valid_until` has not passed.

## Backend wire-contract facts (SPEC-CRWDQ-047 / -048 / -017 cross-check)

- `MessagingLane` is a SPEC-CRWDQ-017 `Envelope<MessagingLanePayload>` on the **control** channel. The dispatcher hands `store.upsert` the parsed envelope; the message fields live in `payload`.
- The authoritative `MessagingLanePayload` (SPEC-CRWDQ-047 / -048) is exactly: `{ bar_id, lane_id, text, display_form, dwell_ms, valid_from, valid_until }`.
- **`display_form` is the closed three-value enum `{banner, ticker, toast}`** (SPEC-CRWDQ-047 — a value outside that set is rejected at the endpoint with `400 unknown_enum`). An earlier draft of this spec used a four-value set `{overlay, lower_third, ticker, side_rail}`; that is wrong — only `ticker` overlapped. This template handles exactly `{banner, ticker, toast}`.
- **`dwell_ms` is an integer in `[1000, 600000]`** (1 s … 10 min), validated by SPEC-CRWDQ-047. An earlier draft of this spec treated `dwell_ms === 0` as a "sticky" sentinel — but the backend REJECTS `dwell_ms` below 1000 (`dwell_out_of_range`), so `0` never reaches the player. There is no sticky-`0` case; every `MessagingLane` carries a finite `dwell_ms ≥ 1000`.
- The validity window is `[valid_from, valid_until)`; SPEC-CRWDQ-047 guarantees `valid_until > valid_from` and `valid_until − valid_from ≤ 1h`. `dwell_ms` (the per-render on-screen duration) and the validity window (how long the message is eligible to be shown) are independent.
- The text is markup-free: SPEC-CRWDQ-047 rejects any `text` containing `<`, `>`, or `&` at the endpoint, so the player can render `text` as `textContent` without sanitisation.

## Current shape

- No overlays in v1. The MVP widget has a single render surface and no "above-the-content" layer.
- D-GRH-57 specifies the `MessagingLane` message: a transient, text-only overlay; a new message with the same `lane_id` replaces the prior one on the player side. The backend `AdminGatewayService` publishes it to the NATS subject `bar.<bar_id>.control.messaging-lane` (SPEC-CRWDQ-048's per-action leaf subject); `GameDeliveryService` forwards it over the WS.
- D-GRH-58 specifies the rendering priority stack: `OverrideInjection` > `PlannedState` > `MessagingLane`. Binary suppression — all overrides suppress all lanes; no per-override flag.

The override-suppression hook needs a shared state token because `OverrideInjection` rendering is owned by **SPEC-CRWDQ-063** (the override-injection handler), not this slice. This spec defines the read-only consumer view of that shared token (`overrideSuppressionState`); SPEC-CRWDQ-063 is the writer that flips it.

## Proposed deep interface

```ts
// modules/widget-v2/src/overlays/MessagingLaneOverlay.ts
export interface MessagingLaneOverlay {
  /**
   * Mount the persistent overlay layer onto the root host element.
   * The layer is a fixed-position container that floats above the
   * active PlannedState's host. Returns an unmount handle.
   */
  mount(rootHost: HTMLElement, ctx: MessagingLaneOverlayContext): () => void;
}

export interface MessagingLaneOverlayContext {
  store: MessagingLaneStore;
  /** The read-only consumer view of the shared override-suppression token.
   *  SPEC-CRWDQ-063 owns the writer (setActive); this overlay only reads
   *  isActive and subscribes. */
  overrideSuppressionState: { isActive: boolean; subscribe(listener: (active: boolean) => void): () => void };
}
```

```ts
// modules/widget-v2/src/overlays/MessagingLaneStore.ts
export interface MessagingLaneStore {
  /**
   * Upsert by lane_id (D-GRH-57). A new frame with the same lane_id
   * replaces the prior entry. Validity-bounded entries are kept until
   * valid_until passes, then evicted by a clock tick.
   */
  upsert(frame: MessagingLaneFrame): void;

  /** Active (within the validity window) entries, keyed by lane_id. */
  active(now: Date): readonly MessagingLaneEntry[];

  subscribe(listener: (entries: readonly MessagingLaneEntry[]) => void): () => void;
}

/**
 * MessagingLaneFrame is the SPEC-CRWDQ-017 Envelope<MessagingLanePayload> —
 * { schema_version, channel: 'control', message_type: 'MessagingLane', ts,
 *   payload: MessagingLanePayload }. The dispatcher hands the parsed envelope
 * to upsert(); the store reads the message fields from frame.payload.
 */
export interface MessagingLaneEntry {
  lane_id: string;
  text: string;                 // markup-free (SPEC-CRWDQ-047 rejects < > &); rendered as textContent
  display_form: 'banner' | 'ticker' | 'toast';  // the closed SPEC-CRWDQ-047 enum
  dwell_ms: number;             // integer [1000, 600000] — per-render on-screen duration; never 0
  valid_from: string;           // ISO 8601 UTC
  valid_until: string;          // ISO 8601 UTC
  /** Local mount timestamp; combined with dwell_ms for cycle display. */
  receivedAt: Date;
}
```

```ts
// modules/widget-v2/src/overlays/OverlayLayer.ts
/**
 * Per-display_form rendering primitive. One DOM container per form,
 * mounted once at boot, shown/hidden based on the active lane set.
 */
export interface OverlayLayer {
  render(entry: MessagingLaneEntry | null, displayForm: MessagingLaneEntry['display_form']): void;
}
```

### Wiring

The overlay layer is mounted once at boot, alongside the main render host. It is NOT part of any `PlannedState` template. The dispatch registration for `MessagingLane` frames is:

```ts
dispatcher.register('MessagingLane', (frame) => store.upsert(frame), 'control');
```

The overlay subscribes to `store` updates AND to `overrideSuppressionState`. Render logic:

1. If `overrideSuppressionState.isActive`, render nothing (hide all `display_form` containers).
2. Else: for each `display_form`, find the most-recent active entry with that form and render it; cycle through entries of that form per the cadence below.

### DOM shape

```
<div class="crowdaq-overlay-layer" data-suppressed="false">
  <div class="cdq-overlay" data-form="banner" hidden>
    <span class="cdq-overlay-text" data-lane-id></span>
  </div>
  <div class="cdq-overlay" data-form="ticker" hidden>
    <span class="cdq-overlay-text" data-lane-id></span>
  </div>
  <div class="cdq-overlay" data-form="toast" hidden>
    <span class="cdq-overlay-text" data-lane-id></span>
  </div>
</div>
```

There is exactly one `.cdq-overlay` child per `display_form` enum value (`banner`, `ticker`, `toast`). `data-suppressed` flips to `true` when an override is active. CSS hides all `.cdq-overlay` children when the parent has `data-suppressed="true"`. This keeps suppression visually atomic — no per-form un-render needed.

### Validity window and cycling

- An entry is active iff `valid_from <= now < valid_until` (UTC compare against `Date.now()`).
- For a given `display_form`:
  - If exactly one active entry → render that entry continuously until expiry or supersede.
  - If multiple active entries → cycle: each shown for its own `dwell_ms`, then the next in receive order. After the last, loop.
- `dwell_ms` is always a finite integer in `[1000, 600000]` (SPEC-CRWDQ-047 guarantee) — there is no sticky-`0` case. A single active entry effectively "pins" because the cycle has only one member; it is replaced when an upsert on its `lane_id` supersedes it or its `valid_until` passes.
- Expiry tick: a single 1 Hz interval re-queries `store.active(new Date())`. Cheap; the store keeps ≤ ~10 entries in practice (one per active lane).
- On expiry of the currently-displayed entry, the cycle picks the next active entry; if none, the form's container goes `hidden`.

### Override suppression

When `overrideSuppressionState.isActive` flips to `true`:

1. Set `data-suppressed="true"` on the layer container.
2. Note the current cycle position per `display_form` for resume.
3. Do NOT cancel the expiry tick — entries continue to age in the store. An entry whose `valid_until` passes during suppression is correctly evicted; on resume it does not reappear.

When suppression flips back to `false`:

1. Set `data-suppressed="false"`.
2. Re-query the active entries via `store.active(now)`.
3. Resume cycling from the freshest active entry per form (per D-GRH-58 "automatically resume"; the freshest is the most recently upserted within validity).

### No reflow

The overlay layer is `position: absolute; inset: 0; pointer-events: none;`. It never affects the layout of the `PlannedState` templates underneath. Per-form children use absolute positioning with form-specific anchors:

- `banner` — top edge, full-width.
- `ticker` — bottom-edge strip, horizontal scroll.
- `toast` — corner-anchored, transient pop.

Text overlays are plain `<span>` content rendered via `textContent` (D-GRH-57 text-only; SPEC-CRWDQ-047 already rejects `<`, `>`, `&` at the endpoint) — no HTML interpretation, no asset references, no media.

### Out of scope

- `OverrideInjection` rendering itself — owned by SPEC-CRWDQ-063 (the override-injection handler), which writes `overrideSuppressionState`.
- Multiple-`bar_id` filtering — the WS connection is per-display, so all `MessagingLane` frames arriving on it are for the connected bar. Per-display routing (if a bar has multiple screens authored differently in the future) is not in this iteration.
- Rich media overlays (images, video) — D-GRH-57 explicitly defers asset-bearing messaging.
- Click / tap interaction — bar screens are passive (the same constraint as the ad panel).

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022. |
| `MessagingLaneStore` | 1 in-process | Real instance. |
| `overrideSuppressionState` | 2 local-substitutable | `FakeSuppressionState` with `setActive(boolean)` and listener fanout. |
| DOM | 1 in-process | jsdom. |
| Clock | system boundary | Fake timers; advance to assert the cycle + expiry. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Single overlay mount: `MessagingLane { lane_id: "L1", display_form: "banner", text: "Happy Hour", dwell_ms: 8000, valid_from: now, valid_until: now+1h }` → `.cdq-overlay[data-form="banner"]` shown with the text; `data-lane-id="L1"`.
- Replace by lane_id: send the same `lane_id` with different `text` → the existing DOM text mutates; no flicker (no hidden→shown re-cycle).
- Multi-lane different forms: 2 frames, `display_form: "banner"` and `"ticker"` → both containers rendered simultaneously.
- Multi-entry same form, cycling: 2 frames with the same `display_form: "banner"`, `dwell_ms: 8000` each → the first shown for 8 s, then the second for 8 s, loop.
- Single active entry: an active entry with no peers in its form is shown continuously until expiry or supersede (the cycle has one member).
- Validity expiry: the clock advances past `valid_until` → the container goes `hidden`; journal `messaging_lane_expired`.
- Outside `valid_from`: a frame arrives but `valid_from > now` → stored but not rendered until the clock reaches `valid_from`.
- Override suppression on: `overrideSuppressionState.setActive(true)` → the layer `data-suppressed="true"`; all `.cdq-overlay` hidden visually (verified via computed style if jsdom supports, else by attribute).
- Override suppression off: the cycle resumes from the freshest active entry; journal `messaging_lane_resumed` per form.
- Suppression during expiry: an entry's `valid_until` passes mid-suppression → on resume it does NOT reappear; journal `messaging_lane_expired_during_suppression`.
- Invalid `display_form`: a frame with `display_form: "popup"` (a value outside `{banner, ticker, toast}`) → journal `schema_violation_received`; not stored. (This is defense-in-depth — SPEC-CRWDQ-047 already rejects an out-of-enum `display_form` at the endpoint, so such a frame should never reach the wire; the player still guards.)

## Vocabulary

- `MessagingLane`, `lane_id`, `display_form`, `dwell_ms`, `valid_from`, `valid_until` — D-GRH-57; the wire shape is the SPEC-CRWDQ-047 / -048 `MessagingLanePayload`.
- `display_form` — the closed three-value enum `{banner, ticker, toast}` (SPEC-CRWDQ-047).
- "rendering priority stack" — D-GRH-58.
- "suppression" — binary, per D-GRH-58.

## Acceptance Criteria

- [ ] `MessagingLaneOverlay.mount(rootHost, ctx)` adds a `<div class="crowdaq-overlay-layer" data-suppressed>` with exactly one `<div class="cdq-overlay" data-form>` per closed-enum value (`banner`, `ticker`, `toast`); each child starts `hidden`.
- [ ] The dispatcher's `MessagingLane` handler upserts the `Envelope<MessagingLanePayload>` into `MessagingLaneStore` by `lane_id` — a new frame with the same `lane_id` replaces the prior in-place; the layer's DOM text mutates without a hide/show flicker.
- [ ] An entry is active iff `valid_from <= now < valid_until`; entries outside the window are stored but not rendered; a 1 Hz tick re-evaluates and journals `messaging_lane_expired` on expiry.
- [ ] Multiple active entries on the same `display_form` cycle, each entry shown for its own `dwell_ms` (a finite integer in `[1000, 600000]`); there is no sticky-`0` case (the backend rejects `dwell_ms < 1000`).
- [ ] `data-suppressed` flips to `"true"` when `overrideSuppressionState.isActive` → all overlay forms hide; it flips back on suppression release; the cycle resumes from the freshest active entry per form and journals `messaging_lane_resumed`.
- [ ] An entry whose `valid_until` passes during suppression is evicted; on resume it does not reappear; journals `messaging_lane_expired_during_suppression`.
- [ ] The overlay layer is positioned `absolute` and never affects the layout of the `PlannedState` template underneath (`pointer-events: none`, `inset: 0`).
- [ ] Text content renders as plain text (`textContent`) — no `innerHTML`, no asset reference, no media; an unknown `display_form` (outside `{banner, ticker, toast}`) journals `schema_violation_received` and is not stored.
- [ ] Tests cover: single mount, replace-by-lane_id, multi-form coexistence, cycling, single-active-entry, expiry, outside `valid_from`, override on/off, expiry-during-suppression, invalid `display_form`.
- [ ] No mocks of `MessagingLaneStore`, `OverlayLayer`, or `Dispatcher` (INV-FACTORY-16); only the override-suppression source and the clock are substituted (INV-FACTORY-17).
