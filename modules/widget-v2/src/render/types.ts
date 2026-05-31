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
 *
 * `game_ids` is the ordered list a multi-card mode renders (D-GRH-14 order
 * preserved). The `single_game` template reads only `primary_game_id`; the
 * `multiple_games` template (SPEC-CRWDQ-031) renders one card per entry. A
 * single-game frame carries no list, normalized to `[]` by the resolver, so
 * the field is always present and never optional at the render layer.
 */
export interface ProgramSlotPayload {
  program_slot_id: string;
  primary_game_id: string | null;
  /** Ordered game ids the slot references (D-GRH-14); `[]` for single_game. */
  game_ids: readonly string[];
}

/**
 * The reconcilable view of a game's state (D-GRH-13 in-place revision). The
 * reconcile path carries the game id + the source `seq` of the revision; the
 * full renderable shape is the `GameState` the store already holds. Named
 * `GameStatePayload` to match the reconcile-event vocabulary; structurally a
 * `GameState` so the gate can read `game_id` without a second shape.
 */
export type GameStatePayload = GameState;

/**
 * The AdSlot payload (D-GRH-15/-16, SPEC-CRWDQ-041 + SPEC-CRWDQ-065). The
 * overlay-ad branch reads only the slot identity at this layer; the creative
 * resolution (asset cache, rotation, paint) is owned by SPEC-CRWDQ-065. `ad_ref`
 * is the phase-1 `asset_id` key into the AssetManifest. The field set mirrors
 * the SPEC-CRWDQ-065 `AdSlot` contract so the overlay seam binds to one shape.
 */
export interface AdSlotPayload {
  ad_slot_id: string;
  ad_class: string;
  ad_ref: string;
  ad_ref_type: 'asset_id';
  policy: Record<string, unknown>;
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
  /**
   * Referenced AdSlot id, or null when the state carries no ad (D-GRH-15). A
   * non-null id selects the overlay-ad branch: the activator mounts the bare
   * SingleGameTemplate content WITH an absolutely-positioned overlay above it
   * (SPEC-CRWDQ-065). `business_mode` stays `single_game` either way — there is
   * no separate `single_game_with_ads` member in the D-GRH-26 closed enum.
   */
  ad_slot_id: string | null;
  dwell_target_ms: number;
  transition: TransitionSpec;
  theme_id: string | null;
}
