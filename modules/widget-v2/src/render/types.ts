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
  /**
   * SPEC-CRWDQ-S13 (D-GRH-78) — the REAL backend-computed excitement scalar
   * (0–100) the broadcast meter renders. Present on every live GameState +
   * re-push GameState, and re-stamped on a GameEvent so it SPIKES the instant a
   * goal lands. When absent (an older backend / a pure twin frame) the template
   * falls back to its derived proxy.
   */
  excitement?: number;
  /** SPEC-CRWDQ-S13 — signed momentum lean [-100,100], +home / −away. */
  momentum?: number;
  /**
   * SPEC-CRWDQ-084 — the sport-specific DETAIL block the rich single_game panel
   * renders (football half/clock + possession/shots; baseball line score +
   * inning/half + count + bases). Additive + optional; an open record at the
   * render layer so the per-sport detail renderer narrows it. Absent on a thin
   * frame / an older backend → the panel renders nothing (the shell still shows).
   */
  detail?: Record<string, unknown>;
}

/**
 * SPEC-CRWDQ-084 — one ordered entry in a game's event timeline (the match
 * history the rich single_game DETAIL panel renders). Mirrors the backend wire
 * `GameTimelineEntry`. Sport-neutral: football goal|card|sub|var|penalty,
 * baseball inning|score. Additive + optional on `GameState.timeline`.
 */
export interface GameTimelineEntry {
  seq: number;
  clock?: string;
  kind: string;
  team?: 'home' | 'away';
  player?: string;
  detail?: string;
}

/**
 * SPEC-CRWDQ-084 — football (soccer) sport-detail the FootballDetail panel reads.
 */
export interface FootballDetail {
  half?: '1H' | 'HT' | '2H' | 'ET' | 'PEN';
  minute?: number;
  stoppage?: number;
  possession?: { home: number; away: number };
  shots?: { home: number; away: number };
}

/** SPEC-CRWDQ-084 — one inning column in the baseball line score. */
export interface BaseballLineScoreEntry {
  inning: number;
  home: number | null;
  away: number | null;
}

/** SPEC-CRWDQ-084 — baseball sport-detail the BaseballDetail panel reads. */
export interface BaseballDetail {
  inning?: number;
  half?: 'top' | 'bottom' | 'mid' | 'end';
  balls?: number;
  strikes?: number;
  outs?: number;
  bases?: { first: boolean; second: boolean; third: boolean };
  lineScore?: BaseballLineScoreEntry[];
  hits?: { home: number; away: number };
  errors?: { home: number; away: number };
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
  /**
   * Lifecycle status of the game on the wire (SPEC-CRWDQ-045 / -017
   * `GameStatePayload`). The recap template (SPEC-CRWDQ-046) reads
   * `status === "final"` from its in-memory state to confirm the game has
   * concluded; absent on a still-live game. Optional at the render layer
   * because not every feed snapshot carries it before the final flip.
   */
  status?: string;
  sport_context?: SportContext;
  /** Last notable moment text; the overlay renders only when non-empty. */
  last_moment?: string;
  /**
   * SPEC-CRWDQ-084 — the ordered event timeline (match history) the rich
   * single_game DETAIL panel renders. Additive + optional; the full snapshot is
   * monotonic so every frame carries the cumulative history. Absent on an older
   * backend / a thin frame.
   */
  timeline?: GameTimelineEntry[];
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
 * future `multiple_games` template (SPEC-CRWDQ-031) renders one card per entry.
 * It is OPTIONAL at this layer so the single-game resolver and the
 * empty/synthetic slot literals (safe_info, ambient) need not restate `[]`.
 */
export interface ProgramSlotPayload {
  program_slot_id: string;
  primary_game_id: string | null;
  /**
   * Ordered game ids the slot references (D-GRH-14). The resolver normalizes it
   * to `[]` for single_game / safe / ambient so a resolved payload always
   * carries the list; the `multiple_games` template (SPEC-CRWDQ-031) renders
   * one card per entry.
   */
  game_ids: readonly string[];
  /**
   * Ordered `eventId`s a `fixtures` slot references (SPEC-CRWDQ-034 / -033),
   * kickoff ascending and capped at `maxFixturesShown`. The resolver normalizes
   * it to `[]` for non-fixtures modes, so a resolved payload always carries the
   * list. The members are canonical `event_id`s (not `game_id`s). Optional on
   * the type only so the single/multi-game literals that predate the fixtures
   * mode (and the SPEC-CRWDQ-031/-066 test payloads) need not restate `[]`;
   * every consumer reads it as `?? []`.
   */
  fixture_ids?: readonly string[];
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
