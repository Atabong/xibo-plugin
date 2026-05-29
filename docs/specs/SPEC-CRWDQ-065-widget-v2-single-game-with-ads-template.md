---
spec_id: SPEC-CRWDQ-065
title: Widget v2 single_game overlay-ad rendering
status: design-ready
owner: player-runtime/widget-v2/templates/with-ads
depends_on: [SPEC-CRWDQ-023, SPEC-CRWDQ-041, SPEC-CRWDQ-064]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-065 — Widget v2 single_game overlay-ad rendering

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S8 — Ad inventory + AdSlot render |
| Plane epic | CRWDQ-9 |
| Decisions referenced | D-GRH-15, D-GRH-16, D-GRH-21, D-GRH-23, D-GRH-30, D-GRH-50, D-GRH-55, D-GRH-62 |
| Source files | `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` (composed), `modules/widget-v2/src/templates/with-ads/AdPanel.ts` (composed), `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed), `modules/widget-v2/src/render/AdSlotResolver.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/with-ads/SingleGameOverlayAd.ts`, `modules/widget-v2/src/templates/with-ads/single-game-overlay-ad.css`, `modules/widget-v2/tests/templates/with-ads/single-game-overlay-ad.test.ts` |

> **Backend authority note — this spec was materially redesigned.** The
> authoritative backend spec `crowdaq-backend/docs/specs/SPEC-CRWDQ-039`
> (AdSlot interleave logic) is explicit that there is **NO
> `single_game_with_ads` business mode** — the closed 9-member D-GRH-30
> `BusinessMode` enum (confirmed in SPEC-CRWDQ-011) does not contain it.
> When the backend interleaver attaches an ad to a `single_game` content
> state it keeps `business_mode: "single_game"` UNCHANGED and only
> populates `ad_slot_id` (SPEC-CRWDQ-039 §6); the attached `AdSlot` is
> constrained to `ad_class: "overlay"` (SPEC-CRWDQ-039 §5). An earlier
> draft of this spec invented a `single_game_with_ads` mode and a
> player-side ad-rotation feature (`ad_rotation` / `rotation_cadence_ms`
> wire fields). Both are removed: the mode does not exist, and player-side
> ad progression contradicts D-GRH-62 ("the player has no ad-progression
> logic — `BarPlayerSchedulerService` pre-computes everything"). This spec
> is now the player-side rendering of an **overlay ad on an ordinary
> `single_game` `PlannedState`**.

## Module

`player-runtime :: widget-v2 :: templates/with-ads` (extends) — the player-side rendering path for a `single_game` `PlannedState` that carries a non-null `ad_slot_id`. There is no distinct `single_game_with_ads` business mode: the `PlannedState`'s `business_mode` stays `"single_game"`, and the presence of a non-null `ad_slot_id` is what selects this composite render over the bare `SingleGameTemplate`. The composite places the `SingleGameTemplate` (SPEC-CRWDQ-023) output as the full-surface content and renders the `AdPanel` (SPEC-CRWDQ-041) as an `overlay`-class ad layer above it. The ad creative is static for the slot's lifetime (D-GRH-62 — the player has no ad-progression logic; one creative per `AdSlot`, no rotation).

This spec is intentionally thin: it adds one new template file plus one CSS file. It introduces NO wire-protocol changes and NO new business mode.

## Current shape

- SPEC-CRWDQ-023 renders `single_game` with no ad surface. SPEC-CRWDQ-041 renders `multiple_games_with_ads` and `fixtures_with_ads` (the two genuine `_with_ads` composite modes) and explicitly defers the `single_game` overlay-ad path to this spec.
- Per SPEC-CRWDQ-039, the backend interleaver, when it attaches an ad to a `single_game` content state: keeps `business_mode: "single_game"`, keeps `template_id` unchanged, sets `ad_slot_id` to an `overlay`-class `AdSlot`'s id. It never produces a `single_game_with_ads` mode or template.
- D-GRH-15 / D-GRH-16 establish ad-coexistence: an ad never displaces content. For `single_game` the ad is an `overlay`-class layer drawn above the score render, not a side panel that re-flows the content.
- D-GRH-62: the player has no ad-progression logic — the backend pre-computes ad timing and inventory. A `single_game` `AdSlot` carries exactly one `ad_ref`; the player renders it static for the slot.

## Detecting the overlay-ad case

The shared `PlannedStateActivator` (SPEC-CRWDQ-023) dispatches a `PlannedStateFrame` whose `payload.business_mode === "single_game"` to the `single_game` activation path. That path branches on `payload.ad_slot_id`:

- `ad_slot_id === null` → mount the bare `SingleGameTemplate` (the SPEC-CRWDQ-023 path, unchanged).
- `ad_slot_id` non-null → mount `SingleGameOverlayAd` (this spec) — the `SingleGameTemplate` content with an `AdPanel` overlay.

Resolution: SPEC-CRWDQ-023 § single_game activation step 6 now declares the `ad_slot_id !== null` branch, and § Ad-slot branch owns the activator-side composite-shell instantiation, the empty-overlay placeholder behavior (with `ad_slot_payload_unavailable` journal) pending backend `AdSlot` delivery, and the `OverlayAdInstance` lifecycle contract. This spec is the owner of the composite template (`SingleGameOverlayAd`) the activator delegates to once an `AdSlot` payload is available.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/with-ads/SingleGameOverlayAd.ts
export interface SingleGameOverlayAd {
  mount(host: HTMLElement, ctx: SingleGameContext & { adSlot: AdSlot }): SingleGameOverlayAdInstance;
}

export interface SingleGameOverlayAdInstance extends TemplateInstance {
  detach(): HTMLElement;
  /** Implements the shared TemplateInstance.reconcile? hook (canonical
   *  signature owned by SPEC-CRWDQ-023). On a 'program_slot' variant the
   *  composite delegates to the content child's update path — for the
   *  bare single_game content child this is the SPEC-CRWDQ-023 soft
   *  re-render via ProgramSlotResolver / GameStateStore (the bare
   *  SingleGameInstance does not itself implement reconcile?, so this
   *  composite's reconcile is what bridges the program_slot event into
   *  a content refresh for the new primary_game_id). On an 'ad_slot'
   *  variant (unreachable until backend AdSlot delivery lands) the
   *  composite would refresh the overlay AdPanel; until then this is
   *  documented but unexercised. 'game_state_revision' is a no-op
   *  (the content child's GameStateStore subscription handles it). */
  reconcile(event: TemplateReconcileEvent): Promise<void>;
}
```

`TemplateInstance` and `TemplateReconcileEvent` are declared by SPEC-CRWDQ-023 (§ Reconcile dispatch) and consumed here verbatim.

The template reuses `SingleGameContext` from SPEC-CRWDQ-023 verbatim — no new field shape. `AdSlot` is the SPEC-CRWDQ-017 `AdSlotPayload` consumed via SPEC-CRWDQ-041's `AdSlotResolver` — exactly the shape `MultiGameWithAdsTemplate` / `FixturesWithAdsTemplate` already consume. This spec introduces NO new `AdSlot` fields. (An earlier draft added `ad_rotation` / `rotation_cadence_ms`; those are removed — the backend `AdSlotPayload` has no such fields and D-GRH-62 forbids player-side ad progression.)

For a `single_game` `AdSlot` the backend constrains `ad_class` to `"overlay"` (SPEC-CRWDQ-039 §5). The player does not re-validate `ad_class` but reads it for journaling.

### DOM shape — overlay composite

The `single_game` ad is an `overlay`-class ad: an absolutely-positioned layer ABOVE the full-surface `single_game` content, not a side panel. The content does NOT re-flow (D-GRH-16).

```
<section class="crowdaq-single-game-overlay-ad" data-game-id data-theme>
  <div class="cdq-content"><!-- SingleGameTemplate output, full surface, untouched --></div>
  <aside class="cdq-ad-overlay" data-ad-slot-id data-ad-class="overlay">
    <img class="cdq-ad-creative" alt="" src="<ad-asset-url>" />
  </aside>
</section>
```

```css
.crowdaq-single-game-overlay-ad { position: relative; }
.crowdaq-single-game-overlay-ad .cdq-content { position: absolute; inset: 0; }
.crowdaq-single-game-overlay-ad .cdq-ad-overlay {
  position: absolute;
  /* overlay-class anchor — corner or lower band; chosen by theme CSS (D-GRH-51) */
  pointer-events: none;
}
```

The content keeps the full surface; the ad overlay floats above it with `pointer-events: none`, so it never displaces or re-flows the score render — the D-GRH-16 "ad never displaces content" rule.

### Activation flow

For a `single_game` `PlannedStateFrame` with a non-null `payload.ad_slot_id: A` and `payload.program_slot_id: X`:

1. **Resolve `ProgramSlot`** + **resolve `AdSlot`.** The shared `PlannedStateActivator` buffers the `PlannedStateFrame` until BOTH `ProgramSlotResolver.has(X)` and `AdSlotResolver.has(A)` are true, with the SPEC-CRWDQ-023 5 s buffer timeout. On timeout, journal `template_buffer_timeout` and escalate to safe (SPEC-CRWDQ-052 Path C). (See the OPEN QUESTION in SPEC-CRWDQ-041 about how the `AdSlot` frame reaches the player.)
2. **Validate the ad asset.** `AssetManifestStore.get(adSlot.ad_ref)` — `ad_ref` is the `AssetManifest` `asset_id` directly. A synchronous cache hit → render the overlay composite. A miss → journal `ad_asset_cache_miss`, call `AssetManifestStore.ensure(adSlot.ad_ref)` to warm the cache, and fall back to mounting the bare `SingleGameTemplate` directly (no overlay layer). Per D-GRH-16, a missing ad creative must not blank or displace the game content.
3. **Run transition.** The shared `TransitionExecutor.run(plannedState.payload.transition, host)` — the wire catalog-name string; a catalog miss falls back per the SPEC-CRWDQ-023 `TransitionExecutor` contract.
4. **Mount the composite shell.** Build the `<section class="crowdaq-single-game-overlay-ad">` with the content + ad-overlay children.
5. **Mount the content child.** `SingleGameTemplate.mount(contentHost, ctx)` — unchanged behavior from SPEC-CRWDQ-023; the content subscribes to `GameStateStore` for `primary_game_id`.
6. **Mount the ad overlay.** `AdPanel.mount(adHost, { adSlot, assetManifestStore, positionClass: 'top' })` — the SPEC-CRWDQ-041 `AdPanel` primitive, rendering the single creative static for the slot. (`positionClass` selects an overlay-appropriate anchor; the SPEC-CRWDQ-041 `AdPanelContext.positionClass` enum already includes `'top'` / `'bottom'`.)
7. **Apply pending preferences** + **Arm dwell.** The same shared SPEC-CRWDQ-023 boundaries; the `AdPanel` records `ad_slot_rendered` on the image `load` event with `ad_slot_id`, `ad_ref`, `state_id`.

### Static, not rotating, ad

Per D-GRH-62 the player has no ad-progression logic. The overlay ad is mounted at slot start and unmounted at slot end. There is NO rotation between creatives within a slot — a `single_game` `AdSlot` carries exactly one `ad_ref`. If the backend wants a different ad later, it emits a new `single_game` `PlannedState` with a different `ad_slot_id` (a normal supersede). No video, no click behavior (bar screens are passive).

### Supersede / detach

When the parent `PlannedState` is superseded (a new `PlannedState` with a different `state_id`):

1. The shared outgoing transition runs on the `<section>`.
2. `SingleGameOverlayAdInstance.detach()` calls both children:
   - `SingleGameTemplate.detach()` (unsubscribes the `GameStateStore` listener for `primary_game_id`).
   - `AdPanel.detach()` (no subscriptions to unwind).
3. Journal `ad_slot_completed` with `ad_slot_id`, `ad_ref`, `state_id`, and the final `dwell_actual_ms` from the shared `DwellTimer`.

### Reconcile

Like SPEC-CRWDQ-041, the `single_game` content reacts to `GameState` events without a re-mount. A `ProgramSlot` revision (D-GRH-13, same `program_slot_id`) — for `single_game`, a `primary_game_id` change — propagates into `.cdq-content` via the content child's update path; the ad overlay is unaffected (it depends on the `AdSlot`, not the `ProgramSlot`). An `AdSlot` change arrives as a new `PlannedState` (different `state_id`), never as a `ProgramSlot` mutation.

### No new orchestration

Everything else — `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`, `AssetManifestStore`, `AdSlotResolver`, `OverrideSuppressionState` — is consumed from earlier specs. This spec adds exactly one new template file + one new CSS file. It introduces NO wire-protocol change and NO new business mode.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| Shared orchestration | 1 in-process | Real instances from SPEC-CRWDQ-023. |
| `SingleGameTemplate` | 1 in-process | Real instance — not mocked (INV-FACTORY-16). |
| `AdPanel` | 1 in-process | Real instance from SPEC-CRWDQ-041. |
| `AssetManifestStore` | 1 in-process | Real instance from SPEC-CRWDQ-064; pre-seed the ad asset URL via test driver. |
| `AdSlotResolver` | 1 in-process | Real. |
| DOM | 1 in-process | jsdom; assert the overlay composite structure + `data-ad-slot-id`. |
| Image `load` event | system boundary | Stub as in SPEC-CRWDQ-041. |
| `DwellTimer`, clock | system boundary | Fake timers. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- **Happy mount.** A `single_game` `PlannedState` with a non-null `ad_slot_id` referencing an `overlay`-class `AdSlot`. Assert: `<section class="crowdaq-single-game-overlay-ad">`; `.cdq-content` has `SingleGameTemplate` output; `.cdq-ad-overlay` has an `<img>` with `src` from the manifest; `data-ad-slot-id` equals `adSlot.ad_slot_id`.
- **Bare single_game (no ad).** A `single_game` `PlannedState` with `ad_slot_id === null` → the bare `SingleGameTemplate` is mounted (no `crowdaq-single-game-overlay-ad` section); this spec's composite is not used.
- **Composite buffered until `AdSlot` resolves.** A `single_game` `PlannedState` with `ad_slot_id` arrives before its `AdSlot` frame → the activator buffers and mounts on the `AdSlot` arrival within 5 s.
- **Missing `AdSlot` (never resolves).** `ad_slot_id` never resolves within 5 s → journal `template_buffer_timeout`; escalate to safe.
- **Ad asset cache miss.** `AssetManifestStore.get(adSlot.ad_ref)` → null → journal `ad_asset_cache_miss`, `ensure(adSlot.ad_ref)` called once; the composite falls back to the bare `SingleGameTemplate` (no overlay layer); the game content is preserved (D-GRH-16).
- **`ad_slot_rendered` journal.** Fires on the ad image's `load` event with `ad_slot_id`, `ad_ref`, `state_id`.
- **GameState event isolation.** A `GameEvent` for `primary_game_id` updates the score block in `.cdq-content`; the `.cdq-ad-overlay` `<img>` does NOT reload (same `src`).
- **Coexistence (no displacement).** In the rendered DOM, `.cdq-ad-overlay` is absolutely positioned with `pointer-events: none` and does not change the layout/size of `.cdq-content`.
- **Supersede.** A new `PlannedState` (different `state_id`) → the outgoing transition runs; `detach()` calls both children's `detach` exactly once; `ad_slot_completed` journaled with `ad_slot_id`, `ad_ref`, `state_id`, `dwell_actual_ms`.
- **Reconcile underlying `ProgramSlot`.** `programSlot.primary_game_id` changes via the D-GRH-13 path (same `program_slot_id`) → the content sub-template re-renders for the new game; the ad overlay `<img>` is unaffected (no flicker).
- **No rotation.** The `AdSlot` carries exactly one `ad_ref`; the overlay creative is static for the full slot — there is no rotation interval, no `ad_rotation` field, no per-creative cadence.

## Vocabulary

- `single_game` overlay ad — a `single_game` `PlannedState` (`business_mode` stays `"single_game"`) carrying a non-null `ad_slot_id`. There is no `single_game_with_ads` business mode (SPEC-CRWDQ-039 / SPEC-CRWDQ-011 9-member enum).
- `overlay`-class ad — the `ad_class` value the backend constrains a `single_game` `AdSlot` to (SPEC-CRWDQ-039 §5); the player renders it as an absolutely-positioned layer above the content.
- "coexistence" — D-GRH-16: an ad never displaces or re-flows content.

## Acceptance Criteria

- [ ] The `single_game` activation path branches on `payload.ad_slot_id`: a `null` `ad_slot_id` mounts the bare `SingleGameTemplate` (SPEC-CRWDQ-023, unchanged); a non-null `ad_slot_id` mounts `SingleGameOverlayAd`. There is NO `single_game_with_ads` business mode and no dispatch on such a mode value.
- [ ] `SingleGameOverlayAd.mount(host, ctx)` renders `<section class="crowdaq-single-game-overlay-ad">` containing `.cdq-content` (with `SingleGameTemplate` output unmodified, full surface) and `.cdq-ad-overlay` (with `AdPanel` output, absolutely positioned, `pointer-events: none`).
- [ ] A `single_game` `PlannedState` with a non-null `ad_slot_id` is buffered by the shared `PlannedStateActivator` until both its `ProgramSlot` and its `AdSlot` resolve (5 s timeout → `template_buffer_timeout` + escalate to safe).
- [ ] An `AssetManifestStore.get(adSlot.ad_ref)` miss journals `ad_asset_cache_miss`, calls `ensure(adSlot.ad_ref)`, and falls back to mounting the bare `SingleGameTemplate` (no overlay layer); the game content is preserved (D-GRH-16).
- [ ] The overlay ad is static for the slot's lifetime — exactly one `ad_ref` is rendered; there is NO rotation, NO `ad_rotation` field, NO rotation cadence (D-GRH-62 — the player has no ad-progression logic). The spec introduces NO new `AdSlot` / `AdSlotPayload` wire fields.
- [ ] `ad_slot_rendered` journal fires on the ad image's `load` event with `ad_slot_id`, `ad_ref`, `state_id`.
- [ ] `GameState` events update only `.cdq-content`; the `.cdq-ad-overlay` `<img>` does not re-render.
- [ ] Coexistence: the ad overlay is absolutely positioned and never changes the layout or size of `.cdq-content` (D-GRH-15, D-GRH-16).
- [ ] `SingleGameOverlayAdInstance` implements the shared `TemplateInstance.reconcile?(event: TemplateReconcileEvent)` hook owned by SPEC-CRWDQ-023. On `{ kind: 'program_slot', slot }` an underlying `ProgramSlot` reconcile (e.g. a `primary_game_id` change via D-GRH-13) propagates into `.cdq-content`; the ad overlay `<img>` is unaffected. `ad_slot` variant is documented but unreachable until backend `AdSlot` delivery lands; `game_state_revision` is a no-op.
- [ ] Supersede: the outgoing transition runs; `detach()` calls both children's `detach` exactly once; `ad_slot_completed` is journaled with `ad_slot_id`, `ad_ref`, `state_id`, and `dwell_actual_ms` from the shared `DwellTimer`.
- [ ] Tests cover: happy mount, bare single_game (no ad), composite buffered until AdSlot resolves, missing AdSlot, ad asset cache miss fallback, `ad_slot_rendered` journal, GameState event isolation, coexistence (no displacement), supersede, ProgramSlot reconcile, no-rotation.
- [ ] Tests use real `SingleGameTemplate` and real `AdPanel` instances (INV-FACTORY-16); only the WS source, clock, image `load` event, and journal sink are substituted (INV-FACTORY-17).
