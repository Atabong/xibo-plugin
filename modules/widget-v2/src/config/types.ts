/**
 * SPEC-CRWDQ-014 #27 — config-module local types.
 *
 * This module declares ONLY the consumer-side types: the inbound frame
 * alias, the handler outcome union, and the reject-reason enum. The wire
 * payload shapes (ConfigPushPayload, BarPreferencesWire, ThemeChoiceWire,
 * BusinessHourWire, BusinessMode, DayOfWeek, IntervalsWire) are owned by the
 * SPEC-CRWDQ-013 twin in the `wire/` barrel and imported from there — there
 * is no hand-rolled duplicate here (AC1).
 */
import type { BarPreferencesWire, ConfigPushPayload } from '../wire';

/**
 * What the WS dispatcher hands `ConfigPushHandler.handle`. The dispatcher
 * has already discriminated `message_type === 'ConfigPush'` at the envelope
 * layer, but the handler re-validates the full closed shape, so the frame is
 * typed as `unknown` at the boundary — the handler trusts nothing.
 */
export type ConfigPushFrame = unknown;

/** The four mutually-exclusive results of handling a ConfigPush frame. */
export type ConfigPushOutcome =
  | { kind: 'first_push'; preferences: BarPreferencesWire; configHash: string }
  | { kind: 'unchanged'; configHash: string }
  | { kind: 'replaced'; previousHash: string; configHash: string; evictedKeys: string[] }
  | { kind: 'rejected'; reason: ConfigRejectReason };

/**
 * Closed set of reasons a ConfigPush is rejected. `schema_invalid` covers
 * any missing/extra/mistyped field; the others are specific contract
 * violations the spec calls out by name.
 */
export type ConfigRejectReason =
  | 'schema_invalid'
  | 'theme_coupling_invalid'
  | 'timezone_invalid_iana'
  | 'config_hash_missing';

/** The persisted snapshot: the full payload plus its server-supplied hash. */
export interface PreferenceSnapshot {
  payload: ConfigPushPayload;
  configHash: string;
}
