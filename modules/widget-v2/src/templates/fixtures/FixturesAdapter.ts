/**
 * SPEC-CRWDQ-034 (part 2) — the `fixtures` adapter that plugs the catalog
 * template into the shared `PlannedStateActivator` (the SAME orchestration
 * single_game and multiple_games use, never a forked activator).
 *
 * The activator owns the whole lifecycle: buffering a PlannedState until its
 * ProgramSlot arrives (the re-push order path), running the PlannedState-level
 * transition once against the host, arming + owning the dwell, the supersede
 * flow (cancel dwell, outgoing transition, `detach()`), and serialized
 * reconcile dispatch through the active-slot gate. This adapter contributes
 * ONLY the mode-specific mount: it builds the `FixturesContext` from the
 * activator's mount args + the closured fixtures deps, and reports an EMPTY set
 * of subscribed games — fixtures is the pre-game catalog and never subscribes
 * to `GameState`, so no `game_state_revision` ever gates through (AC: no
 * GameState subscription; AC11 ad_slot / game_state_revision are no-ops).
 *
 * Because the activator already runs `payload.transition` before calling
 * `mount`, the adapter hands the template a NO-OP transition executor: the
 * single PlannedState-level transition is the activator's, never double-run by
 * the template. The card-level `card_slide_in` / `card_slide_out` animations
 * (the {@link CardTransitions} seam) are unaffected — they run only inside
 * `reconcile`.
 *
 * Register with `activator.registerTemplate('fixtures', makeFixturesAdapter(...))`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { TransitionExecutor } from '../../render/TransitionExecutor';
import type { TransitionSpec } from '../../render/types';
import type { CardTransitions } from '../multi-game/CardSet';
import { FixturesTemplate, type PendingPreferenceApply } from './FixturesTemplate';

/** Drains a pending bar-preference apply for the next mount (D-GRH-73 timezone). */
export interface PendingTimezoneApply {
  takePending(): PendingPreferenceApply | null;
}

export interface FixturesAdapterDeps {
  template: FixturesTemplate;
  journal: RenderJournal;
  /** Card-level animation seam; the activator-level executor is separate. */
  cardTransitions: CardTransitions;
  fixtureListStore: FixtureListStore;
  /** Consumed from SPEC-CRWDQ-064; this adapter neither defines nor creates it. */
  assetManifestStore: AssetManifestStore;
  /** Bar-local IANA timezone for kickoff formatting (D-GRH-73). */
  timezone: string;
  /**
   * Optional pending-preference source drained at mount (a new bar `timezone`
   * re-formats every card immediately, AC12). Omitted on a deployment with no
   * preference plumbing; the activator's own dwell-boundary theme path is
   * independent.
   */
  pendingApply?: PendingTimezoneApply;
}

/**
 * A transition executor that plays nothing. The activator already runs the
 * PlannedState-level transition against the host before `mount`; this keeps the
 * template from double-running it while still satisfying the required ctx field.
 */
const noopTransitionExecutor: Pick<TransitionExecutor, 'run'> = {
  async run(): Promise<void> {},
};

/** A transition spec the no-op executor ignores (the activator owns the real one). */
const NOOP_TRANSITION: TransitionSpec = { animation_id: 'cut', duration_ms: 0 };

/** Build the `fixtures` adapter for `PlannedStateActivator.registerTemplate`. */
export function makeFixturesAdapter(deps: FixturesAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount | null {
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        timezone: deps.timezone,
        fixtureListStore: deps.fixtureListStore,
        assetManifestStore: deps.assetManifestStore,
        transitionExecutor: noopTransitionExecutor as TransitionExecutor,
        transition: NOOP_TRANSITION,
        journal: deps.journal,
        cardTransitions: deps.cardTransitions,
        pendingApply: deps.pendingApply?.takePending() ?? null,
      });
      if (instance === null) return null;
      // Fixtures is the pre-game catalog: it subscribes to NO games, so no
      // game_state_revision ever gates through to its reconcile hook (AC11).
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}
