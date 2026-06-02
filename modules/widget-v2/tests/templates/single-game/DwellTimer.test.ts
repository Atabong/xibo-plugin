import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';

// Time is the system boundary (INV-FACTORY-17): the DEFAULT system clock is
// exercised against vitest fake timers, which fake both `setTimeout` and
// `Date.now`, so the timer seam under test is the production one.
describe('DwellTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onBoundary after the elapsed wall-clock with actualDwellMs within +-1ms', () => {
    const timer = new DwellTimer(systemDwellClock);
    let actual: number | null = null;
    timer.arm(30_000, (ms) => {
      actual = ms;
    });
    vi.advanceTimersByTime(30_000);
    expect(actual).not.toBeNull();
    expect(Math.abs((actual as unknown as number) - 30_000)).toBeLessThanOrEqual(1);
  });

  it('does not fire before the dwell target elapses', () => {
    const timer = new DwellTimer(systemDwellClock);
    let fired = false;
    timer.arm(30_000, () => {
      fired = true;
    });
    vi.advanceTimersByTime(29_999);
    expect(fired).toBe(false);
  });

  it('does not fire after cancel()', () => {
    const timer = new DwellTimer(systemDwellClock);
    let fired = false;
    timer.arm(30_000, () => {
      fired = true;
    });
    timer.cancel();
    vi.advanceTimersByTime(60_000);
    expect(fired).toBe(false);
  });

  it('replaces the prior schedule on re-arm so only the latest boundary fires', () => {
    const timer = new DwellTimer(systemDwellClock);
    const fired: string[] = [];
    timer.arm(30_000, () => fired.push('first'));
    timer.arm(10_000, () => fired.push('second'));
    vi.advanceTimersByTime(30_000);
    expect(fired).toEqual(['second']);
  });

  it('treats a non-positive dwell target as infinite: no boundary is armed (SPEC-CRWDQ-052)', () => {
    const timer = new DwellTimer(systemDwellClock);
    let fired = false;
    // The SPEC-CRWDQ-052 synthetic safe state arms dwell_target_ms:0 = infinite;
    // the player-fallback panel must stay mounted until recovery, never timing out.
    timer.arm(0, () => {
      fired = true;
    });
    vi.advanceTimersByTime(60 * 60_000);
    expect(fired).toBe(false);
    // An infinite arm reports no live elapsed (nothing is scheduled).
    expect(timer.elapsed()).toBeNull();
  });

  it('reports live elapsed while armed and null when idle', () => {
    const timer = new DwellTimer(systemDwellClock);
    expect(timer.elapsed()).toBeNull();
    timer.arm(30_000, () => {});
    vi.advanceTimersByTime(12_000);
    expect(timer.elapsed()).toBe(12_000);
  });
});
