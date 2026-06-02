/**
 * SPEC-CRWDQ-063 — override module barrel.
 *
 * The single import surface for the OverrideInjection handler and its
 * collaborators: the writable suppression token (writer of the SPEC-CRWDQ-049
 * read view), the self-contained canned-overlay renderer, the class→treatment
 * map, and the override journal types.
 */
export {
  OverrideInjectionHandler,
  type OverrideInjectionHandlerDeps,
  type OverlayRendererLike,
} from './OverrideInjectionHandler';
export { WritableOverrideSuppressionState } from './OverrideSuppressionState';
export { OverrideOverlayRenderer } from './OverrideOverlayRenderer';
export {
  OVERRIDE_CLASS_TREATMENT,
  type OverrideTreatment,
  type OverrideVisualForm,
} from './overrideClassTreatment';
export {
  type OverrideJournal,
  type OverrideJournalEntry,
  type OverrideJournalEventType,
} from './types';
