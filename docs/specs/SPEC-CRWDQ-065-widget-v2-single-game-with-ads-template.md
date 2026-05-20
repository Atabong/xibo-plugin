---
spec_id: SPEC-CRWDQ-065
title: Widget v2 single_game_with_ads template
status: draft
owner: player-runtime/widget-v2/templates/with-ads
depends_on: [SPEC-CRWDQ-023, SPEC-CRWDQ-041, SPEC-CRWDQ-064]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-065 — Widget v2 single_game_with_ads template

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S8 — Ad inventory + AdSlot render |
| Plane epic | CRWDQ-9 |
| Decisions referenced | D-GRH-15, D-GRH-16, D-GRH-21, D-GRH-23, D-GRH-30, D-GRH-50, D-GRH-55, D-GRH-62 |
| Source files | `modules/widget-v2/src/templates/single-game/SingleGameTemplate.ts` (composed), `modules/widget-v2/src/templates/with-ads/AdPanel.ts` (composed), `modules/widget-v2/src/render/AssetManifestStore.ts` (consumed), `modules/widget-v2/src/render/AdSlotResolver.ts` (consumed) |
| New files | `modules/widget-v2/src/templates/with-ads/SingleGameWithAdsTemplate.ts`, `modules/widget-v2/src/templates/with-ads/single-game-with-ads.css`, `modules/widget-v2/tests/templates/with-ads/single-game-with-ads.test.ts` |

## Module

`player-runtime :: widget-v2 :: templates/with-ads` (extends) — the `single_game_with_ads` composite template (D-GRH-30 mode #5). Composes `SingleGameTemplate` (SPEC-CRWDQ-023) with `AdPanel` (SPEC-CRWDQ-041) inside the same with-ads grid shell SPEC-CRWDQ-041 introduces for `multiple_games_with_ads` and `fixtures_with_ads`. The `AdPanel` rotates ad creatives dwell-aware — rotation happens within the parent `PlannedState`'s `dwell_target_ms`, not bypassing it.

This spec is intentionally thin. SPEC-CRWDQ-041 explicitly flags it as a future thin compose-and-mount file ("the same `AdPanel` primitive added here makes the future `single_game_with_ads` spec a thin compose-and-mount file"). The grill amendment promotes that future to a present spec because D-GRH-30 mode #5 is a first-class business mode.

## Current shape

- SPEC-CRWDQ-023 renders `single_game` with no ad surface. SPEC-CRWDQ-041 renders `multiple_games_with_ads` and `fixtures_with_ads` but explicitly defers `single_game_with_ads`.
- D-GRH-30 enumerates 9 explicit modes; #5 is `single_game_with_ads`. Backend `BarPlayerSchedulerService` (per D-GRH-62) emits `PlannedState` with this mode and an `ad_slot_id`.
- D-GRH-15 establishes ad-coexistence semantics: ad slots and content slots are independent but co-rendered; the ad does not displace content.
- D-GRH-16 establishes the uniform "ad never displaces content" rule, applying to all with-ads composites including this one.
- Dwell-aware ad rotation is new to this spec. SPEC-CRWDQ-041's ad panel is static-per-slot (mounted once, unmounted on supersede). For `single_game_with_ads`, the live game state may persist for a long dwell (the game is in progress), so a single ad creative across the full dwell is undesirable. This spec adds rotation INSIDE the panel without affecting the parent dwell — i.e., the panel cycles through `AdSlot.ad_rotation[]` entries on a sub-dwell cadence; the parent slot's dwell timer is untouched.

## Proposed deep interface

```ts
// modules/widget-v2/src/templates/with-ads/SingleGameWithAdsTemplate.ts
export interface SingleGameWithAdsTemplate {
  mount(host: HTMLElement, ctx: SingleGameContext & { adSlot: AdSlot }): SingleGameWithAdsInstance;
}

export interface SingleGameWithAdsInstance {
  detach(): HTMLElement;
}
```

The template reuses `SingleGameContext` from SPEC-CRWDQ-023 verbatim — no new field shape. The added `adSlot` field is the same shape `MultiGameWithAdsTemplate` / `FixturesWithAdsTemplate` from SPEC-CRWDQ-041 already consume.

### Ad rotation extension to AdSlot (additive, backward-compatible)

```ts
// extends AdSlot from SPEC-CRWDQ-041
export interface AdSlot {
  ad_slot_id: string;
  ad_class: string;
  ad_ref: string;                // phase-1: asset_id key into AssetManifest
  ad_ref_type: 'asset_id';
  policy: Record<string, unknown>;

  /**
   * Optional rotation set. If present and non-empty, the AdPanel
   * cycles through these references at `rotation_cadence_ms`. If
   * absent, the panel renders only `ad_ref` for the full slot
   * (existing SPEC-CRWDQ-041 behavior). Backend-authored.
   */
  ad_rotation?: ReadonlyArray<{ ad_ref: string; ad_ref_type: 'asset_id' }>;
  rotation_cadence_ms?: number;  // default 8000 if `ad_rotation` present and field omitted
}
```

`ad_rotation` is optional; SPEC-CRWDQ-041 templates ignore it (`AdPanel.mount` reads only `ad_ref`). This spec's `SingleGameWithAdsTemplate` consults it. Future SPEC may also opt SPEC-CRWDQ-041 templates into rotation by passing the rotation context to the panel — out of scope here.

### DOM shape — composite

Identical to SPEC-CRWDQ-041's grid shell, mode value differs:

```
<section class="crowdaq-with-ads cdq-with-ads-right" data-mode="single_game_with_ads">
  <div class="cdq-content"><!-- SingleGameTemplate output, untouched --></div>
  <aside class="cdq-ad-panel" data-position="right" data-ad-slot-id data-ad-class data-rotation-index>
    <img class="cdq-ad-creative" alt="" src="<ad-asset-url>" />
  </aside>
</section>
```

`data-rotation-index` is new (vs SPEC-CRWDQ-041) — present when `ad_rotation` is in effect, value is the current index into the rotation array. Helpful for tests + debug.

### Activation flow

For `PlannedState` with `mode: "single_game_with_ads"` and `ad_slot_id: A`, `program_slot_id: X`:

1. **Resolve `ProgramSlot`** + **resolve `AdSlot`.** Same as SPEC-CRWDQ-041. Either missing → journal `template_input_invalid` and fall through to safe.
2. **Validate ad asset(s).** If `adSlot.ad_rotation` is absent: same as SPEC-CRWDQ-041 — resolve `adSlot.ad_ref` via `AssetManifestStore.ensure("ad:" + ad_ref)`. Cache miss → journal `ad_asset_cache_miss` and fall back to mounting `SingleGameTemplate` directly (no composite shell, no ad panel). If `adSlot.ad_rotation` is present: resolve EVERY referenced `ad_ref` in the rotation (parallel `ensure()`). Any single miss does NOT fall back — the rotation skips missed entries with `journal ad_rotation_entry_cache_miss`. If ALL entries miss, fall back to non-ad single_game (same path as the single-ref miss).
3. **Run transition.** Same shared `TransitionExecutor`.
4. **Mount composite shell.** Build the `<section>` with content + ad-panel children. (Same DOM shape as SPEC-CRWDQ-041; only `data-mode` differs.)
5. **Mount content child.** `SingleGameTemplate.mount(contentHost, ctx)` — unchanged behavior from SPEC-CRWDQ-023.
6. **Mount ad panel.**
   - No rotation: `AdPanel.mount(adHost, { adSlot, assetManifestStore, positionClass: 'right' })`. Identical to SPEC-CRWDQ-041.
   - Rotation: mount the first entry's creative, then start a rotation interval at `rotation_cadence_ms` that:
     - Increments index (mod rotation.length).
     - Skips entries that were cache-miss during step 2 (their `ad_ref` is in a per-slot skip set).
     - Updates the `<img src>` and `data-rotation-index` attribute.
     - Journals `ad_rotation_advanced` with `ad_ref` (new), `ad_rotation_index`.
7. **Apply pending preferences** + **Arm parent dwell.** Same shared boundaries; the parent `DwellTimer` is untouched by ad rotation.

### Dwell-aware rotation contract

> Rotation cadence is INDEPENDENT of the parent `dwell_target_ms`. The parent slot's dwell is the schedule-driven lifetime of the live game render; ad rotation is content delivery inside that lifetime. They MUST NOT interact: rotating an ad does not cancel or extend the parent dwell; the parent dwell expiring does cancel the rotation interval (via the detach path below).

If `dwell_target_ms < rotation_cadence_ms` (e.g., a 10s slot with 30s rotation), only the first entry is shown; the parent supersedes before any rotation tick. This is correct — no need for "compressed" rotation.

If `dwell_target_ms` is exceptionally long (e.g., a 4-hour live game), rotation will cycle through the full set repeatedly. Journal `ad_rotation_cycled` once per full lap (not per entry) to keep journal volume bounded.

### Supersede / detach

When the parent `PlannedState` is superseded:

1. Cancel the rotation interval (`clearInterval`).
2. Shared outgoing transition runs on the `<section>`.
3. `SingleGameWithAdsInstance.detach()` calls both children:
   - `SingleGameTemplate.detach()` (unsubscribes the `GameStateStore` listener for `primary_game_id`).
   - `AdPanel.detach()`.
4. Journal `ad_slot_completed` with final `dwell_actual_ms` (from the shared `DwellTimer`) AND `ad_rotation_final_index` (or `null` if no rotation).

### Reconcile

Like SPEC-CRWDQ-041, the `single_game` content reacts to `GameState` events without re-mount. The ad panel is unaffected by `ProgramSlot` mutations (which only affect content). The `AdSlot` itself is not reconciled in place — an `AdSlot` change arrives as a new `PlannedState` (different `state_id`), not as a `ProgramSlot` mutation.

### No new orchestration

Everything else — `PlannedStateActivator`, `ProgramSlotResolver`, `GameStateStore`, `DwellTimer`, `TransitionExecutor`, `AssetManifestStore`, `AdSlotResolver`, `OverrideSuppressionState` — is consumed from earlier specs. This spec adds exactly one new template file + one new CSS file + the optional `ad_rotation` extension to `AdSlot`. The activator's dispatch on `mode == "single_game_with_ads"` routes here.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| Shared orchestration | 1 in-process | Real instances from SPEC-CRWDQ-023. |
| `SingleGameTemplate` | 1 in-process | Real instance — not mocked (INV-FACTORY-16). |
| `AdPanel` | 1 in-process | Real instance from SPEC-CRWDQ-041. |
| `AssetManifestStore` | 1 in-process | Real instance from SPEC-CRWDQ-064; pre-seed with rotation asset URLs via test driver. |
| `AdSlotResolver` | 1 in-process | Real. |
| DOM | 1 in-process | jsdom; assert grid + ad-panel + `data-rotation-index` attribute. |
| Image `load` event | system boundary | Stub as in SPEC-CRWDQ-041. |
| `DwellTimer`, clock | system boundary | Fake timers. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- **Happy mount — single ad_ref.** No `ad_rotation`; assert: content `.cdq-content` has `SingleGameTemplate` output; `.cdq-ad-panel` has `<img>` with `src` from manifest; no `data-rotation-index` attribute; mode `single_game_with_ads`.
- **Happy mount — rotation.** `ad_rotation` length 3, `rotation_cadence_ms: 5000`. Mount; assert: `data-rotation-index="0"`. Advance fake clock 5s → `data-rotation-index="1"`, `<img src>` updated, journal `ad_rotation_advanced`. Advance another 5s → index 2. Advance another 5s → index 0 (mod 3), journal `ad_rotation_cycled` once per lap.
- **Rotation entry cache miss.** Rotation length 3, middle entry miss. Mount + rotate: indexes 0 → 2 → 0 (skips 1); journal `ad_rotation_entry_cache_miss` for the missed entry; rotation does not stall on the gap.
- **All rotation entries cache miss.** Rotation length 3, all miss. Assert: composite falls back — mounts `SingleGameTemplate` directly into the bare slot host, no composite shell, no ad panel; journal `ad_asset_cache_miss`. Same fallback path as the no-rotation case.
- **No rotation cache miss falls back to non-ad single_game.** SPEC-CRWDQ-041 parity test.
- **GameState event mutates only `.cdq-content`.** Mount with rotation. Send a `GameEvent` for `primary_game_id`. Assert: score block in `.cdq-content` updates; `.cdq-ad-panel` `<img>` does NOT reload (same src, same `data-rotation-index`).
- **Rotation INDEPENDENT of parent dwell.** Mount with `dwell_target_ms: 30000`, `rotation_cadence_ms: 5000`. Advance fake clock 5s; assert: rotation advanced; parent `DwellTimer.elapsed()` ≈ 5000 (not reset); parent `onBoundary` NOT called.
- **Short dwell skips rotation.** `dwell_target_ms: 3000`, `rotation_cadence_ms: 8000`. Mount; advance 3s → parent boundary fires; assert: only first ad ever rendered (index stayed 0); rotation interval cleared by detach; no `ad_rotation_advanced` journal entries.
- **Long dwell cycles.** `dwell_target_ms: 60000`, `rotation_cadence_ms: 5000`, rotation length 3. Advance fake clock to 30s; assert: ≥ 1 `ad_rotation_cycled` journal (lap detected at index wrap, t=15s); index counts are correct.
- **Supersede mid-rotation.** Mount with rotation at index 2; send new `PlannedState` → assert: rotation interval cleared; `ad_slot_completed` journal contains `ad_rotation_final_index: 2`; both children detach.
- **Missing `AdSlot`.** `ad_slot_id` references unknown — journal `template_input_invalid`; no mount; falls through to safe.
- **Reconcile underlying `ProgramSlot`.** `programSlot.primary_game_id` changes via D-GRH-13 path (same `program_slot_id`, new `primary_game_id`). Assert: content sub-template re-renders for new game; ad panel + rotation untouched (no flicker on `<img>`, no rotation-index reset).

## Vocabulary

- `single_game_with_ads` — D-GRH-30 #5.
- `AdSlot.ad_rotation`, `rotation_cadence_ms` — additive extension introduced by this spec; backend authoring extends accordingly. No D-GRH amendment required for this purely additive surface (closed enum changes would; this does not change any enum).
- "coexistence" — D-GRH-16 uniform rule.
- "rotation cadence" — internal term defined in this spec.

## Acceptance Criteria

- [ ] `SingleGameWithAdsTemplate.mount(host, ctx)` renders `<section class="crowdaq-with-ads cdq-with-ads-right" data-mode="single_game_with_ads">` containing `.cdq-content` (with `SingleGameTemplate` output unmodified) and `.cdq-ad-panel` (with `AdPanel` output).
- [ ] `PlannedStateActivator` dispatches `mode: "single_game_with_ads"` to this template; the activator path is unchanged otherwise.
- [ ] Missing referenced `AdSlot` journals `template_input_invalid` and does not mount.
- [ ] When `adSlot.ad_rotation` is absent, behavior is identical to a SPEC-CRWDQ-041 composite for `single_game`: static ad creative for full slot lifetime, `ad_slot_rendered` on `<img>` load.
- [ ] When `adSlot.ad_rotation` is present, the `AdPanel` cycles through entries on `rotation_cadence_ms` (default 8000 if omitted); `data-rotation-index` attribute reflects the current index; `<img src>` updates per cycle; journals `ad_rotation_advanced` per advance, `ad_rotation_cycled` once per full lap.
- [ ] Rotation cadence is independent of parent `DwellTimer`: rotating an ad does NOT cancel or extend the parent dwell; the parent `onBoundary` callback fires at `dwell_target_ms` regardless of rotation activity.
- [ ] Per-entry cache miss in a rotation: missed `ad_ref` is added to a per-slot skip set; rotation continues, skipping missed entries; journals `ad_rotation_entry_cache_miss`.
- [ ] All-entries cache miss in a rotation OR single-`ad_ref` cache miss falls back to mounting `SingleGameTemplate` directly (no composite shell, no ad panel); journals `ad_asset_cache_miss` per D-GRH-16 content-preservation rule.
- [ ] `GameState` events update only `.cdq-content`; `.cdq-ad-panel` does not re-render (image not reloaded, rotation index unchanged).
- [ ] Underlying `ProgramSlot` reconcile (e.g., `primary_game_id` change via D-GRH-13) propagates into `.cdq-content`; rotation index and ad-panel `<img>` are unaffected.
- [ ] Supersede cancels the rotation interval; `ad_slot_completed` journal carries `dwell_actual_ms` and `ad_rotation_final_index` (or `null` if no rotation); both children detach exactly once.
- [ ] Short-dwell case (`dwell_target_ms < rotation_cadence_ms`): only the first rotation entry is rendered; no `ad_rotation_advanced` journal entries are emitted.
- [ ] Long-dwell case: `ad_rotation_cycled` journals once per full rotation lap, not per entry.
- [ ] Tests cover: happy mount (no rotation), happy mount (rotation), per-entry cache miss + skip, all-miss fallback, no-rotation cache miss fallback, GameState event isolation, dwell independence, short-dwell, long-dwell cycling, supersede mid-rotation, missing AdSlot, ProgramSlot reconcile.
- [ ] Tests use real `SingleGameTemplate` and real `AdPanel` instances (INV-FACTORY-16); only the WS source, clock, image `load` event, and journal sink are substituted (INV-FACTORY-17).
