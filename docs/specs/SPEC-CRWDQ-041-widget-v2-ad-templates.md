---
spec_id: SPEC-CRWDQ-041
title: Widget v2 ad render template + fixtures_with_ads composite
status: draft
owner: player-runtime/widget-v2/templates/with-ads
depends_on: [SPEC-CRWDQ-031, SPEC-CRWDQ-034, SPEC-CRWDQ-039]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-041 — Widget v2 ad render template + fixtures_with_ads composite

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S8 — Ad inventory + AdSlot render |
| Plane epic | CRWDQ-9 |
| Decisions referenced | D-GRH-15, D-GRH-16, D-GRH-21, D-GRH-23, D-GRH-25, D-GRH-30, D-GRH-50, D-GRH-55, D-GRH-62 |
| Source files | `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed); `MultiGameTemplate.ts`, `FixturesTemplate.ts` (composed) |
| New files | `modules/widget-v2/src/templates/with-ads/AdPanel.ts`, `modules/widget-v2/src/templates/with-ads/MultiGameWithAdsTemplate.ts`, `modules/widget-v2/src/templates/with-ads/FixturesWithAdsTemplate.ts`, `modules/widget-v2/src/templates/with-ads/with-ads.css`, `modules/widget-v2/src/render/AdSlotResolver.ts`, `modules/widget-v2/tests/templates/with-ads/*.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/with-ads` — implements the with-ads composite templates `multiple_games_with_ads` and `fixtures_with_ads` per D-GRH-15, D-GRH-16. A dedicated ad panel coexists with game cards / fixture cards; the panel is always visible during the slot, never displaces content. The ad creative is resolved via `AssetManifest` keyed by `ad_ref` (D-GRH-55 phase-1: `asset_id`). The player never decides ad timing, ad inventory, or ad rotation — `BarPlayerSchedulerService` pre-computes everything (D-GRH-62).

> **Catalog flag:** SPEC-CRWDQ-041 covers TWO composite templates (`multiple_games_with_ads`, `fixtures_with_ads`). `single_game_with_ads` is also a valid mode per D-GRH-30 #5 but is not in the S8 catalog row — the same `AdPanel` primitive added here makes the future `single_game_with_ads` spec a thin compose-and-mount file. The PRD-listed `multiple_games_with_ads` and `fixtures_with_ads` are the two the catalog row names; the spec sticks to those two and notes the gap.

## Current shape

- No ad rendering in v1. The MVP widget has no ad path, no ad creative cache, no ad-bearing template.
- SPEC-CRWDQ-031 adds the multi-game grid; SPEC-CRWDQ-034 adds the fixtures list. Both render content templates with no ad panel.
- D-GRH-62 makes `AdSlot` a first-class `PlannedState` slot with `business_mode: "ad"` — but per the catalog row this spec is the composite path (game/fixture + ad together), not the pure-ad slot. The pure-ad slot (a full-screen ad creative without coexisting content) is a separate mode value; it shares the `AdPanel` primitive defined here but mounts a different host shell.
- `AdSlot.ad_ref` (D-GRH-55) is the canonical reference. Phase-1 the `ad_ref_type` is always `asset_id` — a key into `AssetManifest`. The player does not have URL-based ad fetch yet.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/with-ads/AdPanel.ts
export interface AdPanel {
  /**
   * Mount the ad panel into the host element. The panel resolves
   * adSlot.ad_ref via AssetManifestStore and renders the creative
   * (image or video poster). Returns an instance for unmount.
   */
  mount(host: HTMLElement, ctx: AdPanelContext): AdPanelInstance;
}

export interface AdPanelContext {
  adSlot: AdSlot;
  assetManifestStore: AssetManifestStore;
  /** Position class — `right`, `bottom`, etc. — chosen by parent composite. */
  positionClass: 'right' | 'bottom' | 'left' | 'top';
}

export interface AdPanelInstance {
  /** Detach without animation; parent owns the slot transition. */
  detach(): HTMLElement;
}
```

```ts
// modules/widget-v2/src/render/AdSlotResolver.ts
export interface AdSlotResolver {
  upsert(slot: AdSlotFrame): void;
  resolve(adSlotId: string): AdSlot | null;
}

export interface AdSlot {
  ad_slot_id: string;
  ad_class: string;             // backend-defined enum; player treats as opaque label for journaling
  ad_ref: string;               // phase-1: asset_id key into AssetManifest (D-GRH-55)
  ad_ref_type: 'asset_id';      // closed enum in phase-1
  policy: Record<string, unknown>;  // backend-evaluated; player ignores
}
```

```ts
// modules/widget-v2/src/templates/with-ads/MultiGameWithAdsTemplate.ts
export interface MultiGameWithAdsTemplate {
  mount(host: HTMLElement, ctx: MultiGameContext & { adSlot: AdSlot }): MultiGameWithAdsInstance;
}
```

```ts
// modules/widget-v2/src/templates/with-ads/FixturesWithAdsTemplate.ts
export interface FixturesWithAdsTemplate {
  mount(host: HTMLElement, ctx: FixturesContext & { adSlot: AdSlot }): FixturesWithAdsInstance;
}
```

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

For `PlannedState` with `mode: "multiple_games_with_ads"` and `ad_slot_id: A`, `program_slot_id: X`:

1. **Resolve `ProgramSlot`** + **resolve `AdSlot`.** Both must be present. Either missing → journal `template_input_invalid` and fall through to safe.
2. **Validate ad asset.** `assetManifestStore.resolve("ad:" + adSlot.ad_ref)` must return a URL. Cache miss → journal `ad_asset_cache_miss` and fall through to the non-ad equivalent template (`multiple_games` instead of `multiple_games_with_ads`) — D-GRH-16's "ad never displaces content" goes both ways: missing ad content also doesn't replace game content with blanks. Backend authoring should pre-stage assets via `AssetManifest`; if not, content takes precedence.
3. **Run transition.** Same shared `TransitionExecutor`.
4. **Mount composite shell.** Build the `<section>` with content + ad-panel children.
5. **Mount content child.** `MultiGameTemplate.mount(contentHost, ctx)` — unchanged behavior from SPEC-CRWDQ-031.
6. **Mount ad panel.** `AdPanel.mount(adHost, { adSlot, assetManifestStore, positionClass: 'right' })`.
7. **Apply pending preferences** + **Arm dwell.** Same shared boundaries.

For `fixtures_with_ads`: identical, but step 5 mounts `FixturesTemplate` and the mode value becomes `fixtures_with_ads`.

### Coexistence rule (D-GRH-16)

The ad panel never displaces game cards or fixture cards. The composite shell uses CSS Grid:

```css
.crowdaq-with-ads.cdq-with-ads-right {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--cdq-ad-gap, 12px);
}
.crowdaq-with-ads .cdq-content { min-width: 0; }
.crowdaq-with-ads .cdq-ad-panel { width: 100%; }
```

For `multi_game_with_ads`, the content grid retains its 2/3/4-card layout — the ad panel is the right column, the game grid keeps its own 2x2. Per D-GRH-15, the ad does not "rotate into" a game card slot.

For `fixtures_with_ads`, the ad panel sits adjacent to the fixture list — the list's card count is unchanged, scroll/clipping handled by `min-width: 0` + `overflow: hidden` on `.cdq-content`.

### Ad panel rendering

Phase-1 ad creatives are images (per D-GRH-55: blob in `AssetManifest`, served as static URL). The `AdPanel` renders an `<img>` with `decoding="async" loading="eager"`. The image is loaded synchronously from the manifest cache — the underlying asset bytes are guaranteed present because `AssetManifestStore` pre-fetches on manifest receipt (D-GRH-23).

The panel records `ad_slot_rendered` journal events (D-GRH-29) when the image's `load` event fires. The journal entry includes `ad_slot_id`, `ad_ref`, `state_id` (parent `PlannedState`), `dwell_actual_ms` (filled at detach by the parent composite via the shared dwell-boundary callback).

### Static, not animated, ad panel

Per D-GRH-62 the player has no ad-progression logic. The panel is mounted at slot start and unmounted at slot end. No rotation between creatives within a slot. No "click" behavior — bar screens are passive. No video playback in phase-1 (image only).

### Supersede

When the parent `PlannedState` is superseded:

1. Shared outgoing transition runs on the `<section>`.
2. `MultiGameWithAdsInstance.detach()` / `FixturesWithAdsInstance.detach()` calls both child detaches:
   - Content child: `MultiGameTemplate.detach()` (unsubscribes per-game GameState).
   - `AdPanel.detach()` (no subscriptions to unwind).
3. Journal `ad_slot_completed` with final `dwell_actual_ms` from the dwell timer.

### Reconcile

If the parent `ProgramSlot` is revised in place (D-GRH-13), the content child's `reconcile(newSlot)` is delegated to as in SPEC-CRWDQ-031. The `AdPanel` is unaffected — `ad_slot_id` revisions arrive as a new `PlannedState` (different `state_id`), not as a `ProgramSlot` mutation.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| Shared orchestration (`PlannedStateActivator`, etc.) | 1 in-process | Real instances. |
| `MultiGameTemplate`, `FixturesTemplate` | 1 in-process | Real instances from SPEC-CRWDQ-031, 034 — not mocked (INV-FACTORY-16). |
| `AssetManifestStore` | 1 in-process | Real; pre-seed with the ad asset URL via test driver. |
| `AdSlotResolver` | 1 in-process | Real. |
| DOM | 1 in-process | jsdom; assert grid container + child structure + `data-ad-slot-id` attributes. |
| Image `load` event | system boundary | Stub via `Object.defineProperty(HTMLImageElement.prototype, 'src', ...)` to fire `load` synchronously; image fetching is the boundary. |
| `TransitionExecutor`, `DwellTimer`, journal sink, clock | as in SPEC-CRWDQ-023 / 031 / 034 | Same fakes. |

Test cases:

- `multiple_games_with_ads` happy mount: 4-card grid in `.cdq-content`, `<img>` in `.cdq-ad-panel` with `src` matching the manifest-resolved URL; `data-ad-slot-id` attribute equals `adSlot.ad_slot_id`.
- `fixtures_with_ads` happy mount: fixtures list in `.cdq-content`, ad panel adjacent; same `data-ad-slot-id`.
- Missing `AdSlot` (`ad_slot_id` references unknown slot): journal `template_input_invalid`; no mount.
- Ad asset cache miss: `assetManifestStore.resolve("ad:" + ad_ref)` → null → journal `ad_asset_cache_miss`; composite falls back to non-ad mode (mounts `MultiGameTemplate` or `FixturesTemplate` directly into the original host without the composite shell).
- `ad_slot_rendered` journal event fires on image `load`; payload includes `ad_slot_id`, `ad_ref`, `state_id`.
- Content child unaffected: feed a `GameState` update for one of the multi-game cards — the matching card's DOM updates; the ad panel does not re-render.
- Reconcile of underlying `ProgramSlot`: cards add/remove inside `.cdq-content`; the ad panel keeps its same `<img>` (no flicker).
- Supersede: detach is called on both children; `ad_slot_completed` journaled with the boundary's `dwell_actual_ms`.
- Grid coexistence: the ad panel never overlaps content; in tests, the rendered grid template explicitly preserves the `1fr 320px` columns and `min-width: 0` on content.

## Vocabulary

- `multiple_games_with_ads`, `fixtures_with_ads` — D-GRH-30 #6, #4.
- `AdSlot.ad_ref` — opaque pointer; phase-1 `ad_ref_type === 'asset_id'` (D-GRH-55).
- "coexistence" — D-GRH-16 uniform rule: ad does not displace content.

## Acceptance Criteria

- [ ] `MultiGameWithAdsTemplate.mount(host, ctx)` renders `<section class="crowdaq-with-ads cdq-with-ads-right" data-mode="multiple_games_with_ads">` containing `.cdq-content` (with `MultiGameTemplate` output unmodified) and `.cdq-ad-panel` (with `AdPanel` output).
- [ ] `FixturesWithAdsTemplate.mount(host, ctx)` does the same with `FixturesTemplate` and `data-mode="fixtures_with_ads"`.
- [ ] `AdPanel.mount(host, ctx)` resolves `adSlot.ad_ref` via `AssetManifestStore.resolve("ad:" + ad_ref)` and renders a single `<img class="cdq-ad-creative">` with `data-ad-slot-id`, `data-ad-class` attributes; no rotation, no video, no click handler.
- [ ] Missing referenced `AdSlot` journals `template_input_invalid` and does not mount.
- [ ] Ad asset cache miss journals `ad_asset_cache_miss` and falls back to the non-ad template (no composite shell, no blank ad panel); content is preserved per D-GRH-16.
- [ ] `ad_slot_rendered` journal entry fires on the image's `load` event with `ad_slot_id`, `ad_ref`, `state_id` payload.
- [ ] `ad_slot_completed` journal entry fires on supersede with `dwell_actual_ms` filled from the shared `DwellTimer`.
- [ ] Coexistence: in every rendered DOM, `.cdq-ad-panel` does not overlap `.cdq-content`; the grid columns are `1fr 320px` (or matching position-class equivalent); content child's card/fixture count is unchanged by the composite (D-GRH-15, D-GRH-16).
- [ ] Per-game `GameState` updates mutate only the matching card's DOM inside `.cdq-content`; the ad panel does not re-render.
- [ ] Underlying `ProgramSlot` reconcile (add/remove cards or fixtures) propagates into `.cdq-content`; the ad panel is untouched, no flicker.
- [ ] Supersede detaches both children; tests verify both child detach methods were called exactly once.
- [ ] Tests use real `MultiGameTemplate` and `FixturesTemplate` instances — NOT mocked (INV-FACTORY-16) — composed into the with-ads shell and exercised end-to-end at the unit level.
