/**
 * SPEC-CRWDQ-041 — the `multiple_games_with_ads` composite (D-GRH-15, D-GRH-16).
 *
 * Renders `<section class="crowdaq-with-ads cdq-with-ads-right"
 * data-mode="multiple_games_with_ads">` holding the UNMODIFIED `MultiGameTemplate`
 * output inside `.cdq-content` beside the `AdPanel` output. The composite COMPOSES
 * the multi-game template — it never forks it (INV-FACTORY-19): the same
 * 2..4-card grid, the same per-game `GameStateStore` subscriptions, the same card
 * decline on an out-of-range count. All the with-ads lifecycle (null-ad decline,
 * cache-miss fall-through, `ad_slot_completed` teardown) lives in the shared
 * {@link mountWithAdsComposite} engine; this file only binds the child.
 */
import type { MultiGameContext, MultiGameTemplate } from '../multi-game/MultiGameTemplate';
import type { TemplateInstance } from '../../render/TemplateInstance';
import {
  mountWithAdsComposite,
  type WithAdsCompositeContext,
} from './withAdsComposite';

/**
 * The composite context: everything the bare `MultiGameTemplate` needs PLUS the
 * with-ads slice ({@link WithAdsCompositeContext}). The child sees its own
 * context unchanged — the with-ads fields never reach `MultiGameTemplate`.
 */
export type MultiGameWithAdsContext = MultiGameContext & WithAdsCompositeContext;

export class MultiGameWithAdsTemplate {
  constructor(private readonly multiGame: MultiGameTemplate) {}

  /**
   * Mount the composite, the bare-grid fallback (ad cache miss), or null
   * (null ad_slot, or the grid declined an out-of-range card count).
   */
  mount(host: HTMLElement, ctx: MultiGameWithAdsContext): TemplateInstance | null {
    return mountWithAdsComposite(
      host,
      {
        mode: 'multiple_games_with_ads',
        mount: (contentHost) =>
          this.multiGame.mount(contentHost, {
            programSlot: ctx.programSlot,
            theme: ctx.theme,
            gameStateStore: ctx.gameStateStore,
            journal: ctx.journal,
            ...(ctx.cardTransitions === undefined ? {} : { cardTransitions: ctx.cardTransitions }),
            ...(ctx.crestResolver ? { crestResolver: ctx.crestResolver } : {}),
          }),
      },
      ctx,
    );
  }
}
