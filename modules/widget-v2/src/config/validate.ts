/**
 * SPEC-CRWDQ-014 #27 — ConfigPush closed-shape validator (D-GRH-73).
 *
 * `validateConfigPush` takes a raw frame (`unknown`) and either returns the
 * payload narrowed to {@link ConfigPushPayload}, or a {@link ConfigRejectReason}.
 * It NEVER throws: every malformation maps to a reason. The validation is
 * closed-shape — exactly the expected keys, no more, no fewer — because a
 * surplus key is as much a contract drift as a missing one (D-GRH-73).
 *
 * Reason precedence is deliberate so the handler's reported reason is
 * stable and testable:
 *   1. `config_hash_missing` — checked before anything else inside the
 *      validated subset (the server hash is canonical; AC6).
 *   2. `theme_coupling_invalid` — a structurally-valid theme discriminant
 *      whose id/state pairing violates D-GRH-51 (AC4).
 *   3. `timezone_invalid_iana` — a string timezone that `Intl` rejects (AC5).
 *   4. `schema_invalid` — everything else: wrong top-level keys, wrong
 *      preferences keys, wrong types, bad enum members, bad HH:MM (AC3/AC5).
 */
import {
  BUSINESS_MODES,
  DAYS_OF_WEEK,
  type BarPreferencesWire,
  type BusinessHourWire,
  type BusinessMode,
  type ConfigPushPayload,
  type DayOfWeek,
  type IntervalsWire,
  type ThemeChoiceWire,
} from '../wire';
import type { ConfigRejectReason } from './types';

/** Discriminated validator result — narrow the payload or carry a reason. */
export type ValidationResult =
  | { ok: true; payload: ConfigPushPayload }
  | { ok: false; reason: ConfigRejectReason };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The four top-level fields the validated payload subset must carry (AC3). */
const PAYLOAD_KEYS = ['preferences', 'config_hash', 'cache_ceiling_bytes', 'intervals'] as const;

/** The ten BarPreferencesWire fields, exactly (AC3). */
const PREFERENCE_KEYS = [
  'theme',
  'sports',
  'leagues',
  'region',
  'state',
  'city',
  'timezone',
  'business_hours',
  'local_team_list',
  'fallback_mode_order',
] as const;

// D-GRH-75 — `intervals` is a closed set of exactly three integer-ms cadences.
const INTERVAL_KEYS = ['journal_sync_ms', 'heartbeat_ms', 'manifest_recheck_ms'] as const;
const BUSINESS_HOUR_KEYS = ['day_of_week', 'open_local', 'close_local'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((e) => typeof e === 'string');

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** True iff `obj` has exactly the keys in `keys` — no missing, no extra. */
const hasExactKeys = (obj: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(obj);
  if (actual.length !== keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
};

const isValidIana = (tz: string): boolean => {
  try {
    // `Intl.DateTimeFormat` throws RangeError for an unknown IANA zone.
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate the theme discriminant structurally, then check D-GRH-51 coupling.
 * Returns `'schema'` for a structurally-broken theme, `'coupling'` for a
 * structurally-valid discriminant with an illegal id/state pairing, or `null`
 * when the theme is fully valid.
 */
const checkTheme = (v: unknown): 'schema' | 'coupling' | null => {
  if (!isRecord(v) || typeof v['state'] !== 'string') return 'schema';
  const state = v['state'];
  const hasId = Object.prototype.hasOwnProperty.call(v, 'id');

  if (state === 'set') {
    // Exactly { state, id } with a non-empty string id.
    if (!hasExactKeys(v, ['state', 'id'])) return 'schema';
    if (typeof v['id'] !== 'string') return 'schema';
    if (v['id'].length === 0) return 'coupling';
    return null;
  }

  if (state === 'default' || state === 'unset') {
    // Exactly { state }; an id present is a coupling violation.
    if (hasId) return 'coupling';
    if (!hasExactKeys(v, ['state'])) return 'schema';
    return null;
  }

  return 'schema';
};

const isBusinessHour = (v: unknown): v is BusinessHourWire => {
  if (!isRecord(v) || !hasExactKeys(v, BUSINESS_HOUR_KEYS)) return false;
  const day = v['day_of_week'];
  if (typeof day !== 'string' || !(DAYS_OF_WEEK as readonly string[]).includes(day)) return false;
  if (typeof v['open_local'] !== 'string' || !HHMM.test(v['open_local'])) return false;
  if (typeof v['close_local'] !== 'string' || !HHMM.test(v['close_local'])) return false;
  return true;
};

const isIntervals = (v: unknown): v is IntervalsWire => {
  if (!isRecord(v) || !hasExactKeys(v, INTERVAL_KEYS)) return false;
  return (
    typeof v['journal_sync_ms'] === 'number' &&
    typeof v['heartbeat_ms'] === 'number' &&
    typeof v['manifest_recheck_ms'] === 'number'
  );
};

export function validateConfigPush(frame: unknown): ValidationResult {
  const invalid = (reason: ConfigRejectReason): ValidationResult => ({ ok: false, reason });

  if (!isRecord(frame)) return invalid('schema_invalid');

  // Envelope discriminant + metadata. message_type/schema_version/ts/bar_id/
  // display_id are envelope fields (NOT inside the validated preferences
  // subset). They must still be well-formed for the payload to be sane.
  if (frame['message_type'] !== 'ConfigPush') return invalid('schema_invalid');
  if (frame['schema_version'] !== 1) return invalid('schema_invalid');
  if (typeof frame['ts'] !== 'string') return invalid('schema_invalid');
  if (typeof frame['bar_id'] !== 'string') return invalid('schema_invalid');
  if (!isStringOrNull(frame['display_id'])) return invalid('schema_invalid');

  // AC6 — config_hash absent/empty rejects first, before deeper validation.
  const configHash = frame['config_hash'];
  if (typeof configHash !== 'string' || configHash.length === 0) {
    return invalid('config_hash_missing');
  }

  // AC3 — the validated subset carries EXACTLY {preferences, config_hash,
  // cache_ceiling_bytes, intervals} plus the envelope discriminant set above.
  const expectedTopKeys = [
    'message_type',
    'schema_version',
    'ts',
    'bar_id',
    'display_id',
    ...PAYLOAD_KEYS,
  ];
  if (!hasExactKeys(frame, expectedTopKeys)) return invalid('schema_invalid');

  if (typeof frame['cache_ceiling_bytes'] !== 'number') return invalid('schema_invalid');
  if (!isIntervals(frame['intervals'])) return invalid('schema_invalid');

  const prefs = frame['preferences'];
  if (!isRecord(prefs) || !hasExactKeys(prefs, PREFERENCE_KEYS)) return invalid('schema_invalid');

  // AC4 — theme three-state + coupling. Coupling violations outrank the
  // generic schema reason so the handler reports the specific contract break.
  const themeResult = checkTheme(prefs['theme']);
  if (themeResult === 'coupling') return invalid('theme_coupling_invalid');
  if (themeResult === 'schema') return invalid('schema_invalid');

  if (!isStringArray(prefs['sports'])) return invalid('schema_invalid');
  if (!isStringArray(prefs['leagues'])) return invalid('schema_invalid');
  if (!isStringOrNull(prefs['region'])) return invalid('schema_invalid');
  if (!isStringOrNull(prefs['state'])) return invalid('schema_invalid');
  if (!isStringOrNull(prefs['city'])) return invalid('schema_invalid');
  if (!isStringArray(prefs['local_team_list'])) return invalid('schema_invalid');

  // fallback_mode_order[] ∈ BusinessMode (AC5).
  const fallback = prefs['fallback_mode_order'];
  if (
    !Array.isArray(fallback) ||
    !fallback.every((m) => typeof m === 'string' && (BUSINESS_MODES as readonly string[]).includes(m))
  ) {
    return invalid('schema_invalid');
  }

  // business_hours[] structural + enum + HH:MM (AC5).
  const hours = prefs['business_hours'];
  if (!Array.isArray(hours) || !hours.every(isBusinessHour)) return invalid('schema_invalid');

  // timezone — must be a string AND a real IANA zone (AC5).
  const tz = prefs['timezone'];
  if (typeof tz !== 'string') return invalid('schema_invalid');
  if (!isValidIana(tz)) return invalid('timezone_invalid_iana');

  // All checks passed — the frame structurally IS a ConfigPushPayload.
  // Re-narrow each branch we touched so the cast is sound.
  const theme = prefs['theme'] as ThemeChoiceWire;
  const fallbackModeOrder = fallback as BusinessMode[];
  const businessHours = hours as BusinessHourWire[];
  const dayOk: DayOfWeek[] = businessHours.map((h) => h.day_of_week);
  void dayOk; // touched purely to keep DayOfWeek in the type graph

  const preferences: BarPreferencesWire = {
    theme,
    sports: prefs['sports'],
    leagues: prefs['leagues'],
    region: prefs['region'],
    state: prefs['state'],
    city: prefs['city'],
    timezone: tz,
    business_hours: businessHours,
    local_team_list: prefs['local_team_list'],
    fallback_mode_order: fallbackModeOrder,
  };

  const payload: ConfigPushPayload = {
    message_type: 'ConfigPush',
    schema_version: 1,
    ts: frame['ts'],
    bar_id: frame['bar_id'],
    display_id: frame['display_id'],
    preferences,
    cache_ceiling_bytes: frame['cache_ceiling_bytes'],
    intervals: frame['intervals'],
    config_hash: configHash,
  };

  return { ok: true, payload };
}
