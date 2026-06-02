/**
 * SPEC-CRWDQ-041 — the `AdPanel` primitive shared by every with-ads composite
 * (`multiple_games_with_ads`, `fixtures_with_ads`).
 *
 * The panel resolves its creative from the `AssetManifestStore` keyed by
 * `adSlot.ad_ref` (D-GRH-55 phase-1: the `ad_ref` IS the `asset_id`) and renders
 * exactly one static `<img class="cdq-ad-creative">`. Per D-GRH-62 the player
 * has NO ad-progression logic: no rotation, no video, no click behaviour — bar
 * screens are passive. The creative is read synchronously from the manifest's
 * hot cache (warmed eagerly on AssetManifest receipt, D-GRH-23).
 *
 * Cache-miss is NOT a panel-local fallback: per D-GRH-16 the composite must keep
 * the content visible, so on a miss the panel DECLINES (returns `null`), journals
 * `ad_asset_cache_miss`, and warms the cache via `ensure(ad_ref)` for the next
 * slot — the parent composite then mounts the non-ad content template directly.
 *
 * `ad_slot_rendered` (D-GRH-29) fires on the image's `load` event. The
 * `ad_slot_completed` journal is owned by the PARENT composite (it holds the
 * dwell boundary); the panel exposes `detach()` and leaves completion to the
 * parent so the `dwell_actual_ms` comes from the shared `DwellTimer`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { AdSlotPayload } from '../../render/types';

/** The position the parent composite places the panel in (grid column / row). */
export type AdPanelPosition = 'right' | 'bottom' | 'left' | 'top';

export interface AdPanelContext {
  adSlot: AdSlotPayload;
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
  /** The parent PlannedState's `state_id`, for the render journal payload. */
  stateId: string;
  /** Position class chosen by the parent composite (`right` for both modes). */
  positionClass: AdPanelPosition;
}

export interface AdPanelInstance {
  /** Detach the panel from its host and hand back the panel node. */
  detach(): HTMLElement;
}

export class AdPanel {
  /**
   * Mount the panel into `host`, or `null` on a creative cache miss (the parent
   * composite falls back to the non-ad content template, D-GRH-16). A non-null
   * return means the `<img>` is in the DOM and `ad_slot_rendered` is wired to
   * its `load` event.
   */
  mount(host: HTMLElement, ctx: AdPanelContext): AdPanelInstance | null {
    const creative = ctx.assetManifestStore.get(ctx.adSlot.ad_ref);
    if (creative === null) {
      // Miss: keep content visible (parent falls back), journal + warm cache.
      ctx.journal.record({
        type: 'ad_asset_cache_miss',
        ad_slot_id: ctx.adSlot.ad_slot_id,
        ad_ref: ctx.adSlot.ad_ref,
        state_id: ctx.stateId,
      });
      // Warm for the next slot; a rejection (id unknown) is non-fatal here.
      void ctx.assetManifestStore.ensure(ctx.adSlot.ad_ref).catch(() => {});
      return null;
    }

    const panel = buildPanel(ctx.adSlot, ctx.positionClass);
    const img = panel.querySelector<HTMLImageElement>('img.cdq-ad-creative')!;

    // ad_slot_rendered fires once, on the image load event (D-GRH-29).
    img.addEventListener(
      'load',
      () => {
        ctx.journal.record({
          type: 'ad_slot_rendered',
          ad_slot_id: ctx.adSlot.ad_slot_id,
          ad_ref: ctx.adSlot.ad_ref,
          state_id: ctx.stateId,
        });
      },
      { once: true },
    );
    // Assigning src kicks the load. The bytes are guaranteed present (D-GRH-23).
    img.src = creative.url;

    host.append(panel);
    return {
      detach(): HTMLElement {
        panel.remove();
        return panel;
      },
    };
  }
}

/** Build the `<aside class="cdq-ad-panel">` + its single static `<img>` (AC). */
function buildPanel(slot: AdSlotPayload, position: AdPanelPosition): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'cdq-ad-panel';
  panel.dataset['position'] = position;
  panel.dataset['adSlotId'] = slot.ad_slot_id;
  panel.dataset['adClass'] = slot.ad_class;

  const img = document.createElement('img');
  img.className = 'cdq-ad-creative';
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'eager';

  panel.append(img);
  return panel;
}
