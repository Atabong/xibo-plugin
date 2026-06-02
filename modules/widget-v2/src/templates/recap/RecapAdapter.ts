/**
 * SPEC-CRWDQ-046 (part 2) — the `recap` adapter that plugs the post-game recap
 * template into the SHARED SPEC-CRWDQ-023 `PlannedStateActivator`, the SAME
 * orchestration single_game / multiple_games / fixtures use — never a forked
 * activator (INV-FACTORY-19).
 *
 * The activator owns the whole lifecycle: buffering a `PlannedState` until its
 * `ProgramSlot` arrives (the re-push order path), running the PlannedState-level
 * transition once against the host, arming + owning the dwell, the dwell-boundary
 * theme swap (the shared SPEC-CRWDQ-023 pending-apply contract), the supersede
 * flow (cancel dwell, outgoing transition, `detach()`), and the serialized
 * reconcile dispatch through the active-slot gate. This adapter contributes ONLY
 * the mode-specific mount: it builds the `RecapContext` from the activator's
 * mount args + the closured recap deps, and reports an EMPTY set of subscribed
 * games.
 *
 * Recap is the FROZEN closing image (D-GRH-68): it reads a one-shot `GameState`
 * snapshot at mount and holds NO `GameStateStore` subscription, so
 * `subscribedGameIds` is empty and no `game_state_revision` ever gates through
 * to the instance's `reconcile` hook from the activator's per-game gate. A late
 * same-game revision reaching the instance directly is journaled
 * `recap_late_event` and does NOT mutate the DOM (the part-1 instance contract).
 *
 * Because `RecapContext` needs two inputs the activator's `TemplateMountArgs`
 * does not carry — the single SPEC-CRWDQ-045 `HeadlineMoment` render-hint and
 * the SPEC-CRWDQ-023 pending-preference apply — the adapter drains both from
 * optional one-shot sources at mount, mirroring the fixtures adapter's
 * `takePending()` seam. Both are omitted on a deployment with no such plumbing;
 * the activator's own dwell-boundary theme path stays independent of them.
 *
 * Register with `activator.registerTemplate('recap', makeRecapAdapter(...))`.
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import {
  RecapTemplate,
  type HeadlineMoment,
  type PendingPreferenceApply,
} from './RecapTemplate';

/**
 * Drains the single backend-supplied headline moment for the next recap mount
 * (SPEC-CRWDQ-045 render-hint). The moment is carried on the recap `PlannedState`
 * out of band of the activator's `TemplateMountArgs`, so the deployment supplies
 * a one-shot source the adapter consumes once at mount.
 */
export interface HeadlineMomentSource {
  takeHeadlineMoment(): HeadlineMoment | null;
}

/** Drains a pending-preference apply for the next recap mount (SPEC-CRWDQ-023). */
export interface PendingRecapApply {
  takePending(): PendingPreferenceApply | null;
}

export interface RecapAdapterDeps {
  template: RecapTemplate;
  journal: RenderJournal;
  /**
   * The player's cached FixtureList (SPEC-CRWDQ-034); recap team identity is
   * joined from here by `event_id` — `GameState` carries no team fields.
   */
  fixtureListStore: FixtureListStore;
  /** Consumed from SPEC-CRWDQ-064; this adapter neither defines nor creates it. */
  assetManifestStore: AssetManifestStore;
  /**
   * Optional source of the single SPEC-CRWDQ-045 headline moment, drained once
   * per mount. Omitted on a deployment that authors no recap moments; the recap
   * then omits the moment block (graceful, part-1 contract).
   */
  headlineMoment?: HeadlineMomentSource;
  /**
   * Optional pending-preference source drained at mount. Omitted on a deployment
   * with no preference plumbing; the activator's own dwell-boundary theme path
   * is independent.
   */
  pendingApply?: PendingRecapApply;
}

/** Build the `recap` adapter for `PlannedStateActivator.registerTemplate`. */
export function makeRecapAdapter(deps: RecapAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount | null {
      const instance = deps.template.mount(args.host, {
        programSlot: args.slot,
        theme: args.theme,
        gameStateStore: args.gameStateStore,
        fixtureListStore: deps.fixtureListStore,
        assetManifestStore: deps.assetManifestStore,
        headlineMoment: deps.headlineMoment?.takeHeadlineMoment() ?? null,
        pendingApply: deps.pendingApply?.takePending() ?? null,
        journal: deps.journal,
      });
      // The template declined (null `primary_game_id` -> `template_input_invalid`,
      // or a `GameState` cache miss -> `recap_no_gamestate`): both fall through to
      // safe. The template has already journaled why; the activator renders nothing.
      if (instance === null) return null;
      // Recap is the frozen closing image: it subscribes to NO games, so no
      // `game_state_revision` ever gates through the activator to its reconcile
      // hook — `detach()` has nothing to unwind.
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}
