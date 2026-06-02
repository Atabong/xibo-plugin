/**
 * SPEC-CRWDQ-063 — override-handling journal types (D-GRH-29).
 *
 * The override module owns its own narrow journal event union so its event
 * types stay a closed, reviewable set without coupling to the transport,
 * config, render, or overlay journals. Production binds the shared player
 * journal sink; tests bind an in-memory recorder (a real sink, not a mock —
 * INV-FACTORY-17 treats the journal as a system boundary).
 */

/** Closed set of override-handling journal events this spec emits. */
export type OverrideJournalEventType =
  | 'override_activated'
  | 'override_resolved'
  | 'override_expired_on_arrival'
  | 'override_indefinite'
  | 'override_suppressed_lower_precedence'
  // D-GRH-76: a canned-overlay render failure is a player-runtime safe —
  // journal-only, never patron-visible.
  | 'override_render_error';

export interface OverrideJournalEntry {
  type: OverrideJournalEventType;
  /** Free-form decision metadata (override_id, override_class, resolved_by, …). */
  [key: string]: unknown;
}

export interface OverrideJournal {
  record(entry: OverrideJournalEntry): void;
}
