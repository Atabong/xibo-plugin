/**
 * SPEC-CRWDQ-049 — MessagingLane overlay shared types.
 *
 * The overlay layer (D-GRH-57) renders transient, text-only messages on top of
 * the active `PlannedState` without reflow, keyed by `display_form`. These
 * types are the public surface shared by the store, the per-form render
 * primitive, and the overlay controller; the wire shape comes from the
 * SPEC-CRWDQ-017 barrel (`MessagingLanePayload`), not redefined here.
 */

/** The closed SPEC-CRWDQ-047 `display_form` enum. */
export const DISPLAY_FORMS = ['banner', 'ticker', 'toast'] as const;
export type DisplayForm = (typeof DISPLAY_FORMS)[number];

/**
 * A stored MessagingLane message. `lane_id` is the upsert key (D-GRH-57);
 * `receivedAt` is the local mount timestamp combined with `dwell_ms` to drive
 * the cycle. `text` is markup-free (SPEC-CRWDQ-047 rejects `<`, `>`, `&`) so it
 * renders as `textContent`.
 */
export interface MessagingLaneEntry {
  lane_id: string;
  text: string;
  display_form: DisplayForm;
  dwell_ms: number;
  valid_from: string;
  valid_until: string;
  receivedAt: Date;
}

/**
 * The read-only consumer view of the shared override-suppression token
 * (D-GRH-58). SPEC-CRWDQ-063 owns the writer (`setActive`); this overlay only
 * reads `isActive` and subscribes to flips.
 */
export interface OverrideSuppressionState {
  readonly isActive: boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

/** Closed set of overlay journal events this spec emits (D-GRH-29). */
export type OverlayJournalEventType =
  | 'messaging_lane_expired'
  | 'messaging_lane_resumed'
  | 'messaging_lane_expired_during_suppression'
  | 'schema_violation_received';

export interface OverlayJournalEntry {
  type: OverlayJournalEventType;
  /** Free-form decision metadata (lane_id, display_form, reason, …). */
  [key: string]: unknown;
}

/**
 * Minimal journal sink (system boundary — INV-FACTORY-17). Production binds the
 * shared player journal; tests bind an in-memory recorder (a real sink).
 */
export interface OverlayJournal {
  record(entry: OverlayJournalEntry): void;
}
