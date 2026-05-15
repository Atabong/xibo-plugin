---
spec_id: SPEC-CRWDQ-053
title: Widget v2 ambient render template
status: draft
parent: S11
area: player-runtime/widget-v2/templates/ambient
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-053 — Widget v2 ambient render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S11 — Safe / ambient fallback |
| Plane epic | CRWDQ-12 |
| Decisions referenced | D-GRH-22, D-GRH-23, D-GRH-25, D-GRH-26, D-GRH-27, D-GRH-30, D-GRH-50 |
| Source files | `modules/widget-v2/src/render/AssetManifestStore.ts`, `PlannedStateActivator.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed); `SafeInfoTemplate` (fallback target) |
| New files | `modules/widget-v2/src/templates/ambient/AmbientTemplate.ts`, `modules/widget-v2/src/templates/ambient/AmbientPlaylist.ts`, `modules/widget-v2/src/templates/ambient/ambient.html`, `modules/widget-v2/src/templates/ambient/ambient.css`, `modules/widget-v2/tests/templates/ambient/*.test.ts` |
| Blocked by | SPEC-CRWDQ-022 (WS client), SPEC-CRWDQ-052 (`SafeInfoTemplate` fallback target), SPEC-CRWDQ-051 (backend emits `PlannedState{ambient}`) |

## Module

`player-runtime :: widget-v2 :: templates/ambient` — the `ambient` business-mode template (D-GRH-30 mode #9). `AssetManifest`-driven render loop of sponsor / branding / neutral creatives (D-GRH-26 + D-GRH-27). Asset rotation paced by `dwell_target_ms`. No `ProgramSlot`, no `AdSlot`, no game data — the template reads entirely from `AssetManifest` cache. Falls back to `SafeInfoTemplate` if the manifest carries no ambient creatives.

## Current shape

- No ambient template in v1.
- D-GRH-26 finalized `ambient` as mode #9: gap-filling sponsor / branding / neutral content with indefinite dwell ("runs until backend emits a new `PlannedState`"). D-GRH-27 finalized the content model: AssetManifest-driven, no `ProgramSlot` reference, no `AdSlot` reference; the `PlannedState` carries `mode`, `theme`, `transition` only.
- D-GRH-22 makes ambient one of three valid gap-fillers (`fixtures`, `ambient`, `safe_info`). The backend chooses; the player executes.
- D-GRH-27 explicitly says ambient does NOT query the game-data channel — it reads from the asset cache. Updates to ambient content arrive via new `AssetManifest` pushes; the template re-fetches at the next safe dwell window.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/ambient/AmbientTemplate.ts
export interface AmbientTemplate {
  mount(host: HTMLElement, context: AmbientContext): AmbientInstance;
}

export interface AmbientContext {
  /** Per D-GRH-27 — no ProgramSlot, no AdSlot. Only theme + transition + dwell from PlannedState. */
  themeId: string | null;
  /** Per-slot rotation pace; D-GRH-26 says indefinite total dwell, but each creative shows for this long. */
  dwellTargetMs: number;
  assetManifestStore: AssetManifestStore;
  pendingApply: PendingPreferenceApply | null;
}

export interface AmbientInstance {
  detach(): HTMLElement;
}
```

```ts
// modules/widget-v2/src/templates/ambient/AmbientPlaylist.ts
export interface AmbientPlaylist {
  /**
   * Resolve the playlist from AssetManifest. Pulls all assets keyed
   * "ambient:*" from the store and orders them by their declared
   * sequence (asset metadata key `ambient_seq`); falls back to
   * receipt order if `ambient_seq` absent.
   */
  resolve(): AmbientCreative[];
}

export interface AmbientCreative {
  asset_id: string;
  url: string;
  content_type: 'image' | 'video';   // phase-1: image only; video deferred
  duration_ms: number | null;        // for video; image uses dwellTargetMs
}
```

### DOM shape

```
<section class="crowdaq-ambient" data-theme>
  <div class="cdq-ambient-stage" data-active-index="0">
    <!-- Active creative: <img> or <video> mounted here -->
    <img class="cdq-ambient-creative" data-asset-id alt="" />
  </div>
</section>
```

A single render slot — one creative visible at a time. Rotation happens by swapping the `data-asset-id` and the `<img src>` (or `<video src>`) on the dwell boundary.

### Activation flow

For `PlannedState` with `mode: "ambient"`:

1. **Resolve playlist.** `AmbientPlaylist.resolve()`. If empty → journal `ambient_empty_manifest` and fall through to `SafeInfoTemplate` mount (NOT a no-op — D-GRH-27 says "falls back to safe_info if AssetManifest empty"; the activator hands off cleanly).
2. **Filter by content_type.** Phase-1: keep `image` entries only. `video` entries are journaled `ambient_video_deferred` and skipped. If after filtering the playlist is empty → same fallback as step 1.
3. **Run transition.** Same shared `TransitionExecutor`. Default `fade_scale_up` if catalog miss.
4. **Mount.** Build `<section class="crowdaq-ambient">` with one stage element. Set initial `<img src>` to first creative; record `data-active-index="0"`.
5. **Apply pending preferences.** Same dwell-boundary contract. Theme swap takes effect; the stage element re-renders with new `data-theme`.
6. **Rotate.** Arm `DwellTimer.arm(dwellTargetMs, onBoundary)`. On boundary:
   - Advance `activeIndex` by 1 modulo `playlist.length`.
   - Swap `<img src>` and `data-asset-id`.
   - Journal `ambient_creative_advanced` with `{ from: prev_asset_id, to: next_asset_id, index, total }`.
   - Re-arm the dwell timer for the next rotation.
7. **No supersede until a new `PlannedState`.** Per D-GRH-26 ambient is "indefinite — no timer expiry"; the cycle continues until the server pushes a new mode.

### AssetManifest update mid-mount

If a new `AssetManifest` arrives while the template is mounted (e.g., operator updated ambient branding — D-GRH-27): the template DOES NOT immediately replace the active creative (would cause a flicker). Instead, on the next dwell boundary, `AmbientPlaylist.resolve()` is re-called and the new playlist takes effect from the next rotation. Journal `ambient_playlist_refreshed`.

### Asset preload

To avoid a black frame during rotation: at mount time, the template creates `<link rel="preload" as="image" href="...">` for all playlist creatives. This forces the browser to load them into the HTTP cache; the swap on rotation then renders synchronously. For larger playlists (> 10) the preload is throttled to the next-N entries only (N=3) — refreshed on each boundary.

### Anti-flash constraint

Per D-GRH-31 the no-flash constraint applies broadly. Ambient creatives that are intended to flash (a backend-authoring concern) must be substituted with a static fallback by the player. v1 does NOT inspect image content for flashing patterns — that's deferred. The constraint is documented here for the spec record.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| `AssetManifestStore`, `AmbientPlaylist` | 1 in-process | Real instances; pre-seed with creatives. |
| `SafeInfoTemplate` | 1 in-process | Real instance from SPEC-CRWDQ-052 (fallback path exercised end-to-end). |
| DOM | 1 in-process | jsdom. |
| Clock | system boundary | Fake timers; advance to drive rotations. |
| Journal sink | 2 local-substitutable | In-memory. |
| Asset URL `<link preload>` | system boundary | Not asserted on network; only that `<link rel="preload">` elements are inserted with correct `href`. |

Test cases:

- Happy mount: 3 image creatives → DOM contains stage with first creative; `data-active-index="0"`.
- Rotation: advance fake clock by `dwellTargetMs` → `data-active-index="1"`; `<img src>` updated; journal `ambient_creative_advanced`.
- Wrap-around: advance through all creatives + 1 more → returns to index 0.
- Empty playlist: `AmbientPlaylist.resolve()` empty → journal `ambient_empty_manifest`; `SafeInfoTemplate` mounted in this template's host (verifiable via DOM: `<section class="crowdaq-safe-info">` present, `<section class="crowdaq-ambient">` absent).
- Video filter: playlist has 2 `image` + 1 `video` → only 2 creatives rotate; journal `ambient_video_deferred` once.
- All-video playlist: only video entries → filtered to empty → safe_info fallback.
- Playlist refresh: while index=1, dispatch new `AssetManifest` with different creatives → at next boundary `AmbientPlaylist.resolve()` returns the new playlist; index resets to 0 of new playlist; journal `ambient_playlist_refreshed`.
- Preload elements: assert `<link rel="preload" as="image">` injected for next-3 creatives at mount; refreshed after each rotation.
- Theme swap at boundary: same shared contract.
- Indefinite dwell: simulate 10 rotations → cycle continues, no detach; journal stream contains 10 `ambient_creative_advanced` entries.
- Supersede: `PlannedState{single_game}` arrives → standard supersede flow; ambient detaches; `DwellTimer` canceled.

## Vocabulary

- `ambient` — D-GRH-30 mode #9.
- "AssetManifest-driven" — D-GRH-27 content model.
- "indefinite dwell" — per D-GRH-26: runs until next `PlannedState`.

## Dependencies

**Blocked by:**

- SPEC-CRWDQ-022 — WS + Dispatcher (for `AssetManifest` routing).
- SPEC-CRWDQ-023 — shared orchestration.
- SPEC-CRWDQ-052 — `SafeInfoTemplate` (fallback target on empty manifest).
- SPEC-CRWDQ-051 — backend fallback-mode-selection emits `PlannedState{ambient}` when appropriate.

**Blocks (downstream):**

- None — ambient is a leaf template.

## Acceptance Criteria

- [ ] `AmbientTemplate.mount(host, ctx)` renders `<section class="crowdaq-ambient" data-theme>` containing a `<div class="cdq-ambient-stage" data-active-index>` with one `<img class="cdq-ambient-creative" data-asset-id>` reflecting the first creative.
- [ ] `AmbientPlaylist.resolve()` returns creatives ordered by `ambient_seq` metadata (or receipt order fallback); `image` entries kept; `video` entries skipped with `ambient_video_deferred` journaled.
- [ ] Empty playlist (no `ambient:*` assets, or all filtered out) journals `ambient_empty_manifest` and routes the `ambient` activation to `SafeInfoTemplate` in the same host — the DOM ends with `<section class="crowdaq-safe-info">` not `<section class="crowdaq-ambient">`.
- [ ] At each `dwellTargetMs` boundary the `data-active-index` advances modulo playlist length, `<img src>` and `data-asset-id` swap, and journal `ambient_creative_advanced` is emitted with from/to/index/total payload.
- [ ] Mid-mount `AssetManifest` update is picked up on the next dwell boundary via `AmbientPlaylist.resolve()`; the new playlist starts at index 0; journal `ambient_playlist_refreshed`.
- [ ] Asset preload: `<link rel="preload" as="image" href="...">` elements exist for the next 3 creatives at mount and after each rotation.
- [ ] Theme swap on `pendingApply` follows the shared boundary contract; the rotation is independent.
- [ ] Indefinite dwell: rotation continues until a new `PlannedState` arrives; the template does not auto-detach.
- [ ] On supersede, `DwellTimer.cancel()` is called and the instance detaches per the shared activator flow.
- [ ] Tests cover happy mount, rotation, wrap-around, empty-manifest fallback, video filter, all-video fallback, playlist refresh, preload elements, theme swap, indefinite dwell, supersede.
- [ ] No mocks of shared orchestration, `AssetManifestStore`, or `SafeInfoTemplate` (INV-FACTORY-16); only the clock and asset URL network are substituted.
