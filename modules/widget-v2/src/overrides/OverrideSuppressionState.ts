/**
 * SPEC-CRWDQ-063 — the writable override-suppression token (D-GRH-58).
 *
 * The shared "is an override currently active" flag. SPEC-CRWDQ-049 consumes
 * the read-only view (`isActive`, `subscribe`) on the overlay layer; this spec
 * is the WRITER — the {@link OverrideInjectionHandler} flips it via
 * `setActive`. The read-only view interface (`OverrideSuppressionState`) is
 * owned by SPEC-CRWDQ-049 (`overlays/types.ts`); this module provides the
 * single concrete implementation that satisfies both the reader contract and
 * the writer method.
 *
 * One instance is constructed at boot and threaded into both the handler
 * (writer) and the `MessagingLaneOverlay` context (reader). No global
 * singleton. Listeners fire SYNCHRONOUSLY on a value change so SPEC-CRWDQ-049's
 * overlay flips `data-suppressed` in the same tick as activation (D-GRH-58
 * binary suppression). A no-op set (same value) fires nothing — this is what
 * keeps suppression from flapping to `false` across a precedence supersede.
 */
import type { OverrideSuppressionState } from '../overlays/types';

export class WritableOverrideSuppressionState implements OverrideSuppressionState {
  private active = false;
  private readonly listeners = new Set<(active: boolean) => void>();

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Set the suppression flag. Fires every subscriber synchronously, but only
   * when the value actually changes — a redundant set is a no-op so a supersede
   * (which never wants suppression to drop) produces no flap.
   */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    for (const listener of this.listeners) listener(active);
  }

  subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
