/**
 * SPEC-CRWDQ-041 — the shared "compose, don't fork" engine behind both with-ads
 * composites (`multiple_games_with_ads`, `fixtures_with_ads`).
 *
 * Both composites are structurally identical: a `<section class="crowdaq-with-ads
 * cdq-with-ads-right">` with `.cdq-content` (the UNMODIFIED child template's
 * output) beside `.cdq-ad-panel` (the {@link AdPanel} output). The only thing
 * that varies is which child template mounts into `.cdq-content` and the
 * `data-mode` value — so the activation flow, the null-ad-slot decline, the
 * cache-miss fall-through, and the `ad_slot_completed` teardown all live here
 * once and each composite supplies only its child via {@link ContentChild}
 * (INV-FACTORY-19: deep module, one owned surface, child templates untouched).
 *
 * Activation flow (per the spec):
 *   1. A null `adSlot` is an authoring error -> journal `template_input_invalid`
 *      (reason `missing_ad_slot`) and DECLINE (return null). Nothing mounts.
 *   2. Mount the composite shell + the child into `.cdq-content`. A child that
 *      itself declines (e.g. an out-of-range card count) tears the shell down
 *      and propagates the decline (the child already journaled why).
 *   3. Mount the `AdPanel` into `.cdq-ad-panel`. On a creative cache MISS the
 *      panel returns null + journals `ad_asset_cache_miss`; this engine then
 *      FALLS BACK — it discards the composite shell and re-mounts the child
 *      template DIRECTLY into the original host, so content is preserved with no
 *      composite chrome and no blank panel (D-GRH-16).
 *
 * The returned instance's `detach()` journals `ad_slot_completed` with the
 * dwell read from the parent's shared `DwellTimer` boundary, then tears the
 * child down (the child unwinds its own per-game subscriptions) and the panel.
 * Its `reconcile?` (SPEC-CRWDQ-023 hook, part-2 issue #56) forwards the event
 * VERBATIM to the content child and never touches the ad panel — a `program_slot`
 * revision propagates add/remove of cards or fixtures into `.cdq-content` with no
 * ad-panel flicker; `game_state_revision` is a child-side no-op (per-game state
 * reaches each card through its own subscription); the `ad_slot` variant is
 * documented but unreachable until backend AdSlot delivery lands (an in-place
 * `AdSlot` revision arrives as a new `PlannedState`, not a reconcile — spec
 * "Reconcile" section).
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { TemplateInstance, TemplateReconcileEvent } from '../../render/TemplateInstance';
import type { AdSlotPayload } from '../../render/types';
import { AdPanel, type AdPanelInstance } from './AdPanel';

/** The mode-specific child a composite supplies (INV-FACTORY-19 seam). */
export interface ContentChild {
  /** Stable `data-mode` value for the composite shell. */
  mode: 'multiple_games_with_ads' | 'fixtures_with_ads';
  /**
   * Mount the UNMODIFIED child template into `contentHost`, or null when the
   * child declines (it has already journaled its own reason). This is the ONLY
   * place a composite differs — the child template is composed, never forked.
   */
  mount(contentHost: HTMLElement): TemplateInstance | null;
}

/** The slice of context every with-ads composite carries beyond its child. */
export interface WithAdsCompositeContext {
  /** The resolved AdSlot, or null (an authoring error -> decline, AC). */
  adSlot: AdSlotPayload | null;
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
  /** The parent PlannedState's `state_id`, for the ad journal payloads. */
  stateId: string;
  /**
   * Reads the actual dwell from the shared `DwellTimer` at supersede, filled
   * into `ad_slot_completed` (D-GRH-29). The activator owns the timer; the
   * composite only reads it at detach. Defaults to 0 when the host deployment
   * has no dwell wiring (e.g. a unit mount with no activator).
   */
  dwellActualMs?: () => number;
}

/**
 * Mount a with-ads composite, returning the live instance, the bare-child
 * fallback instance, or null (decline). Both child templates compose through
 * this single engine.
 */
export function mountWithAdsComposite(
  host: HTMLElement,
  child: ContentChild,
  ctx: WithAdsCompositeContext,
): TemplateInstance | null {
  // 1. A null ad_slot is an authoring error: decline + journal (no mount).
  if (ctx.adSlot === null) {
    ctx.journal.record({
      type: 'template_input_invalid',
      reason: 'missing_ad_slot',
      state_id: ctx.stateId,
      mode: child.mode,
    });
    return null;
  }
  const adSlot = ctx.adSlot;

  // 2. Build the composite shell + mount the child into .cdq-content.
  const section = buildShell(child.mode);
  const contentHost = section.querySelector<HTMLElement>('.cdq-content')!;
  host.append(section);

  const content = child.mount(contentHost);
  if (content === null) {
    // The child declined (it journaled why) — tear the shell back down.
    section.remove();
    return null;
  }

  // 3. Mount the ad panel as the section's right-column `<aside>` (the spec DOM
  //    shape: section > .cdq-content + aside.cdq-ad-panel). A cache miss falls
  //    back to the bare child (D-GRH-16).
  const panel = new AdPanel().mount(section, {
    adSlot,
    assetManifestStore: ctx.assetManifestStore,
    journal: ctx.journal,
    stateId: ctx.stateId,
    positionClass: 'right',
  });
  if (panel === null) {
    return fallBackToBareChild(host, section, content, contentHost, child);
  }

  return new WithAdsCompositeInstance(section, content, panel, adSlot, ctx);
}

/**
 * Cache-miss fall-through (D-GRH-16): discard the composite shell and re-host
 * the already-mounted child DIRECTLY in the original host, so the content is
 * preserved with no composite chrome and no blank ad panel. The child keeps its
 * live subscriptions — its DOM is moved, not remounted, so per-game state and
 * the card set are untouched.
 */
function fallBackToBareChild(
  host: HTMLElement,
  section: HTMLElement,
  content: TemplateInstance,
  contentHost: HTMLElement,
  _child: ContentChild,
): TemplateInstance {
  // Move every child node the content template rendered up into the host.
  while (contentHost.firstChild) host.append(contentHost.firstChild);
  section.remove();
  return content;
}

/**
 * The live composite instance. `detach()` journals `ad_slot_completed` with the
 * boundary dwell, then chains the child detach (unwinds per-game subscriptions)
 * and the panel detach, and returns the shell node for the outgoing transition.
 */
class WithAdsCompositeInstance implements TemplateInstance {
  constructor(
    private readonly section: HTMLElement,
    private readonly content: TemplateInstance,
    private readonly panel: AdPanelInstance,
    private readonly adSlot: AdSlotPayload,
    private readonly ctx: WithAdsCompositeContext,
  ) {}

  detach(): HTMLElement {
    this.ctx.journal.record({
      type: 'ad_slot_completed',
      ad_slot_id: this.adSlot.ad_slot_id,
      ad_ref: this.adSlot.ad_ref,
      state_id: this.ctx.stateId,
      dwell_actual_ms: this.ctx.dwellActualMs?.() ?? 0,
    });
    this.content.detach();
    this.panel.detach();
    this.section.remove();
    return this.section;
  }

  /**
   * Forward the in-place revision VERBATIM to the content child (SPEC-CRWDQ-023
   * `TemplateInstance.reconcile?`). The composite is structural: it owns the
   * shell + the ad panel, but the card/fixture diff is the child's concern, so a
   * `program_slot` event propagates add/remove of cards or fixtures into
   * `.cdq-content` exactly as the bare child would. The ad panel is never
   * touched here — no re-render, no flicker (D-GRH-16). `game_state_revision`
   * and the (currently unreachable) `ad_slot` kind are forwarded as-is and the
   * child no-ops them. When the child has no reconcile hook (it opted out),
   * there is nothing to delegate and this resolves immediately.
   */
  async reconcile(event: TemplateReconcileEvent): Promise<void> {
    await this.content.reconcile?.(event);
  }
}

/**
 * Build the empty composite shell: `section > .cdq-content`. The `AdPanel`
 * appends its own `<aside class="cdq-ad-panel">` as the section's second child
 * (the grid's right column), so the rendered DOM matches the spec shape exactly.
 */
function buildShell(mode: ContentChild['mode']): HTMLElement {
  const section = document.createElement('section');
  section.className = 'crowdaq-with-ads cdq-with-ads-right';
  section.dataset['mode'] = mode;

  const content = document.createElement('div');
  content.className = 'cdq-content';

  section.append(content);
  return section;
}
