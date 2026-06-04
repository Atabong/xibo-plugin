/**
 * SPEC-CRWDQ-023 — per-slot dwell timer (D-GRH-50, AC10).
 *
 * A one-shot wall-clock timer. `arm(dwellTargetMs, onBoundary)` schedules
 * `onBoundary` to fire after `dwellTargetMs` have elapsed; the callback
 * receives the ACTUAL elapsed wall-clock (now − armTime), which in tests under
 * a frozen clock matches the target within ±1 ms. `cancel()` clears a pending
 * schedule; re-arming replaces any prior schedule (the activator re-arms on
 * each PlannedState activation). `elapsed()` reports the live elapsed ms while
 * armed, or null when idle.
 *
 * Time is a system boundary (INV-FACTORY-17): the clock + timer scheduling are
 * injected via {@link DwellClock} so tests drive vitest fake timers; production
 * binds the default global-timer / `Date.now` clock.
 */
export interface DwellClock {
  now(): number;
  setTimer(handler: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

/** Default clock: `Date.now` + global `setTimeout` / `clearTimeout`. */
export const systemDwellClock: DwellClock = {
  now: () => Date.now(),
  setTimer: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface ArmedState {
  handle: unknown;
  armedAt: number;
}

export class DwellTimer {
  private armed: ArmedState | null = null;

  constructor(private readonly clock: DwellClock = systemDwellClock) {}

  /**
   * Arm a one-shot boundary. Replaces any prior schedule (the prior boundary
   * never fires). `onBoundary` receives the actual elapsed wall-clock at fire.
   *
   * A non-positive `dwellTargetMs` (`<= 0`) means INFINITE dwell (SPEC-CRWDQ-052
   * synthetic safe state + SPEC-CRWDQ-053 ambient): no boundary is ever armed —
   * the render stays until the activator supersedes it with a new PlannedState.
   */
  arm(dwellTargetMs: number, onBoundary: (actualDwellMs: number) => void): void {
    this.cancel();
    if (dwellTargetMs <= 0) {
      return;
    }
    const armedAt = this.clock.now();
    const handle = this.clock.setTimer(() => {
      // The schedule has fired; clear armed BEFORE the callback so a re-arm
      // from within onBoundary establishes a fresh schedule cleanly.
      this.armed = null;
      onBoundary(this.clock.now() - armedAt);
    }, dwellTargetMs);
    this.armed = { handle, armedAt };
  }

  /** Cancel a pending boundary; no-op if not armed. */
  cancel(): void {
    if (this.armed) {
      this.clock.clearTimer(this.armed.handle);
      this.armed = null;
    }
  }

  /** Live elapsed ms in the active dwell, or null if not armed. */
  elapsed(): number | null {
    if (!this.armed) return null;
    return this.clock.now() - this.armed.armedAt;
  }
}
