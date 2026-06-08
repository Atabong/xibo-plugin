/**
 * SPEC-CRWDQ-041 — the `fixtures_with_ads` composite (D-GRH-15, D-GRH-16).
 *
 * Renders `<section class="crowdaq-with-ads cdq-with-ads-right"
 * data-mode="fixtures_with_ads">` holding the UNMODIFIED `FixturesTemplate`
 * output inside `.cdq-content` beside the `AdPanel` output. Like its multi-game
 * sibling it COMPOSES the fixtures template without forking it (INV-FACTORY-19):
 * the same pre-game catalog, the same per-fixture `FixtureListStore`
 * subscriptions, the same empty-list decline. The fixtures template runs its own
 * PlannedState-level transition against `.cdq-content` on mount — that is the
 * child's behaviour unchanged. All with-ads lifecycle lives in the shared
 * {@link mountWithAdsComposite} engine; this file only binds the child.
 */
import type { FixturesContext, FixturesTemplate } from '../fixtures/FixturesTemplate';
import type { TemplateInstance } from '../../render/TemplateInstance';
import {
  mountWithAdsComposite,
  type WithAdsCompositeContext,
} from './withAdsComposite';

/**
 * The composite context: everything the bare `FixturesTemplate` needs PLUS the
 * with-ads slice. The child sees its own context unchanged.
 */
export type FixturesWithAdsContext = FixturesContext & WithAdsCompositeContext;

export class FixturesWithAdsTemplate {
  constructor(private readonly fixtures: FixturesTemplate) {}

  /**
   * Mount the composite, the bare-list fallback (ad cache miss), or null
   * (null ad_slot, or the fixtures list declined an empty `fixture_ids`).
   */
  mount(host: HTMLElement, ctx: FixturesWithAdsContext): TemplateInstance | null {
    return mountWithAdsComposite(
      host,
      {
        mode: 'fixtures_with_ads',
        mount: (contentHost) =>
          this.fixtures.mount(contentHost, {
            programSlot: ctx.programSlot,
            theme: ctx.theme,
            timezone: ctx.timezone,
            fixtureListStore: ctx.fixtureListStore,
            assetManifestStore: ctx.assetManifestStore,
            transitionExecutor: ctx.transitionExecutor,
            transition: ctx.transition,
            journal: ctx.journal,
            pendingApply: ctx.pendingApply,
            ...(ctx.cardTransitions === undefined ? {} : { cardTransitions: ctx.cardTransitions }),
            ...(ctx.now === undefined ? {} : { now: ctx.now }),
            ...(ctx.crestResolver === undefined ? {} : { crestResolver: ctx.crestResolver }),
          }),
      },
      ctx,
    );
  }
}
