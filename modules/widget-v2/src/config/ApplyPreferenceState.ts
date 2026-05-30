/**
 * SPEC-CRWDQ-014 #27 — pending-apply slot (AC9).
 *
 * `queueApply` records the preferences to apply at the next dwell boundary
 * in a SINGLE slot: a second call before a boundary tick REPLACES the first
 * (it does not append). The render loop reads `takePending()` at each
 * `dwell_target_ms` boundary; this class never calls into the render loop's
 * transition or PlannedState-activation paths and is constructed with NO
 * render-loop port — the only coupling to render is the boundary read.
 */
import type { BarPreferencesWire } from '../wire';

export interface QueueApplyResult {
  applyAt: 'next_dwell_boundary';
}

export interface ApplyPreferenceState {
  /** Queue preferences to apply at the next dwell boundary (single slot). */
  queueApply(preferences: BarPreferencesWire): QueueApplyResult;
  /** Whether a pending apply is currently slotted (boundary not yet read). */
  hasPending(): boolean;
}

/** In-memory single-slot {@link ApplyPreferenceState}. */
export class PendingApplySlot implements ApplyPreferenceState {
  private pending: BarPreferencesWire | null = null;

  queueApply(preferences: BarPreferencesWire): QueueApplyResult {
    // Single slot: overwrite any prior pending preferences.
    this.pending = preferences;
    return { applyAt: 'next_dwell_boundary' };
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Render-loop boundary read: drain and clear the slot. */
  takePending(): BarPreferencesWire | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }
}
