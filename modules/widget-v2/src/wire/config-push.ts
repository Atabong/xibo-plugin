/**
 * SPEC-CRWDQ-014 — widget-side twin of the SPEC-CRWDQ-013 ConfigPush wire
 * contract (the producer is `crowdaq-backend/src/admin/configpush/types.ts`
 * + `crowdaq-backend/src/domain/barpref/closed-enums.ts`). The shapes here
 * are mirrored verbatim from that backend contract — snake_case JSON field
 * names preserved — not invented client-side. Drift between the backend
 * source and this twin is a SPEC-CRWDQ-013 concern; this file is the swap
 * point when SPEC-CRWDQ-017 ships a generated barrel.
 *
 * NOTE: the SPEC-CRWDQ-014 markdown's inline type block is the stale old
 * shape (theme_id string, lowercase mon..sun, start_local/end_local). The
 * canonical shape is THIS one — the SPEC-013 producer contract.
 */

/**
 * BusinessMode — nine-member closed union (D-GRH-26). Order is semantic:
 * it is the canonical priority order used in `fallback_mode_order`.
 */
export type BusinessMode =
  | 'single_game'
  | 'multiple_games'
  | 'multiple_games_with_ads'
  | 'fixtures'
  | 'fixtures_with_live_game'
  | 'fixtures_with_ads'
  | 'recap'
  | 'safe_info'
  | 'ambient';

/** Every `BusinessMode` member, for runtime membership checks. */
export const BUSINESS_MODES: readonly BusinessMode[] = [
  'single_game',
  'multiple_games',
  'multiple_games_with_ads',
  'fixtures',
  'fixtures_with_live_game',
  'fixtures_with_ads',
  'recap',
  'safe_info',
  'ambient',
] as const;

/** DayOfWeek — UPPERCASE MON..SUN; index order is the config-hash sort order. */
export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

/** Every `DayOfWeek` member, for runtime membership checks. */
export const DAYS_OF_WEEK: readonly DayOfWeek[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const;

/**
 * Theme three-state discriminated union (D-GRH-51). `set` carries a theme
 * id; `default` and `unset` carry none. The widget issue #27 AC1 names this
 * `ThemeChoiceWire`; the backend names the same shape `ThemeWire` — both
 * are exported here.
 */
export type ThemeChoiceWire =
  | { state: 'set'; id: string }
  | { state: 'default' }
  | { state: 'unset' };

/** Backend-name alias for {@link ThemeChoiceWire}. */
export type ThemeWire = ThemeChoiceWire;

/** A single business-hours row. `open_local`/`close_local` are HH:MM 24h. */
export interface BusinessHourWire {
  day_of_week: DayOfWeek;
  open_local: string;
  close_local: string;
}

/**
 * The snake_case BarPreferences subset carried on the wire (D-GRH-73).
 * EXACTLY 10 fields — row metadata (bar_id, config_hash, timestamps) is
 * lifted into envelope fields and MUST NOT appear here.
 */
export interface BarPreferencesWire {
  theme: ThemeChoiceWire;
  sports: string[];
  leagues: string[];
  region: string | null;
  state: string | null;
  city: string | null;
  timezone: string;
  business_hours: BusinessHourWire[];
  local_team_list: string[];
  fallback_mode_order: BusinessMode[];
}

/**
 * System interval config carried alongside preferences (D-GRH-75). A closed
 * set of exactly three integer-millisecond cadences the backend tunes without
 * redeploying the player: `journal_sync_ms`, `heartbeat_ms`,
 * `manifest_recheck_ms`. Adding a field requires a D-GRH amendment.
 */
export interface IntervalsWire {
  journal_sync_ms: number;
  heartbeat_ms: number;
  manifest_recheck_ms: number;
}

/**
 * The full ConfigPush control-channel payload (D-GRH-60 + D-GRH-73). The
 * `message_type` / `schema_version` / `ts` / `bar_id` / `display_id` fields
 * are envelope metadata; `preferences` is the validated snapshot subset.
 */
export interface ConfigPushPayload {
  message_type: 'ConfigPush';
  schema_version: 1;
  ts: string;
  bar_id: string;
  display_id: string | null;
  preferences: BarPreferencesWire;
  cache_ceiling_bytes: number;
  intervals: IntervalsWire;
  config_hash: string;
}
