/**
 * SPEC-CRWDQ-023 — render-orchestration domain shapes.
 *
 * The SPEC-CRWDQ-017 wire barrel exports the *frames* (`PlannedStateFrame`,
 * `ProgramSlotFrame`, `GameStateFrame`, `GameEventFrame`) only as permissive
 * envelopes discriminated on `message_type`; per the barrel's own contract the
 * per-type *payload* schema is owned by the consuming handler (here:
 * `templates/single-game` + the render orchestration). So this spec owns the
 * payload shapes the template family reads — `ProgramSlotPayload`,
 * `GameState`, `GameEvent`, `PlannedStatePayload`, `SportContext` — in ONE
 * place, exactly as SPEC-CRWDQ-064 owns `AssetManifestPayload`.
 *
 * These are the SHARED render shapes every downstream template (multi-game,
 * fixtures, recap, ads, safe, ambient) reuses without re-deriving.
 */
import type { BusinessMode } from '../wire';

/**
 * Sport-context block (D-GRH-09 fixed per-sport schema). Every field is
 * optional at the render layer: a snapshot may carry only what the source
 * sport feed provides, and the template renders an empty header when absent.
 */
export interface SportContext {
  sport?: string;
  league?: string;
  venue?: string;
  /** Period / quarter / inning + game clock, pre-formatted for display. */
  period_clock?: string;
}

/**
 * A game's current renderable state. The `single_game` template reads home /
 * away score, the period clock from `sport_context`, and the last notable
 * moment. The store keeps the highest `seq` seen per game (D-GRH-49 ordering).
 */
export interface GameState {
  game_id: string;
  /** Highest applied source `seq`. A full snapshot resets the baseline. */
  seq: number;
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  sport_context?: SportContext;
  /** Last notable moment text; the overlay renders only when non-empty. */
  last_moment?: string;
}

/**
 * A full game snapshot (D-GRH-49). Structurally a complete `GameState`: it is
 * always applied and resets the per-game seq baseline (AC6). Modelled as an
 * alias rather than a distinct shape because a snapshot IS the full state.
 */
export type GameStateSnapshot = GameState;

/**
 * A per-field delta against the current `GameState` (D-GRH-12 multiplexed
 * stream). Only the fields present on the event are applied; `seq` orders the
 * deltas and a regression is dropped (AC6).
 */
export interface GameEvent {
  game_id: string;
  seq: number;
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  sport_context?: SportContext;
  last_moment?: string;
}

/**
 * The ProgramSlot payload (D-GRH-21). `primary_game_id` is the SINGLE source
 * of the rendered game id — the `PlannedState` carries no `game_id` field
 * post-D-GRH-21 (AC7). `null` means the slot references no live game.
 */
export interface ProgramSlotPayload {
  program_slot_id: string;
  primary_game_id: string | null;
}

/** Named-animation transition reference (D-GRH-50 flat catalog name). */
export interface TransitionSpec {
  animation_id: string;
  duration_ms: number;
}

/**
 * The PlannedState payload the activator reads (D-GRH-30 + D-GRH-50). Carries
 * the business mode, the referenced ProgramSlot, the dwell budget, the named
 * transition, and an optional per-state theme override (`theme_id` is
 * `string | null` on the wire per SPEC-CRWDQ-017; the resolved three-state
 * `ResolvedTheme` is the widget's resolution OUTPUT, not this wire field).
 */
export interface PlannedStatePayload {
  state_id: string;
  business_mode: BusinessMode;
  program_slot_id: string | null;
  dwell_target_ms: number;
  transition: TransitionSpec;
  theme_id: string | null;
}
