/**
 * SPEC-CRWDQ-023 (part 2) — the single_game overlay-ad branch (AC6–AC9).
 *
 * When a `PlannedState` carries a non-null `ad_slot_id`, the `business_mode`
 * stays `single_game` (there is NO `single_game_with_ads` member in the
 * D-GRH-26 closed enum); the activator mounts the bare `SingleGameTemplate`
 * content AND an absolutely-positioned overlay ABOVE it (SPEC-CRWDQ-065). The
 * overlay never displaces, re-flows, or theme-resolves the content (D-GRH-16):
 * both children bind to the SAME PlannedState — instantiated at activation,
 * destroyed on transition-out — and the composite `detach()` chains content
 * first, overlay second.
 *
 * Two overlay paths:
 *
 *   - AC7 (the current universal case): no `AdSlot` payload is resolvable
 *     (the backend AdSlot stream is not wired yet), so the composite mounts an
 *     EMPTY `.cdq-ad-overlay` (NO `<img>` child) and journals
 *     `ad_slot_payload_unavailable`. Content is unaffected.
 *   - AC8 (contract-pin, unreachable now): an `AdSlot` payload IS available, so
 *     the overlay mount is DELEGATED to SPEC-CRWDQ-065's `SingleGameOverlayAd`
 *     seam. Asset-cache-miss handling, the `ad_slot_rendered` journal, and the
 *     creative paint are OWNED BY SPEC-CRWDQ-065 — this spec only declares the
 *     seam and calls it. The seam does not yet exist on `main`; this is the
 *     minimal local port so the branch type-checks, awaiting SPEC-CRWDQ-065.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateInstance } from '../../render/TemplateInstance';
import type { AdSlotPayload } from '../../render/types';
import type { SingleGameContext, SingleGameInstance, SingleGameTemplate } from './SingleGameTemplate';

/** Stable test ids for the composite shell's sub-regions (AC6/AC7). */
export const OVERLAY_TESTID = {
  composite: 'single-game-composite',
  content: 'single-game-content',
  overlay: 'single-game-ad-overlay',
} as const;

/**
 * Read-only port over the resolved `AdSlot` for an `ad_slot_id` (D-GRH-15). The
 * current backend emits no `AdSlot` frames, so the production adapter resolves
 * to null for every id (the AC7 path); a future SPEC-CRWDQ-041 adapter resolves
 * real slots (the AC8 path). A narrow seam (INV-FACTORY-19): the activator never
 * reaches into AdSlot storage internals.
 */
export interface AdSlotResolver {
  resolve(adSlotId: string): AdSlotPayload | null;
}

/** The context SPEC-CRWDQ-065's overlay-ad consumes — single_game ctx + the slot. */
export type SingleGameOverlayContext = SingleGameContext & { adSlot: AdSlotPayload };

/** SPEC-CRWDQ-065's overlay-ad instance — detach tears down the creative. */
export interface SingleGameOverlayInstance {
  detach(): void;
}

/**
 * SPEC-CRWDQ-065's overlay-ad seam (CONTRACT-PIN). Mounts the ad creative as an
 * absolutely-positioned overlay above the single_game content. Owned by
 * SPEC-CRWDQ-065; declared here as the minimal port the AC8 branch calls.
 */
export interface SingleGameOverlayAd {
  mount(host: HTMLElement, ctx: SingleGameOverlayContext): SingleGameOverlayInstance;
}

/** Everything the composite needs beyond the shared single_game context. */
export interface OverlayCompositeDeps {
  host: HTMLElement;
  template: { mount(host: HTMLElement, ctx: SingleGameContext): SingleGameInstance };
  overlayAd: SingleGameOverlayAd;
  adSlots: AdSlotResolver;
  journal: RenderJournal;
  stateId: string;
  adSlotId: string;
}

/**
 * Mount the overlay composite: content child + absolutely-positioned overlay
 * (AC6/AC7/AC8). Returns a `TemplateInstance` whose `detach()` chains content
 * first, overlay second (AC9), and whose `reconcile?` is left unimplemented —
 * the content reconciles through its `GameStateStore` subscription, the overlay
 * is not reconciled in place (an AdSlot change arrives as a new PlannedState).
 */
export function mountOverlayComposite(deps: OverlayCompositeDeps, ctx: SingleGameContext): TemplateInstance {
  const section = document.createElement('section');
  section.className = 'crowdaq-single-game-composite';
  section.dataset['testid'] = OVERLAY_TESTID.composite;

  // Content host: the bare single_game DOM renders into here, unmodified.
  const contentHost = document.createElement('div');
  contentHost.className = 'cdq-content';
  contentHost.dataset['testid'] = OVERLAY_TESTID.content;

  // Overlay host: absolutely positioned ABOVE the content (CSS owns the stack).
  const overlayHost = document.createElement('div');
  overlayHost.className = 'cdq-ad-overlay';
  overlayHost.dataset['testid'] = OVERLAY_TESTID.overlay;

  section.append(contentHost, overlayHost);
  deps.host.appendChild(section);

  // Both children bind to THIS PlannedState (AC9): content always mounts.
  const content = deps.template.mount(contentHost, ctx);

  // Overlay path: delegate to SPEC-CRWDQ-065 when a payload is available (AC8),
  // else mount the empty overlay + journal the gap (AC7).
  const adSlot = deps.adSlots.resolve(deps.adSlotId);
  let overlay: SingleGameOverlayInstance | null = null;
  if (adSlot !== null) {
    overlay = deps.overlayAd.mount(overlayHost, { ...ctx, adSlot });
  } else {
    deps.journal.record({
      type: 'ad_slot_payload_unavailable',
      state_id: deps.stateId,
      ad_slot_id: deps.adSlotId,
    });
  }

  return {
    detach(): HTMLElement {
      // AC9 chained teardown: content first, overlay second.
      content.detach();
      if (overlay !== null) overlay.detach();
      section.remove();
      return section;
    },
  };
}
