/**
 * SPEC-CRWDQ-041 — the adapters that plug the with-ads composites into the
 * shared `PlannedStateActivator` (the SAME orchestration single_game /
 * multiple_games / fixtures use, never a forked activator — INV-FACTORY-19).
 *
 * The activator owns the whole lifecycle: it BUFFERS the composite PlannedState
 * until its `ProgramSlot` arrives (the 5 s `template_buffer_timeout` +
 * safe fall-through path, exactly as for every other mode), runs the
 * PlannedState-level transition, arms + owns the dwell, and on supersede cancels
 * the dwell + runs the outgoing transition + calls the composite `detach()`.
 *
 * This adapter contributes ONLY the mode-specific mount: it resolves the
 * `AdSlot` for `payload.ad_slot_id` via the injected {@link AdSlotResolver} (the
 * SECOND half of "buffer until BOTH the ProgramSlot AND the AdSlot resolve" — the
 * ProgramSlot half is the activator's, the AdSlot half is this resolve). An
 * UNRESOLVED ad slot is passed to the composite as `null`, which journals
 * `template_input_invalid` and declines the mount (the activator then renders
 * nothing). A resolved slot drives the full composite mount.
 *
 * `ad_slot_completed` (D-GRH-29) needs the dwell elapsed AT supersede, but the
 * activator cancels the dwell before calling `detach()`. {@link SnapshottingDwellTimer}
 * wraps the shared `DwellTimer` and records the elapsed value at the moment of
 * `cancel()`; the composite reads that snapshot in `detach()`. The same wrapper
 * instance is passed to the activator as its `dwell` and to the adapter here, so
 * the dwell the composite reports is the SHARED timer's, never a private clone.
 *
 * Register with
 * `activator.registerTemplate('multiple_games_with_ads', makeMultiGameWithAdsAdapter(...))`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { CrestResolver } from '../../render/CrestResolver';
import type { CardTransitions } from '../multi-game/CardSet';
import type { AdSlotPayload } from '../../render/types';
import { DwellTimer, type DwellClock, systemDwellClock } from '../../render/DwellTimer';
import type { MultiGameWithAdsTemplate } from './MultiGameWithAdsTemplate';
import type { FixturesWithAdsTemplate } from './FixturesWithAdsTemplate';
import type { FixturesContext } from '../fixtures/FixturesTemplate';

/**
 * Read-only port over the resolved `AdSlot` for an `ad_slot_id` (D-GRH-15),
 * mirroring the SPEC-CRWDQ-023 overlay seam. The current backend emits no
 * `AdSlot` frames, so the production resolver returns null until backend
 * delivery lands; the composite then declines and the activator renders nothing.
 */
export interface AdSlotResolver {
  resolve(adSlotId: string): AdSlotPayload | null;
}

/**
 * A `DwellTimer` that remembers the elapsed value at the instant it was
 * cancelled. The activator cancels the dwell at the START of a supersede, before
 * it calls the outgoing instance's `detach()`; this lets the composite report
 * the real mid-slot dwell in `ad_slot_completed` even though the live timer is
 * already idle by detach time. Drop-in for the activator's `dwell` dependency.
 */
export class SnapshottingDwellTimer extends DwellTimer {
  private lastElapsedAtCancel = 0;

  constructor(clock: DwellClock = systemDwellClock) {
    super(clock);
  }

  override cancel(): void {
    const live = this.elapsed();
    if (live !== null) this.lastElapsedAtCancel = live;
    super.cancel();
  }

  /** The dwell elapsed when the active slot was last cancelled (supersede). */
  elapsedAtSupersede(): number {
    return this.lastElapsedAtCancel;
  }
}

export interface MultiGameWithAdsAdapterDeps {
  template: MultiGameWithAdsTemplate;
  journal: RenderJournal;
  cardTransitions: CardTransitions;
  assetManifestStore: AssetManifestStore;
  adSlots: AdSlotResolver;
  /** SPEC-CRWDQ-S11 — real club crests in the with-ads grid. */
  crestResolver?: CrestResolver;
  /**
   * The shared timer for the `ad_slot_completed` dwell. When it is a
   * {@link SnapshottingDwellTimer} (the same instance the activator was
   * constructed with) the reported dwell is the real mid-slot elapsed; otherwise
   * the dwell falls back to 0 (a deployment with no snapshot wiring).
   */
  dwell?: SnapshottingDwellTimer;
}

/** Build the `multiple_games_with_ads` adapter for `registerTemplate`. */
export function makeMultiGameWithAdsAdapter(deps: MultiGameWithAdsAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount | null {
      const adSlot = resolveAdSlot(deps.adSlots, args.payload.ad_slot_id);
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        gameStateStore: args.gameStateStore,
        journal: deps.journal,
        cardTransitions: deps.cardTransitions,
        assetManifestStore: deps.assetManifestStore,
        adSlot,
        stateId: args.payload.state_id,
        dwellActualMs: () => deps.dwell?.elapsedAtSupersede() ?? 0,
        ...(deps.crestResolver ? { crestResolver: deps.crestResolver } : {}),
      });
      if (instance === null) return null;
      // Every rendered game gates per-game revisions through the activator (AC4).
      return { instance, subscribedGameIds: new Set(args.slot.game_ids) };
    },
  };
}

/** Drains a pending bar-preference apply for the next mount (D-GRH-73). */
export interface PendingTimezoneApply {
  takePending(): FixturesContext['pendingApply'];
}

export interface FixturesWithAdsAdapterDeps {
  template: FixturesWithAdsTemplate;
  journal: RenderJournal;
  cardTransitions: CardTransitions;
  assetManifestStore: AssetManifestStore;
  adSlots: AdSlotResolver;
  fixtureListStore: FixturesContext['fixtureListStore'];
  transitionExecutor: FixturesContext['transitionExecutor'];
  /** Bar-local IANA timezone for kickoff formatting (D-GRH-73). */
  timezone: string;
  /** Optional pending-preference source drained at mount (AC12 parity). */
  pendingApply?: PendingTimezoneApply;
  dwell?: SnapshottingDwellTimer;
}

/**
 * A transition spec the fixtures child runs against `.cdq-content` on mount;
 * the activator's own PlannedState-level transition already ran against the
 * host, so a `cut` keeps the child from double-animating the slot.
 */
const NOOP_TRANSITION = { animation_id: 'cut', duration_ms: 0 } as const;

/** Build the `fixtures_with_ads` adapter for `registerTemplate`. */
export function makeFixturesWithAdsAdapter(deps: FixturesWithAdsAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount | null {
      const adSlot = resolveAdSlot(deps.adSlots, args.payload.ad_slot_id);
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        timezone: deps.timezone,
        fixtureListStore: deps.fixtureListStore,
        assetManifestStore: deps.assetManifestStore,
        transitionExecutor: deps.transitionExecutor,
        transition: NOOP_TRANSITION,
        journal: deps.journal,
        cardTransitions: deps.cardTransitions,
        pendingApply: deps.pendingApply?.takePending() ?? null,
        adSlot,
        stateId: args.payload.state_id,
        dwellActualMs: () => deps.dwell?.elapsedAtSupersede() ?? 0,
      });
      if (instance === null) return null;
      // Fixtures subscribes to no games: no game_state_revision gates through.
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}

/** Resolve the AdSlot for a (possibly null) ad_slot_id; null when unresolved. */
function resolveAdSlot(adSlots: AdSlotResolver, adSlotId: string | null): AdSlotPayload | null {
  if (adSlotId === null) return null;
  return adSlots.resolve(adSlotId);
}
