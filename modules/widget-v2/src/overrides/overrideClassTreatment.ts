/**
 * SPEC-CRWDQ-063 — phase-1 `override_class` → canned-overlay treatment map.
 *
 * Each override class maps to a fixed visual treatment with BUNDLED copy
 * (generic/canned — NOT operator text; the operator's `text` is never on the
 * wire in phase-1). When a non-null `payload_ref` is delivered in a future
 * schema bump (D-GRH-56), the resolved content REPLACES `cannedCopy`; phase-1
 * always uses `cannedCopy`.
 *
 * `visualPriority` ranks intra-overlay rendering only (which fullscreen card
 * wins if two were ever co-rendered). The live active-slot selection is
 * governed by wire `precedence` in the handler (see Supersede), not by this
 * ranking.
 */
import type { OverrideClass } from '../wire/types';

export type OverrideVisualForm = 'fullscreen' | 'top-banner';

export interface OverrideTreatment {
  form: OverrideVisualForm;
  /** Higher = stronger visual priority within a single rendered overlay. */
  visualPriority: number;
  cannedCopy: string;
}

export const OVERRIDE_CLASS_TREATMENT: Record<OverrideClass, OverrideTreatment> = {
  emergency_safety: {
    form: 'fullscreen',
    visualPriority: 3,
    cannedCopy: 'Important safety notice. Please follow staff instructions.',
  },
  system_maintenance: {
    form: 'fullscreen',
    visualPriority: 2,
    cannedCopy: 'Display temporarily unavailable for maintenance.',
  },
  scoreboard_correction: {
    form: 'top-banner',
    visualPriority: 1,
    cannedCopy: 'Scoreboard under review',
  },
  operator_alert: {
    form: 'top-banner',
    visualPriority: 0,
    cannedCopy: 'Notice',
  },
};
