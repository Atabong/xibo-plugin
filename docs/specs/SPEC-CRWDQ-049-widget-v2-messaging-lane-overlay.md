---
spec_id: SPEC-CRWDQ-049
title: Widget v2 overlay layer for MessagingLane render
status: draft
parent: S10
area: player-runtime/widget-v2/overlays/messaging-lane
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-049 — Widget v2 overlay layer for MessagingLane render

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S10 — MessagingLane (out-of-band text overlay) |
| Plane epic | CRWDQ-11 |
| Decisions referenced | D-GRH-25, D-GRH-29, D-GRH-57, D-GRH-58 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed) |
| New files | `modules/widget-v2/src/overlays/MessagingLaneOverlay.ts`, `modules/widget-v2/src/overlays/MessagingLaneStore.ts`, `modules/widget-v2/src/overlays/OverlayLayer.ts`, `modules/widget-v2/src/overlays/messaging-lane.css`, `modules/widget-v2/tests/overlays/*.test.ts` |
| Blocked by | SPEC-CRWDQ-022 (WS client), SPEC-CRWDQ-023 (`OverrideInjection` suppression state — shared) |

## Module

`player-runtime :: widget-v2 :: overlays/messaging-lane` — the player overlay layer that subscribes to `MessagingLane` frames on the control channel (D-GRH-57), renders text overlays on top of the active `PlannedState` without reflow, honors per-message `display_form` and `dwell_ms`, auto-expires on wall-clock `valid_until`. Suppressed during active `OverrideInjection` (D-GRH-58); resumes automatically when override dwell ends if `valid_until` hasn't passed.

## Current shape

- No overlays in v1. The MVP widget has a single render surface and no "above-the-content" layer.
- D-GRH-57 specifies the `MessagingLane` schema: `lane_id`, `text`, `display_form`, `dwell_ms`, `valid_from`, `valid_until`. New message with same `lane_id` replaces prior. Backend `AdminGatewayService` publishes to `bar.<bar_id>.control`; `GameDeliveryService` forwards over the WS.
- D-GRH-58 specifies the rendering priority stack: `OverrideInjection` > `PlannedState` > `MessagingLane`. Binary suppression — all overrides suppress all lanes; no per-override flag.

The override-suppression hook needs a shared state token because `OverrideInjection` rendering is owned by a later spec (out of this slice). This spec defines the contract for that shared token; the actual override-rendering owner (out of scope here) writes it.

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
  overrideSuppressionState: { isActive: boolean; subscribe(listener: (active: boolean) => void): () => void };
}
```

```ts
// modules/widget-v2/src/overlays/MessagingLaneStore.ts
export interface MessagingLaneStore {
  /**
   * Upsert by lane_id (D-GRH-57). New message replaces prior for the
   * same lane_id. Validity-bounded entries are kept until valid_until
   * passes, then evicted by a clock tick.
   */
  upsert(frame: MessagingLaneFrame): void;

  /** Active (within validity window) entries, keyed by lane_id. */
  active(now: Date): readonly MessagingLaneEntry[];

  subscribe(listener: (entries: readonly MessagingLaneEntry[]) => void): () => void;
}

export interface MessagingLaneEntry {
  lane_id: string;
  text: string;
  display_form: 'overlay' | 'lower_third' | 'ticker' | 'side_rail';
  dwell_ms: number;             // 0 = sticky until next update (D-GRH-57)
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
2. Else: for each `display_form`, find the most-recent active entry with that form and render it; cycle through entries whose `dwell_ms > 0` per the cadence below.

### DOM shape

```
<div class="crowdaq-overlay-layer" data-suppressed="false">
  <div class="cdq-overlay" data-form="overlay" hidden></div>
  <div class="cdq-overlay" data-form="lower_third" hidden>
    <span class="cdq-overlay-text" data-lane-id></span>
  </div>
  <div class="cdq-overlay" data-form="ticker" hidden>
    <span class="cdq-overlay-text" data-lane-id></span>
  </div>
  <div class="cdq-overlay" data-form="side_rail" hidden></div>
</div>
```

`data-suppressed` flips to `true` when an override is active. CSS hides all `.cdq-overlay` children when the parent has `data-suppressed="true"`. This keeps suppression visually atomic — no per-form un-render needed.

### Validity window and cycling

- An entry is active iff `valid_from <= now < valid_until` (UTC compare against `Date.now()`).
- For a given `display_form`:
  - If exactly one active entry → render that entry continuously until expiry or supersede.
  - If multiple active entries with `dwell_ms > 0` → cycle: each shown for `dwell_ms`, then next in receive order. After the last, loop.
  - If an active entry has `dwell_ms === 0` (sticky) → it pins until either superseded by an upsert on its `lane_id` or its `valid_until` passes.
- Expiry tick: a single 1 Hz interval re-queries `store.active(new Date())`. Cheap; the store keeps ≤ ~10 entries in practice (one per active lane).
- On expiry of the currently-displayed entry, the cycle picks the next active; if none, the form's container goes `hidden`.

### Override suppression

When `overrideSuppressionState.isActive` flips to `true`:

1. Set `data-suppressed="true"` on the layer container.
2. Note the current cycle position per `display_form` for resume.
3. Do NOT cancel the expiry tick — entries continue to age in the store. An entry whose `valid_until` passes during suppression is correctly evicted; on resume it doesn't reappear.

When suppression flips back to `false`:

1. Set `data-suppressed="false"`.
2. Re-query active entries via `store.active(now)`.
3. Resume cycling from the freshest active entry per form (per D-GRH-58 "automatically resume"; the freshest is the most recently upserted within validity).

### No reflow

The overlay layer is `position: absolute; inset: 0; pointer-events: none;`. It never affects the layout of `PlannedState` templates underneath. Per-form children use absolute positioning with form-specific anchors:

- `overlay` — centered, full-width.
- `lower_third` — bottom 1/3, full-width.
- `ticker` — bottom-edge strip, horizontal scroll.
- `side_rail` — right column, half-height.

Text overlays are plain `<span>` content (D-GRH-57 text-only); no HTML interpretation, no asset references, no media.

### Out of scope

- `OverrideInjection` rendering itself — owned by a later spec (S10+ or S11).
- Multiple-`bar_id` filtering — the WS connection is per-display, so all `MessagingLane` frames arriving on it are for the connected bar. Per-display routing (if a bar has multiple screens authored differently in the future) is not in this iteration.
- Rich media overlays (images, video) — D-GRH-57 explicitly defers asset-bearing messaging.
- Click / tap interaction — bar screens are passive (same constraint as the ad panel).

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022. |
| `MessagingLaneStore` | 1 in-process | Real instance. |
| `overrideSuppressionState` | 2 local-substitutable | `FakeSuppressionState` with `setActive(boolean)` and listener fanout. |
| DOM | 1 in-process | jsdom. |
| Clock | system boundary | Fake timers; advance to assert cycle + expiry. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- Single overlay mount: `MessagingLane { lane_id: "L1", display_form: "lower_third", text: "Happy Hour", dwell_ms: 8000, valid_from: now, valid_until: now+1h }` → `.cdq-overlay[data-form="lower_third"]` shown with text; `data-lane-id="L1"`.
- Replace by lane_id: send same `lane_id` with different `text` → existing DOM text mutates; no flicker (no hidden→shown re-cycle).
- Multi-lane different forms: 2 frames, `display_form: "lower_third"` and `"ticker"` → both containers rendered simultaneously.
- Multi-entry same form, cycling: 2 frames same `display_form: "lower_third"`, `dwell_ms: 8000` each → first shown for 8 s, then second for 8 s, loop.
- Sticky entry (`dwell_ms: 0`): persists until upsert or expiry.
- Validity expiry: clock advances past `valid_until` → container goes `hidden`; journal `messaging_lane_expired`.
- Outside `valid_from`: frame arrives but `valid_from > now` → stored but not rendered until clock reaches `valid_from`.
- Override suppression on: `overrideSuppressionState.setActive(true)` → layer `data-suppressed="true"`; all `.cdq-overlay` hidden visually (verified via computed style if jsdom supports, else by attribute).
- Override suppression off: cycle resumes from freshest active entry; journal `messaging_lane_resumed` per form.
- Suppression during expiry: an entry's `valid_until` passes mid-suppression → on resume it does NOT reappear; journal `messaging_lane_expired_during_suppression`.
- Invalid `display_form`: frame with `display_form: "popup"` (unknown) → journal `schema_violation_received`; not stored.

## Vocabulary

- `MessagingLane`, `lane_id`, `display_form`, `dwell_ms`, `valid_from`, `valid_until` — D-GRH-57.
- "rendering priority stack" — D-GRH-58.
- "suppression" — binary, per D-GRH-58.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-022 — `Dispatcher` for `MessagingLane` routing.
- SPEC-CRWDQ-023 — the `OverrideInjection` suppression-state shape is established alongside the shared orchestration; this spec defines the interface this overlay reads.

**Blocks (downstream):**

- A future `OverrideInjection` renderer (out of catalog) — must write to the shared `overrideSuppressionState` token defined here.

## Acceptance Criteria

- [ ] `MessagingLaneOverlay.mount(rootHost, ctx)` adds a `<div class="crowdaq-overlay-layer" data-suppressed>` with one `<div class="cdq-overlay" data-form>` per closed-enum value (`overlay`, `lower_third`, `ticker`, `side_rail`); each child starts `hidden`.
- [ ] The dispatcher's `MessagingLane` handler upserts into `MessagingLaneStore` by `lane_id` — new frame with same `lane_id` replaces prior in-place; the layer's DOM text mutates without hide/show flicker.
- [ ] An entry is active iff `valid_from <= now < valid_until`; entries outside the window are stored but not rendered; a 1 Hz tick re-evaluates and journals `messaging_lane_expired` on expiry.
- [ ] Multiple active entries on the same `display_form` cycle with each entry's `dwell_ms` (when `dwell_ms > 0`); `dwell_ms === 0` is sticky until supersede or expiry.
- [ ] `data-suppressed` flips to `"true"` when `overrideSuppressionState.isActive` → all overlay forms hide; flips back on suppression release; cycle resumes from the freshest active entry per form and journals `messaging_lane_resumed`.
- [ ] An entry whose `valid_until` passes during suppression is evicted; on resume it does not reappear; journals `messaging_lane_expired_during_suppression`.
- [ ] Overlay layer is positioned absolute and never affects layout of the `PlannedState` template underneath (`pointer-events: none`, `inset: 0`).
- [ ] Text content renders as plain text (`textContent`) — no `innerHTML`, no asset reference, no media; unknown `display_form` journals `schema_violation_received` and is not stored.
- [ ] Tests cover: single mount, replace-by-lane_id, multi-form coexistence, cycling, sticky, expiry, outside `valid_from`, override on/off, expiry-during-suppression, invalid display_form.
- [ ] No mocks of `MessagingLaneStore`, `OverlayLayer`, or `Dispatcher` (INV-FACTORY-16); only the override suppression source and clock are substituted.
