/**
 * SPEC-CRWDQ-031 — the `multiple_games` adapter that plugs the grid template
 * into the shared `PlannedStateActivator` (AC8/AC9/AC10).
 *
 * The activator owns the whole lifecycle — buffering a PlannedState until its
 * ProgramSlot arrives (AC8), running the PlannedState-level transition, arming
 * + owning the dwell, the supersede flow (cancel dwell, outgoing transition,
 * `detach()`), the dwell-boundary theme swap (AC10), and serialized reconcile
 * dispatch. This adapter contributes ONLY the mode-specific mount: it builds the
 * `MultiGameContext` from the activator's mount args and reports the set of
 * games the grid subscribes to (every `game_id`, so per-game revisions gate
 * through, AC4). A declined mount (out-of-range card count, AC2) propagates as
 * `null` — the template has already journaled `template_input_invalid`.
 *
 * Register with `activator.registerTemplate('multiple_games', makeMultiGameAdapter(...))`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateAdapter } from '../../render/PlannedStateActivator';
import { MultiGameTemplate } from './MultiGameTemplate';
import type { CardTransitions } from './CardSet';

export interface MultiGameAdapterDeps {
  template: MultiGameTemplate;
  journal: RenderJournal;
  /** Card-level animation seam; the activator-level executor is separate. */
  cardTransitions: CardTransitions;
}

/** Build the `multiple_games` adapter for `PlannedStateActivator.registerTemplate`. */
export function makeMultiGameAdapter(deps: MultiGameAdapterDeps): TemplateAdapter {
  return {
    mount(args) {
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        gameStateStore: args.gameStateStore,
        journal: deps.journal,
        cardTransitions: deps.cardTransitions,
      });
      if (instance === null) return null;
      // Every rendered game gates per-game revisions through the activator (AC4).
      return { instance, subscribedGameIds: new Set(args.slot.game_ids) };
    },
  };
}
