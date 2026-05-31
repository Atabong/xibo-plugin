/**
 * SPEC-CRWDQ-061 — the fixed fine-grained → bucket mapping (AC3).
 *
 * The backend `player_journal` ingest validates `event_type` against a CLOSED
 * six-member set (the PLAYER_JOURNAL_EVENT_TYPES widget twin). The widget,
 * however, emits MANY fine-grained internal events (the D-GRH-29 catalogue:
 * `planned_state_activated`, `dwell_boundary_reached`, `config_push_received`,
 * etc., plus per-spec extensions). This table collapses each fine-grained name
 * to the one bucket the backend accepts; the fine name is preserved in
 * `payload.event` so no fidelity is lost server-side (backend filters/aggregates
 * on `payload.event` per D-GRH-29).
 *
 * DERIVED, NOT SPEC-PINNED: SPEC-CRWDQ-061.md does not define an explicit
 * fine→bucket table (its prose describes only the fine-grained catalogue and an
 * HTTP transport that D-GRH-75 + the issue ACs superseded with the WS path).
 * This mapping is therefore PLAYER-INTERNAL and derived from the obvious
 * semantic grouping of the D-GRH-29 events onto the six backend buckets. Only
 * the resulting `event_type` is a backend-validated contract (AC4); the mapping
 * itself can change without a backend coordination as long as it lands on one
 * of the six. Unknown / unlisted fine names fall back to {@link DEFAULT_BUCKET}
 * so emit can never produce an out-of-set `event_type`.
 */
import type { PlayerJournalEventType } from './types';

/**
 * Fallback bucket for a fine-grained name not in {@link FINE_TO_BUCKET}.
 * `template_fallback` is the conservative choice: an unrecognized event is
 * most likely a new render-path or degraded-mode signal, and it can never be
 * rejected by the backend (it is one of the six).
 */
export const DEFAULT_BUCKET: PlayerJournalEventType = 'template_fallback';

/**
 * The closed mapping. Grouping rationale:
 *  - planned_state_render — PlannedState activation + any per-state render.
 *  - dwell_timing — dwell-boundary / actual-vs-target timing signals.
 *  - transition_error — transition execution faults + catalogue misses.
 *  - template_fallback — fallback enter/exit, render fallbacks, buffer timeouts.
 *  - config_apply — a ConfigPush that was accepted + applied.
 *  - heartbeat_ack — heartbeat liveness acknowledgements / mismatches.
 */
export const FINE_TO_BUCKET: Readonly<Record<string, PlayerJournalEventType>> = {
  // planned_state_render
  planned_state_activated: 'planned_state_render',
  ad_slot_rendered: 'planned_state_render',
  multi_game_reconciled: 'planned_state_render',
  program_slot_rendered: 'planned_state_render',
  override_received: 'planned_state_render',

  // dwell_timing
  dwell_boundary_reached: 'dwell_timing',
  dwell_overrun: 'dwell_timing',

  // transition_error
  transition_error: 'transition_error',
  transition_catalog_miss: 'transition_error',

  // template_fallback
  template_render_fallback: 'template_fallback',
  fallback_entered: 'template_fallback',
  fallback_exited: 'template_fallback',
  template_buffer_timeout: 'template_fallback',

  // config_apply
  config_push_received: 'config_apply',
  config_applied: 'config_apply',

  // heartbeat_ack
  heartbeat_ack: 'heartbeat_ack',
  heartbeat_mismatch: 'heartbeat_ack',
};

/** Map a fine-grained internal event name to its closed-set bucket (AC3). */
export function bucketFor(internalEvent: string): PlayerJournalEventType {
  return FINE_TO_BUCKET[internalEvent] ?? DEFAULT_BUCKET;
}
