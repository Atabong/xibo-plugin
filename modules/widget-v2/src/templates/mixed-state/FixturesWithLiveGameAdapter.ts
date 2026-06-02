/**
 * SPEC-CRWDQ-066 (part 2) — the `fixtures_with_live_game` adapter that plugs the
 * mixed-state composite into the SHARED `PlannedStateActivator` (the SAME
 * orchestration single_game / multiple_games / fixtures / with-ads use, never a
 * forked activator — INV-FACTORY-19).
 *
 * The activator owns the whole lifecycle: it BUFFERS the composite PlannedState
 * until its `ProgramSlot` arrives (the 5 s `template_buffer_timeout` +
 * fall-through path, exactly as for every other mode), runs the
 * PlannedState-level transition once against the host, arms + owns the dwell,
 * and on supersede cancels the dwell + runs the outgoing transition + calls the
 * composite `detach()`. This adapter contributes ONLY the mode-specific mount.
 *
 * `subscribedGameIds` is EMPTY: like the bare `fixtures` mode, the promoted
 * tile's per-event `GameState` deltas reach it through the live tile's OWN
 * `GameStateStore` subscription, not the activator's `game_state_revision`
 * reconcile path — so that kind gates as a silent no-op (the composite's
 * `reconcile` ignores it too). The `program_slot` reconcile gates on the slot
 * id the activator already tracks, so the D-GRH-13 re-promotion still routes
 * through the shared dispatch.
 *
 * Register with
 * `activator.registerTemplate('fixtures_with_live_game', makeFixturesWithLiveGameAdapter(...))`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { GameStateStore } from '../../render/GameStateStore';
import type { CardTransitions } from '../multi-game/CardSet';
import type { PendingPreferenceApply } from '../fixtures/FixturesTemplate';
import { FixturesWithLiveGameTemplate } from './FixturesWithLiveGameTemplate';

/** Drains a pending bar-preference apply for the next mount (D-GRH-73 timezone). */
export interface PendingTimezoneApply {
  takePending(): PendingPreferenceApply | null;
}

export interface FixturesWithLiveGameAdapterDeps {
  template: FixturesWithLiveGameTemplate;
  journal: RenderJournal;
  /** Card-level animation seam for the static set; the activator-level executor is separate. */
  cardTransitions: CardTransitions;
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  /**
   * The live tile's GameState source. Optional: when omitted the adapter uses
   * the activator's shared `gameStateStore` (the same instance), so a typical
   * deployment need not pass it.
   */
  gameStateStore?: GameStateStore;
  /** Bar-local IANA timezone for the static tiles' kickoff times (D-GRH-73). */
  timezone: string;
  /** Optional pending-preference source drained at mount (AC12 parity). */
  pendingApply?: PendingTimezoneApply;
}

/** Build the `fixtures_with_live_game` adapter for `registerTemplate`. */
export function makeFixturesWithLiveGameAdapter(
  deps: FixturesWithLiveGameAdapterDeps,
): TemplateAdapter {
  return {
    mount(args): TemplateMount | null {
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        timezone: deps.timezone,
        fixtureListStore: deps.fixtureListStore,
        assetManifestStore: deps.assetManifestStore,
        gameStateStore: deps.gameStateStore ?? args.gameStateStore,
        journal: deps.journal,
        cardTransitions: deps.cardTransitions,
        pendingApply: deps.pendingApply?.takePending() ?? null,
      });
      if (instance === null) return null;
      // The promoted tile drives itself off the GameStateStore subscription; no
      // game_state_revision gates through to the reconcile hook (it is a no-op).
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}
