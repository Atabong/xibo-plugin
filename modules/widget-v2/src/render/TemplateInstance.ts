/**
 * SPEC-CRWDQ-023 (part 2) — the shared template-instance contract every
 * business-mode template returns from its `mount(...)`, plus the in-place
 * reconcile event the activator dispatches to it.
 *
 * `TemplateInstance` is the supersede + reconcile surface. `detach()` is
 * mandatory (the supersede path always needs the outgoing DOM node).
 * `reconcile?` is OPTIONAL (AC3): a template opts in to in-place revision
 * (D-GRH-13) only when it has sub-element transitions to run; the bare
 * `single_game` instance does NOT implement it (the documented expected case),
 * so the activator must treat an absent hook as "not implemented" and journal
 * `template_reconcile_skipped` rather than crashing.
 *
 * `TemplateReconcileEvent` is the closed, three-kind discriminated union the
 * activator routes after its active-state gate matches (AC4):
 *
 *   - `program_slot`        — the active slot's `ProgramSlot` was revised
 *                             in place (same `program_slot_id`, e.g. a new
 *                             `primary_game_id`).
 *   - `ad_slot`             — the active state's `AdSlot` was revised in place.
 *   - `game_state_revision` — a subscribed game's `GameState` advanced.
 *
 * The reconcile contract (AC5): a `reconcile?` implementation MUST NOT remount
 * its host, MUST NOT re-run the PlannedState-level `TransitionExecutor`, and
 * MUST NOT reset the `DwellTimer` (mid-slot dwell is sacrosanct, D-GRH-13). It
 * MAY run player-internal sub-element transitions and resolves the returned
 * Promise once those settle; the activator serializes subsequent reconciles
 * behind that promise so two revisions never animate the same host at once.
 */
import type { AdSlotPayload, GameStatePayload, ProgramSlotPayload } from './types';

/** The active slot's ProgramSlot was revised in place (D-GRH-13). */
export interface ProgramSlotReconcile {
  kind: 'program_slot';
  slot: ProgramSlotPayload;
}

/** The active state's AdSlot was revised in place. */
export interface AdSlotReconcile {
  kind: 'ad_slot';
  adSlot: AdSlotPayload;
}

/** A subscribed game's GameState advanced to a new revision. */
export interface GameStateReconcile {
  kind: 'game_state_revision';
  gameState: GameStatePayload;
}

/** The closed three-kind reconcile union the activator dispatches (AC3). */
export type TemplateReconcileEvent =
  | ProgramSlotReconcile
  | AdSlotReconcile
  | GameStateReconcile;

/**
 * The contract every template's `mount(...)` returns. `detach()` unsubscribes
 * and hands back the outgoing DOM node for the supersede transition;
 * `reconcile?` is the optional in-place revision hook (AC3/AC5).
 */
export interface TemplateInstance {
  /** Unsubscribe and return the DOM node for the outgoing transition. */
  detach(): HTMLElement;
  /**
   * Apply an in-place revision WITHOUT remount/transition/dwell reset (AC5).
   * Resolves once any player-internal sub-element transitions settle. Absent
   * on templates that have no sub-element transitions (the bare single_game
   * instance) — the activator treats that as `hook_not_implemented` (AC4).
   */
  reconcile?(event: TemplateReconcileEvent): Promise<void>;
}
