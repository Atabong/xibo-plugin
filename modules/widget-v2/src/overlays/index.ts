/**
 * SPEC-CRWDQ-049 — MessagingLane overlay module barrel.
 *
 * The single import surface for the overlay layer: the controller, the store,
 * the per-form DOM primitive, and the shared types (including the read-only
 * `OverrideSuppressionState` view that SPEC-CRWDQ-063 will write).
 */
export { MessagingLaneOverlay, type MessagingLaneOverlayContext } from './MessagingLaneOverlay';
export { MessagingLaneStore } from './MessagingLaneStore';
export { OverlayLayer } from './OverlayLayer';
export {
  DISPLAY_FORMS,
  type DisplayForm,
  type MessagingLaneEntry,
  type OverlayJournal,
  type OverlayJournalEntry,
  type OverlayJournalEventType,
  type OverrideSuppressionState,
} from './types';
