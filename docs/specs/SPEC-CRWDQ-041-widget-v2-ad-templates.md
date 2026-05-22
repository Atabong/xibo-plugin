---
spec_id: SPEC-CRWDQ-041
title: Widget v2 ad render template + fixtures_with_ads composite
status: draft
owner: player-runtime/widget-v2/templates/with-ads
depends_on: [SPEC-CRWDQ-031, SPEC-CRWDQ-034, SPEC-CRWDQ-064]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-041 — Widget v2 ad render template + fixtures_with_ads composite

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S8 — Ad inventory + AdSlot render |
| Plane epic | CRWDQ-9 |
| Decisions referenced | D-GRH-15, D-GRH-16, D-GRH-21, D-GRH-23, D-GRH-29, D-GRH-30, D-GRH-50, D-GRH-55, D-GRH-62 |
| Source files | `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064); `MultiGameTemplate.ts` (SPEC-CRWDQ-031), `FixturesTemplate.ts` (SPEC-CRWDQ-034) (composed) |
| New files | `modules/widget-v2/src/templates/with-ads/AdPanel.ts`, `modules/widget-v2/src/templates/with-ads/MultiGameWithAdsTemplate.ts`, `modules/widget-v2/src/templates/with-ads/FixturesWithAdsTemplate.ts`, `modules/widget-v2/src/templates/with-ads/with-ads.css`, `modules/widget-v2/src/render/AdSlotResolver.ts`, `modules/widget-v2/tests/templates/with-ads/*.test.ts` |

> **Backend authority note:** The `AdSlot` wire shape and the `_with_ads`
> composite `PlannedState`s this template consumes are produced by the
> authoritative backend spec `crowdaq-backend/docs/specs/SPEC-CRWDQ-039`
> (AdSlot interleave logic), over the wire-protocol envelope of
> `SPEC-CRWDQ-017`. Every claim below about business modes, the absence of
> an `ad` mode / `single_game_with_ads` mode, the composite `template_id`s,
> and the `adSlotId`-attach model is cross-checked against SPEC-CRWDQ-039.
> The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: templates/with-ads` — implements the with-ads composite templates `multiple_games_with_ads` and `fixtures_with_ads` per D-GRH-15, D-GRH-16. A dedicated ad panel coexists with game cards / fixture cards; the panel is always visible during the slot, never displaces content. The ad creative is resolved via `AssetManifest` keyed by `ad_ref` (D-GRH-55 phase-1: an `asset_id`). The player never decides ad timing, ad inventory, or ad rotation — `BarPlayerSchedulerService` pre-computes everything (D-GRH-62; SPEC-CRWDQ-039).

> **Scope flag — two composites only.** This spec covers `multiple_games_with_ads` and `fixtures_with_ads`. There is **no `single_game_with_ads` business mode** — per SPEC-CRWDQ-039, when the interleaver attaches an ad to a `single_game` content state it keeps `business_mode: "single_game"` unchanged and only populates `ad_slot_id`; the closed D-GRH-30 business-mode enum has no `single_game_with_ads` member. Overlay-ad rendering on the `single_game` template (reading the `ad_slot_id` off an unflipped `single_game` `PlannedState`) is owned by **SPEC-CRWDQ-065**, which composes the same `AdPanel` primitive added here. This spec does not produce, consume, or reference a `single_game_with_ads` mode.

> **Scope flag — no pure-ad slot.** Per SPEC-CRWDQ-039 §"No new PlannedStates", the interleaver NEVER inserts a standalone ad-only `PlannedState`; there is no `ad` business mode. An ad always coexists with content (a game grid or a fixture list). This spec therefore has no full-screen pure-ad host shell — every template here is a content + ad composite.

> **Dependencies.** This spec composes `MultiGameTemplate` (SPEC-CRWDQ-031) and `FixturesTemplate` (SPEC-CRWDQ-034) and consumes `AssetManifestStore` (SPEC-CRWDQ-064) — all three hard build dependencies in `depends_on`; 031/034 transitively bring the shared orchestration (SPEC-CRWDQ-023) and the WS dispatcher (SPEC-CRWDQ-022). **SPEC-CRWDQ-039** (`BarPlayerSchedulerService` AdSlot interleave logic) is the cross-repo `crowdaq-backend` *producer* of the `_with_ads` composite `PlannedState`s this spec consumes — a wire-contract counterpart, not a build dependency, so it is not in `depends_on`.

## Current shape

- No ad rendering in v1. The MVP widget has no ad path, no ad creative cache, no ad-bearing template.
- SPEC-CRWDQ-031 adds the multi-game grid; SPEC-CRWDQ-034 adds the fixtures list. Both render content templates with no ad panel.
- Per SPEC-CRWDQ-039, an ad is attached by the backend interleaver to an existing content `PlannedState`: the interleaver populates the `PlannedState.ad_slot_id` field (already present on the SPEC-CRWDQ-017 wire schema) and flips `business_mode` + `template_id` to a composite (`multiple_games` → `multiple_games_with_ads` / `multi-game-grid-K-with-ads`; `fixtures` → `fixtures_with_ads` / `fixtures-list-with-ads`). The interleaver never inserts a standalone ad `PlannedState`.
- `AdSlot.ad_ref` (D-GRH-55) is the canonical creative reference. Phase-1 the `ad_ref_type` is always `creative_asset` — a key into `AssetManifest`. The player does not have URL-based ad fetch yet.

## Backend wire-contract facts (SPEC-CRWDQ-039 / -017 cross-check)

- The composite `PlannedState` discriminator is `business_mode` ∈ `{multiple_games_with_ads, fixtures_with_ads}` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`). The closed D-GRH-30 business-mode enum has 9 members; `multiple_games_with_ads` and `fixtures_with_ads` are two of them. There is no `ad` mode and no `single_game_with_ads` mode.
- A composite `PlannedState` carries a non-null `ad_slot_id` (the SPEC-CRWDQ-017 `PlannedStatePayload.ad_slot_id` field) referencing the attached `AdSlot`.
- The `AdSlot` payload shape is SPEC-CRWDQ-017's `AdSlotPayload`: `{ ad_slot_id, ad_class, ad_ref, ad_ref_type, policy }`. `ad_class` is the backend enum `panel | overlay | preroll | postroll | interstitial` (SPEC-CRWDQ-039); the player treats it as an opaque label for journaling. `ad_ref_type` ∈ `{ creative_asset, external_uri }` (SPEC-CRWDQ-017); always `creative_asset` in phase-1. `policy` is backend-evaluated (`maxPerHour`, blackout ranges, sport blacklist) — the player ignores it entirely.
- The composite `template_id` is `multi-game-grid-K-with-ads` or `fixtures-list-with-ads` (SPEC-CRWDQ-039). This template branches on `business_mode`, not `template_id`.

> **OPEN QUESTION — how the `AdSlot` payload reaches the player.** SPEC-CRWDQ-039
> attaches only the `ad_slot_id` *reference* to the content `PlannedState`;
> the `AdSlot` *payload* (`ad_ref`, `ad_class`, `ad_ref_type`, `policy`) is a
> separate `AdSlot` wire message type (SPEC-CRWDQ-017 `MESSAGE_TYPES` includes
> `AdSlot`). However, SPEC-CRWDQ-020's re-push order
> (`ConfigPush → ScheduleWindow → AssetManifest → PlannedState(s) →
> ProgramSlot(s) → GameState(s)`) does NOT enumerate `AdSlot` frames. The
> backend must clarify when and how `AdSlot` frames are delivered — most
> plausibly alongside `ProgramSlot` frames (so a referencing composite
> `PlannedState` always resolves its `AdSlot`), but this is not specified.
> This spec's `AdSlotResolver` assumes `AdSlot` arrives as a separately
> dispatched frame and is resolved by `ad_slot_id`, mirroring the
> `ProgramSlotResolver` pattern; the activator buffers a composite
> `PlannedState` until both its `ProgramSlot` and `AdSlot` resolve. Confirm
> the `AdSlot` delivery contract with the backend before implementation.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/with-ads/AdPanel.ts
export interface AdPanel {
  /**
   * Mount the ad panel into the host element. The panel reads the
   * cached creative via AssetManifestStore.get(adSlot.ad_ref) and
   * renders the image. Returns an instance for unmount.
   */
  mount(host: HTMLElement, ctx: AdPanelContext): AdPanelInstance;
}

export interface AdPanelContext {
  adSlot: AdSlot;
  assetManifestStore: AssetManifestStore;
  /** Position class — chosen by the parent composite. */
  positionClass: 'right' | 'bottom' | 'left' | 'top';
}

export interface AdPanelInstance {
  /** Detach without animation; the parent owns the slot transition. */
  detach(): HTMLElement;
}
```

```ts
// modules/widget-v2/src/render/AdSlotResolver.ts
export interface AdSlotResolver {
  /** Upsert an AdSlot frame; last-write-wins per ad_slot_id. */
  upsert(slot: AdSlotFrame): void;
  /** Resolve an AdSlot by id; null if not yet seen. */
  resolve(adSlotId: string): AdSlot | null;
  /** True iff the AdSlot has been upserted. Used by the activator to
   *  decide whether a composite PlannedState must be buffered until its
   *  AdSlot frame arrives. */
  has(adSlotId: string): boolean;
}

// AdSlot is the unwrapped SPEC-CRWDQ-017 `AdSlotPayload` — consumed verbatim,
// not independently owned. `AdSlotFrame` is the Envelope<AdSlotPayload>.
export interface AdSlot {
  ad_slot_id: string;
  ad_class: 'panel' | 'overlay' | 'preroll' | 'postroll' | 'interstitial';
  ad_ref: string;               // phase-1: an AssetManifest asset_id (D-GRH-55)
  ad_ref_type: 'creative_asset' | 'external_uri';  // SPEC-CRWDQ-017; always 'creative_asset' phase-1
  policy: Record<string, unknown>;  // backend-evaluated; the player ignores it
}
```

```ts
// modules/widget-v2/src/templates/with-ads/MultiGameWithAdsTemplate.ts
export interface MultiGameWithAdsTemplate {
  mount(host: HTMLElement, ctx: MultiGameContext & { adSlot: AdSlot }): MultiGameWithAdsInstance;
}

export interface MultiGameWithAdsInstance {
  /** Detaches both children; returns the composite section node. */
  detach(): HTMLElement;
  /** Delegates a ProgramSlot revision to the content child's reconcile. */
  reconcile(newSlot: ProgramSlotPayload): Promise<void>;
}
```

```ts
// modules/widget-v2/src/templates/with-ads/FixturesWithAdsTemplate.ts
export interface FixturesWithAdsTemplate {
  mount(host: HTMLElement, ctx: FixturesContext & { adSlot: AdSlot }): FixturesWithAdsInstance;
}

export interface FixturesWithAdsInstance {
  detach(): HTMLElement;
  reconcile(newSlot: ProgramSlotPayload): Promise<void>;
}
```

`MultiGameContext`, `FixturesContext`, and `ProgramSlotPayload` are defined by SPEC-CRWDQ-031 / -034 / -023 and consumed verbatim. `AssetManifestStore` is owned by SPEC-CRWDQ-064.

### DOM shape — composite

```
<section class="crowdaq-with-ads cdq-with-ads-right" data-mode="multiple_games_with_ads|fixtures_with_ads">
  <div class="cdq-content"><!-- MultiGameTemplate or FixturesTemplate output, untouched --></div>
  <aside class="cdq-ad-panel" data-position="right" data-ad-slot-id data-ad-class>
    <img class="cdq-ad-creative" alt="" src="<ad-asset-url>" />
  </aside>
</section>
```

The composite is structural — it places the underlying content template's output inside `.cdq-content` and `AdPanel`'s output inside `.cdq-ad-panel`. The two child templates are NOT modified — they continue to mount into a host element and only their host is now `.cdq-content` instead of the bare slot host.

### Activation flow — composite

For a `PlannedStateFrame` whose `payload.business_mode === "multiple_games_with_ads"`, with `payload.ad_slot_id: A` and `payload.program_slot_id: X`:

1. **Resolve `ProgramSlot`** + **resolve `AdSlot`.** Both must be present. The shared `PlannedStateActivator` (SPEC-CRWDQ-023) buffers the `PlannedStateFrame` until BOTH `ProgramSlotResolver.has(X)` and `AdSlotResolver.has(A)` are true, with the SPEC-CRWDQ-023 5s buffer timeout. On timeout, journal `template_buffer_timeout` and fall through to safe (escalation owned by SPEC-CRWDQ-052). A composite `PlannedState` with a `null` `ad_slot_id` is a backend authoring error: journal `template_input_invalid` and do not mount.
2. **Validate ad asset.** `assetManifestStore.get(adSlot.ad_ref)` — `ad_ref` is the `AssetManifest` `asset_id` directly, no key prefix. A synchronous cache hit → render the composite. A miss → journal `ad_asset_cache_miss`, call `assetManifestStore.ensure(adSlot.ad_ref)` to warm the cache for a later slot, and fall through to the **non-ad equivalent content template** (`MultiGameTemplate` for a `multiple_games_with_ads` state, `FixturesTemplate` for `fixtures_with_ads`), mounting it directly into the original slot host without the composite shell. D-GRH-16's "ad never displaces content" goes both ways: a missing ad creative must not blank out game/fixture content. Backend authoring pre-stages assets via `AssetManifest`; if a creative is not yet cached, content takes precedence.
3. **Run transition.** Shared `TransitionExecutor.run(plannedState.payload.transition, host)` — the PlannedState-level transition catalog name (SPEC-CRWDQ-017); a catalog miss falls back per the SPEC-CRWDQ-023 `TransitionExecutor` contract.
4. **Mount composite shell.** Build the `<section>` with content + ad-panel children.
5. **Mount content child.** `MultiGameTemplate.mount(contentHost, ctx)` — unchanged behavior from SPEC-CRWDQ-031.
6. **Mount ad panel.** `AdPanel.mount(adHost, { adSlot, assetManifestStore, positionClass: 'right' })`.
7. **Apply pending preferences** + **Arm dwell.** Same shared dwell-boundary contract as SPEC-CRWDQ-023.

For `fixtures_with_ads`: identical, but step 5 mounts `FixturesTemplate` and the `data-mode` value becomes `fixtures_with_ads`.

### Coexistence rule (D-GRH-16)

The ad panel never displaces game cards or fixture cards. The composite shell uses CSS Grid:

```css
.crowdaq-with-ads.cdq-with-ads-right {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--cdq-ad-gap, 12px);
}
.crowdaq-with-ads .cdq-content { min-width: 0; overflow: hidden; }
.crowdaq-with-ads .cdq-ad-panel { width: 100%; }
```

For `multiple_games_with_ads`, the content grid retains its 2/3/4-card layout — the ad panel is the right column, the game grid keeps its own 2×2. Per D-GRH-15, the ad does not "rotate into" a game card slot.

For `fixtures_with_ads`, the ad panel sits adjacent to the fixture list — the list's card count is unchanged, scroll/clipping handled by `min-width: 0` + `overflow: hidden` on `.cdq-content`.

### Ad panel rendering

Phase-1 ad creatives are images (per D-GRH-55: a blob in `AssetManifest`). The `AdPanel` renders an `<img>` with `decoding="async" loading="eager"`, its `src` set to the `CachedAsset.url` returned by `AssetManifestStore.get(adSlot.ad_ref)`. The composite mounts the ad panel only when that `get(...)` returned non-null (activation step 2); `AssetManifestStore` eagerly pre-fetches on manifest receipt (D-GRH-23), but `get()` can still miss before a pre-fetch completes — that is exactly the `ad_asset_cache_miss` fallback path.

The panel records an `ad_slot_rendered` journal event (D-GRH-29) when the image's `load` event fires. The journal entry includes `ad_slot_id`, `ad_ref`, and `state_id` (the parent `PlannedState`'s `state_id`). The `dwell_actual_ms` is NOT recorded at render time — it is filled at detach by the parent composite in the `ad_slot_completed` event (below), since the actual dwell is only known at the slot boundary.

### Static, not animated, ad panel

Per D-GRH-62 the player has no ad-progression logic. The panel is mounted at slot start and unmounted at slot end. No rotation between creatives within a slot. No "click" behavior — bar screens are passive. No video playback in phase-1 (image only; `ad_ref_type` is always `creative_asset`).

### Supersede

When the parent `PlannedState` is superseded (a new `PlannedState` with a different `state_id`):

1. The shared outgoing transition runs on the `<section>`.
2. `MultiGameWithAdsInstance.detach()` / `FixturesWithAdsInstance.detach()` calls both child detaches:
   - Content child: `MultiGameTemplate.detach()` / `FixturesTemplate.detach()` (unsubscribes per-game `GameState` / per-fixture subscriptions).
   - `AdPanel.detach()` (no subscriptions to unwind).
3. Journal `ad_slot_completed` with `ad_slot_id`, `ad_ref`, `state_id`, and the final `dwell_actual_ms` read from the shared `DwellTimer`.

### Reconcile

If the parent `ProgramSlot` is revised in place (D-GRH-13, same `program_slot_id`, different `game_ids[]` / `fixture_ids[]`), the composite's `reconcile(newSlot)` delegates to the content child's `reconcile(newSlot)` exactly as SPEC-CRWDQ-031 / -034 define it. The `AdPanel` is unaffected — an `ad_slot_id` change arrives as a new composite `PlannedState` (different `state_id`), never as a `ProgramSlot` mutation.

> **OPEN QUESTION — `reconcile?` dispatch hook.** The active-slot `reconcile`
> dispatch this composite relies on requires SPEC-CRWDQ-023 to declare an
> optional `reconcile?(slot)` member on its template-instance contract,
> which it does not currently do. This is the same cross-spec coordination
> gap flagged by SPEC-CRWDQ-031 and SPEC-CRWDQ-034; it must be agreed with
> the SPEC-CRWDQ-023 owner before any of these specs are implemented.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| Shared orchestration (`PlannedStateActivator`, etc.) | 1 in-process | Real instances. |
| `MultiGameTemplate`, `FixturesTemplate` | 1 in-process | Real instances from SPEC-CRWDQ-031, 034 — not mocked (INV-FACTORY-16). |
| `AssetManifestStore` | 1 in-process | Real instance from SPEC-CRWDQ-064; `AssetFetcher` substituted per that spec; pre-seed the ad asset via `ensure`. |
| `AdSlotResolver` | 1 in-process | Real. |
| DOM | 1 in-process | jsdom; assert grid container + child structure + `data-ad-slot-id` attributes. |
| Image `load` event | system boundary | Stub via `Object.defineProperty(HTMLImageElement.prototype, 'src', ...)` to fire `load` synchronously; image fetching is the boundary. |
| `TransitionExecutor`, `DwellTimer`, journal sink, clock | as in SPEC-CRWDQ-023 / 031 / 034 | Same fakes. |

Test cases:

- `multiple_games_with_ads` happy mount: 4-card grid in `.cdq-content`, `<img>` in `.cdq-ad-panel` with `src` matching the manifest-resolved URL; `data-ad-slot-id` equals `adSlot.ad_slot_id`; `data-mode="multiple_games_with_ads"`.
- `fixtures_with_ads` happy mount: fixtures list in `.cdq-content`, ad panel adjacent; `data-mode="fixtures_with_ads"`.
- Composite buffered until `AdSlot` resolves: a composite `PlannedState` arrives before its `AdSlot` frame → the activator buffers and mounts on the `AdSlot` arrival within 5s.
- Null `ad_slot_id` on a composite `PlannedState`: journal `template_input_invalid`; no mount.
- Missing `AdSlot` (`ad_slot_id` never resolves within 5s): journal `template_buffer_timeout`; safe fall-through.
- Ad asset cache miss: `assetManifestStore.get(adSlot.ad_ref)` → null → journal `ad_asset_cache_miss`, `ensure(adSlot.ad_ref)` called once; composite falls back to the non-ad content template mounted directly into the original host (no composite shell, no blank ad panel).
- `ad_slot_rendered` journal event fires on image `load`; payload includes `ad_slot_id`, `ad_ref`, `state_id`.
- Content child unaffected: feed a `GameState` update for one of the multi-game cards — the matching card's DOM updates; the ad panel does not re-render.
- Reconcile of underlying `ProgramSlot`: cards add/remove inside `.cdq-content` via the content child's `reconcile`; the ad panel keeps its same `<img>` (no flicker).
- Supersede: `detach` is called on both children exactly once; `ad_slot_completed` journaled with the boundary's `dwell_actual_ms`.
- Grid coexistence: the ad panel never overlaps content; in tests, the rendered grid template explicitly preserves the `1fr 320px` columns and `min-width: 0` on content.

## Vocabulary

- `multiple_games_with_ads`, `fixtures_with_ads` — two of the 9-member closed D-GRH-30 business-mode enum; the composite content+ad modes. There is no `single_game_with_ads` mode and no `ad` mode.
- Composite `template_id` — `multi-game-grid-K-with-ads` / `fixtures-list-with-ads` (backend-authored, SPEC-CRWDQ-039); this template branches on `business_mode`, not `template_id`.
- `AdSlot`, `ad_ref`, `ad_class`, `ad_ref_type`, `policy` — SPEC-CRWDQ-017 `AdSlotPayload` fields; phase-1 `ad_ref_type === 'creative_asset'` (D-GRH-55).
- "coexistence" — D-GRH-16 uniform rule: an ad never displaces content.

## Acceptance Criteria

- [ ] `MultiGameWithAdsTemplate.mount(host, ctx)` renders `<section class="crowdaq-with-ads cdq-with-ads-right" data-mode="multiple_games_with_ads">` containing `.cdq-content` (with `MultiGameTemplate` output unmodified) and `.cdq-ad-panel` (with `AdPanel` output).
- [ ] `FixturesWithAdsTemplate.mount(host, ctx)` does the same with `FixturesTemplate` and `data-mode="fixtures_with_ads"`.
- [ ] `AdPanel.mount(host, ctx)` reads the creative via `AssetManifestStore.get(adSlot.ad_ref)` (`ad_ref` is the `asset_id` directly) and renders a single `<img class="cdq-ad-creative">` with `data-ad-slot-id`, `data-ad-class` attributes; no rotation, no video, no click handler.
- [ ] A composite `PlannedState` is buffered by the shared `PlannedStateActivator` until both its `ProgramSlot` and its `AdSlot` resolve (5s timeout → `template_buffer_timeout` + safe fall-through).
- [ ] A composite `PlannedState` with a `null` `ad_slot_id` journals `template_input_invalid` and does not mount.
- [ ] An `AssetManifestStore.get(adSlot.ad_ref)` miss journals `ad_asset_cache_miss`, calls `ensure(adSlot.ad_ref)` to warm the cache, and falls back to the non-ad content template mounted directly into the original host (no composite shell, no blank ad panel); content is preserved per D-GRH-16.
- [ ] `ad_slot_rendered` journal entry fires on the image's `load` event with `ad_slot_id`, `ad_ref`, `state_id` payload.
- [ ] `ad_slot_completed` journal entry fires on supersede with `ad_slot_id`, `ad_ref`, `state_id`, and `dwell_actual_ms` filled from the shared `DwellTimer`.
- [ ] Coexistence: in every rendered DOM, `.cdq-ad-panel` does not overlap `.cdq-content`; the grid columns are `1fr 320px` (or the matching position-class equivalent); the content child's card/fixture count is unchanged by the composite (D-GRH-15, D-GRH-16).
- [ ] Per-game `GameState` updates mutate only the matching card's DOM inside `.cdq-content`; the ad panel does not re-render.
- [ ] An underlying `ProgramSlot` reconcile (add/remove cards or fixtures) propagates into `.cdq-content` via the content child's `reconcile`; the ad panel is untouched, no flicker.
- [ ] Supersede detaches both children; tests verify both child `detach` methods were called exactly once.
- [ ] The spec produces, consumes, and references only `multiple_games_with_ads` and `fixtures_with_ads` — there is no `single_game_with_ads` or `ad` business mode anywhere in this template (per SPEC-CRWDQ-039 / D-GRH-30).
- [ ] Tests use real `MultiGameTemplate` and `FixturesTemplate` instances — NOT mocked (INV-FACTORY-16) — composed into the with-ads shell and exercised end-to-end at the unit level.
