---
spec_id: SPEC-CRWDQ-053
title: Widget v2 ambient render template
status: design-ready
owner: player-runtime/widget-v2/templates/ambient
depends_on: [SPEC-CRWDQ-023, SPEC-CRWDQ-052, SPEC-CRWDQ-064]
generated_by: catalog-expansion
generated_at: 2026-05-15
---

# SPEC-CRWDQ-053 — Widget v2 ambient render template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S11 — Safe / ambient fallback |
| Plane epic | CRWDQ-12 |
| Decisions referenced | D-GRH-22, D-GRH-23, D-GRH-26, D-GRH-27, D-GRH-30, D-GRH-31, D-GRH-50, D-GRH-51 |
| Source files | `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed from SPEC-CRWDQ-064); `PlannedStateActivator.ts`, `ProgramSlotResolver.ts`, `TransitionExecutor.ts`, `DwellTimer.ts` (consumed from SPEC-CRWDQ-023); `SafeInfoTemplate` (SPEC-CRWDQ-052, fallback target) |
| New files | `modules/widget-v2/src/templates/ambient/AmbientTemplate.ts`, `modules/widget-v2/src/templates/ambient/AmbientPlaylist.ts`, `modules/widget-v2/src/templates/ambient/ambient.html`, `modules/widget-v2/src/templates/ambient/ambient.css`, `modules/widget-v2/tests/templates/ambient/*.test.ts` |

> **Backend authority note:** The backend-authored `ambient` `PlannedState`
> consumed by this template is produced by the authoritative backend spec
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-051` (fallback-mode selection),
> over the wire-protocol envelope of `SPEC-CRWDQ-017`. Every claim below
> about the `ambient` frame shape, the `business_mode` value, the
> `template_id`, and the `ProgramSlot` it carries is cross-checked against
> SPEC-CRWDQ-051. The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: templates/ambient` — the `ambient` business-mode template (one of the nine `business_mode` values in the closed SPEC-CRWDQ-017 `PlannedStatePayload.business_mode` enum). An `AssetManifest`-driven render loop of sponsor / branding / neutral creatives (D-GRH-26 + D-GRH-27). Creative rotation is paced by `dwell_target_ms`. No game data — the template reads creatives entirely from the `AssetManifest` cache. Falls back to `SafeInfoTemplate` when the manifest carries no ambient creatives.

> **Dependencies.** Consumes the shared orchestration of SPEC-CRWDQ-023 (`PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer`), the `AssetManifestStore` of SPEC-CRWDQ-064, and the `SafeInfoTemplate` of SPEC-CRWDQ-052 (the empty-manifest fallback target) — all hard build dependencies in `depends_on`. SPEC-CRWDQ-051 (`BarPlayerSchedulerService` fallback-mode selection) is the cross-repo `crowdaq-backend` producer of backend-authored `ambient` `PlannedState`s — a wire-contract counterpart, not a build dependency.

## Backend wire-contract facts (SPEC-CRWDQ-051 / -064 cross-check)

- The `ambient` `PlannedState` discriminator is `business_mode === "ambient"` (SPEC-CRWDQ-017 field name `business_mode`, NOT `mode`).
- An `ambient` `PlannedState` (SPEC-CRWDQ-051 `buildFallback`) carries `template_id: "ambient-rotation"`, `transition: "cut"`, `interrupt_class: "scheduled"`, `ad_slot_id: null`, a backend-authored `dwell_target_ms`, and — contrary to an earlier draft of this spec — a **non-null `program_slot_id`** referencing a freshly minted but **empty** `ProgramSlot` (`primary_game_id: null`, `game_ids: []`, `fixture_ids: []`). The ambient template does not *use* the `ProgramSlot` (it reads creatives from `AssetManifest`), but the wire frame carries it and the shared `PlannedStateActivator` resolves it via the normal `ProgramSlotResolver` buffering path before activation proceeds. An earlier draft claimed "no `ProgramSlot` reference"; that is wrong against SPEC-CRWDQ-051.
- `AssetManifestStore.manifestEntries()` (SPEC-CRWDQ-064) returns the full applied `AssetManifestEntry[]` as a read-only snapshot — SPEC-CRWDQ-064 already provides this accessor explicitly for "SPEC-CRWDQ-053's `AmbientPlaylist` [to filter] every `ambient:`-prefixed entry". No SPEC-CRWDQ-064 follow-up is required.
- Phase-1 reality: SPEC-CRWDQ-051's `AssetManifestPort` returns an empty manifest (`ambientCount: 0`), so the backend never selects `ambient` in phase-1 — fallback always resolves to `safe_info`. The `ambient` template is exercised only once ambient creative inventory lands in a later spec; this template ships ahead of that inventory so the render path is ready.

> **OPEN QUESTION — `dwell_target_ms` semantics for `ambient`.** This template
> interprets the `ambient` `PlannedState`'s `dwell_target_ms` as the
> *per-creative rotation interval*, while the *slot* lifetime is indefinite
> (D-GRH-26 — "runs until the backend emits a new `PlannedState`"). This
> diverges from every other template, where `dwell_target_ms` is the
> single-shot *slot* dwell boundary (SPEC-CRWDQ-023). SPEC-CRWDQ-051 sets
> `dwell_target_ms = defaultDwellMs` for `ambient` but does NOT specify
> whether that value is a slot dwell or a rotation pace. The
> rotation-interval reading is the only one that makes ambient rotation
> functional, so this spec adopts it — but the backend should explicitly
> confirm `dwell_target_ms`'s meaning for `ambient`, and ideally document
> it in SPEC-CRWDQ-051's `buildFallback` notes.

## Current shape

- No ambient template in v1.
- D-GRH-26 finalized `ambient` as a gap-filling sponsor / branding / neutral content mode with indefinite slot dwell ("runs until the backend emits a new `PlannedState`"). D-GRH-27 finalized the content model: `AssetManifest`-driven, no game-data-channel query — the template reads from the asset cache.
- D-GRH-22 makes `ambient` one of three valid gap-fillers (`fixtures`, `ambient`, `safe_info`). The backend chooses (SPEC-CRWDQ-051 `selectMode`); the player executes.
- D-GRH-27 explicitly says ambient does NOT query the game-data channel — it reads from the asset cache. Updates to ambient content arrive via new `AssetManifest` pushes; the template re-fetches at the next safe dwell window.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/ambient/AmbientTemplate.ts
export interface AmbientTemplate {
  mount(host: HTMLElement, context: AmbientContext): AmbientInstance;
}

export interface AmbientContext {
  /** SPEC-CRWDQ-023 three-state resolved theme (set/default/unset). */
  theme: ResolvedTheme;
  /** Per-creative rotation pace, taken from the ambient PlannedState's
   *  dwell_target_ms (see the dwell_target_ms OPEN QUESTION). The slot
   *  itself runs indefinitely per D-GRH-26. */
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
   * Resolve the playlist from the applied AssetManifest. Enumerates every
   * entry whose `asset_id` starts with the `ambient:` prefix — via
   * `AssetManifestStore.manifestEntries()` (SPEC-CRWDQ-064) — and orders
   * them by `asset_id` lexical order: the `ambient:<NNN>` id-naming
   * convention encodes the sequence. There is no separate `ambient_seq`
   * metadata field on the manifest entry.
   */
  resolve(): AmbientCreative[];
}

export interface AmbientCreative {
  asset_id: string;
  url: string;                       // CachedAsset.url from AssetManifestStore.get()
  /** Coarse category derived from the SPEC-CRWDQ-064 manifest entry's
   *  MIME content_type (`image/*` -> 'image', `video/*` -> 'video').
   *  Phase-1: image only; video deferred. */
  content_type: 'image' | 'video';
  duration_ms: number | null;        // for video; an image uses dwellTargetMs
}
```

`ResolvedTheme`, `PendingPreferenceApply`, and the `PlannedStateActivator` / `ProgramSlotResolver` / `TransitionExecutor` / `DwellTimer` interfaces are defined by SPEC-CRWDQ-023 and consumed verbatim. `AssetManifestStore` is owned by SPEC-CRWDQ-064. `SafeInfoTemplate` / `SafeInfoContext` are owned by SPEC-CRWDQ-052.

### DOM shape

```
<section class="crowdaq-ambient" data-theme>
  <div class="cdq-ambient-stage" data-active-index="0">
    <!-- Active creative: <img> or <video> mounted here -->
    <img class="cdq-ambient-creative" data-asset-id alt="" />
  </div>
</section>
```

A single render slot — one creative visible at a time. Rotation happens by swapping the `data-asset-id` and the `<img src>` (or `<video src>`) on the rotation boundary.

### Activation flow

For a `PlannedStateFrame` whose `payload.business_mode === "ambient"`:

1. **Resolve the (empty) `ProgramSlot`.** The `ambient` `PlannedState` carries a non-null `program_slot_id` (SPEC-CRWDQ-051). The shared `PlannedStateActivator` buffers the `PlannedStateFrame` until its `ProgramSlot` resolves (the SPEC-CRWDQ-023 buffer-with-5s-timeout path). The resolved `ProgramSlot` is empty (`primary_game_id: null`, `game_ids: []`, `fixture_ids: []`) and the ambient template does not read it — but the activation cannot proceed until it resolves, so it must not be assumed absent.
2. **Resolve playlist.** `AmbientPlaylist.resolve()`. If empty → journal `ambient_empty_manifest` and mount `SafeInfoTemplate` (SPEC-CRWDQ-052) into this template's host instead, building a `SafeInfoContext` whose `source = { kind: 'backend_planned', reason: 'no_content' }` (the ambient slot was authored but carries no creatives). This is NOT a no-op — D-GRH-27 says ambient falls back to `safe_info` when the `AssetManifest` is empty.
3. **Filter by category.** Phase-1: keep entries whose derived `content_type` is `image`. `video` entries are journaled `ambient_video_deferred` and skipped. If after filtering the playlist is empty → the same `safe_info` fallback as step 2.
4. **Run transition.** The shared `TransitionExecutor.run(plannedState.payload.transition, host)` — the backend supplies `"cut"` for `ambient` (SPEC-CRWDQ-051); a catalog miss falls back per the SPEC-CRWDQ-023 `TransitionExecutor` contract.
5. **Mount.** Build `<section class="crowdaq-ambient">` with one stage element. Set the initial `<img src>` to the first creative; record `data-active-index="0"`.
6. **Apply pending preferences.** The same SPEC-CRWDQ-023 dwell-boundary contract. A theme swap takes effect; the stage element re-renders with the new `data-theme`.
7. **Rotate.** Arm `DwellTimer.arm(dwellTargetMs, onBoundary)`. On each boundary:
   - Advance `activeIndex` by 1 modulo `playlist.length`.
   - Swap `<img src>` and `data-asset-id`.
   - Journal `ambient_creative_advanced` with `{ from: prev_asset_id, to: next_asset_id, index, total }`.
   - Re-arm the dwell timer for the next rotation.
8. **No supersede until a new `PlannedState`.** Per D-GRH-26 the ambient *slot* is indefinite — the rotation loop continues until the server pushes a new `PlannedState`.

### AssetManifest update mid-mount

If a new `AssetManifest` arrives while the template is mounted (e.g. an operator updated ambient branding — D-GRH-27): the template does NOT immediately replace the active creative (that would flash). Instead, on the next rotation boundary, `AmbientPlaylist.resolve()` is re-called and the new playlist takes effect from the next rotation, starting at index 0 of the new playlist. Journal `ambient_playlist_refreshed`.

### Asset preload

To avoid a black frame during rotation: at mount time, the template inserts `<link rel="preload" as="image" href="...">` for upcoming playlist creatives, forcing the browser to load them into the HTTP cache so the swap on rotation renders synchronously. For larger playlists (> 10) the preload is throttled to the next 3 entries only — refreshed on each boundary.

### Anti-flash constraint

Per D-GRH-31 the no-flash constraint applies broadly. Ambient creatives intended to flash (a backend-authoring concern) must be substituted with a static fallback by the player. Phase-1 does NOT inspect image content for flashing patterns — that is deferred. The constraint is documented here for the spec record.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `PlannedStateActivator`, `ProgramSlotResolver`, `TransitionExecutor`, `DwellTimer` | 1 in-process | Real shared instances. |
| `AssetManifestStore`, `AmbientPlaylist` | 1 in-process | Real instances; pre-seed with creatives. |
| `SafeInfoTemplate` | 1 in-process | Real instance from SPEC-CRWDQ-052 (the fallback path exercised end-to-end). |
| DOM | 1 in-process | jsdom. |
| Clock | system boundary | Fake timers; advance to drive rotations. |
| Journal sink | 2 local-substitutable | In-memory. |
| Asset URL `<link preload>` | system boundary | Not asserted on the network; only that `<link rel="preload">` elements are inserted with the correct `href`. |

Test cases:

- Happy mount: 3 image creatives → DOM contains the stage with the first creative; `data-active-index="0"`.
- Empty `ProgramSlot` resolves: the `ambient` `PlannedState` carries a `program_slot_id` to an empty `ProgramSlot` → the activator buffers, the `ProgramSlot` frame arrives, activation proceeds.
- Rotation: advance the fake clock by `dwellTargetMs` → `data-active-index="1"`; `<img src>` updated; journal `ambient_creative_advanced`.
- Wrap-around: advance through all creatives + 1 more → returns to index 0.
- Empty playlist: `AmbientPlaylist.resolve()` empty → journal `ambient_empty_manifest`; `SafeInfoTemplate` mounted in this template's host (verifiable via DOM: `<section class="crowdaq-safe-info">` present, `<section class="crowdaq-ambient">` absent).
- Video filter: a playlist with 2 `image` + 1 `video` → only 2 creatives rotate; journal `ambient_video_deferred` once.
- All-video playlist: only video entries → filtered to empty → `safe_info` fallback.
- Playlist refresh: while index=1, dispatch a new `AssetManifest` with different creatives → at the next boundary `AmbientPlaylist.resolve()` returns the new playlist; the index resets to 0 of the new playlist; journal `ambient_playlist_refreshed`.
- Preload elements: assert `<link rel="preload" as="image">` is injected for the next 3 creatives at mount; refreshed after each rotation.
- Theme swap at boundary: the same shared SPEC-CRWDQ-023 contract.
- Indefinite dwell: simulate 10 rotations → the cycle continues, no detach; the journal stream contains 10 `ambient_creative_advanced` entries.
- Supersede: a `PlannedState{business_mode:"single_game"}` arrives → standard supersede flow; ambient detaches; `DwellTimer` canceled.

## Vocabulary

- `ambient` — a `business_mode` value (SPEC-CRWDQ-017 closed 9-value enum); the backend `template_id` is `"ambient-rotation"` (SPEC-CRWDQ-051).
- "AssetManifest-driven" — the D-GRH-27 content model: creatives are read from the `AssetManifest` cache, not the game-data channel.
- "indefinite dwell" — per D-GRH-26: the ambient *slot* runs until the next `PlannedState`; `dwell_target_ms` paces the per-creative rotation (see the OPEN QUESTION).
- `ambient:<NNN>` — the `asset_id` prefix convention for ambient creatives; an acknowledged prefix in SPEC-CRWDQ-064's vocabulary, minted by the `AssetManifest` publisher.

## Acceptance Criteria

- [ ] `AmbientTemplate.mount(host, ctx)` renders `<section class="crowdaq-ambient" data-theme>` containing a `<div class="cdq-ambient-stage" data-active-index>` with one `<img class="cdq-ambient-creative" data-asset-id>` reflecting the first creative.
- [ ] The `ambient` `PlannedState`'s non-null `program_slot_id` is resolved via the shared `ProgramSlotResolver` (an empty `ProgramSlot`); the template does not assume the `ambient` `PlannedState` lacks a `ProgramSlot`.
- [ ] `AmbientPlaylist.resolve()` enumerates `ambient:`-prefixed manifest entries via `AssetManifestStore.manifestEntries()`, orders them by `asset_id` lexical order, keeps `image`-category entries, and skips `video` entries with `ambient_video_deferred` journaled.
- [ ] An empty playlist (no `ambient:*` assets, or all filtered out) journals `ambient_empty_manifest` and routes the `ambient` activation to `SafeInfoTemplate` in the same host with `source = { kind: 'backend_planned', reason: 'no_content' }` — the DOM ends with `<section class="crowdaq-safe-info">` not `<section class="crowdaq-ambient">`.
- [ ] At each `dwellTargetMs` rotation boundary the `data-active-index` advances modulo the playlist length, `<img src>` and `data-asset-id` swap, and `ambient_creative_advanced` is journaled with the from/to/index/total payload.
- [ ] A mid-mount `AssetManifest` update is picked up on the next rotation boundary via `AmbientPlaylist.resolve()`; the new playlist starts at index 0; journal `ambient_playlist_refreshed`.
- [ ] Asset preload: `<link rel="preload" as="image" href="...">` elements exist for the next 3 creatives at mount and after each rotation.
- [ ] A theme swap on `pendingApply` follows the shared boundary contract; `ctx.theme` is the SPEC-CRWDQ-023 `ResolvedTheme`; the rotation is independent of the theme swap.
- [ ] Indefinite dwell: rotation continues until a new `PlannedState` arrives; the template does not auto-detach.
- [ ] On supersede, `DwellTimer.cancel()` is called and the instance detaches per the shared activator flow.
- [ ] Tests cover happy mount, empty-ProgramSlot resolution, rotation, wrap-around, empty-manifest fallback, video filter, all-video fallback, playlist refresh, preload elements, theme swap, indefinite dwell, supersede.
- [ ] No mocks of the shared orchestration, `AssetManifestStore`, or `SafeInfoTemplate` (INV-FACTORY-16); only the clock and the asset URL network boundary are substituted (INV-FACTORY-17).
