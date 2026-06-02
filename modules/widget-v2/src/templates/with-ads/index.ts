/**
 * SPEC-CRWDQ-041 — with-ads composite templates barrel.
 *
 * The two composite templates (`multiple_games_with_ads`, `fixtures_with_ads`),
 * the shared `AdPanel` primitive, the compose engine, and the activator
 * adapters. The composites COMPOSE the merged `MultiGameTemplate` /
 * `FixturesTemplate` unmodified — they do not fork them (INV-FACTORY-19).
 */
export { AdPanel } from './AdPanel';
export type { AdPanelContext, AdPanelInstance, AdPanelPosition } from './AdPanel';
export { SingleGameOverlayAd } from './SingleGameOverlayAd';
export type { SingleGameOverlayAdDeps } from './SingleGameOverlayAd';
export { MultiGameWithAdsTemplate } from './MultiGameWithAdsTemplate';
export type { MultiGameWithAdsContext } from './MultiGameWithAdsTemplate';
export { FixturesWithAdsTemplate } from './FixturesWithAdsTemplate';
export type { FixturesWithAdsContext } from './FixturesWithAdsTemplate';
export { mountWithAdsComposite } from './withAdsComposite';
export type { ContentChild, WithAdsCompositeContext } from './withAdsComposite';
export {
  makeMultiGameWithAdsAdapter,
  makeFixturesWithAdsAdapter,
  SnapshottingDwellTimer,
} from './WithAdsAdapter';
export type {
  AdSlotResolver,
  MultiGameWithAdsAdapterDeps,
  FixturesWithAdsAdapterDeps,
  PendingTimezoneApply,
} from './WithAdsAdapter';
