/**
 * SPEC-CRWDQ-084 — the continuously-advancing local game clock.
 *
 * Proves: the football minute advances between server frames; a server frame
 * re-syncs (server wins); it pauses at HT/FT/pre_game; it respects the measured
 * replay speed; and a non-football sport passes period_clock through verbatim.
 */
import { describe, it, expect } from 'vitest';
import { GameClock, type ClockTimer } from '../../../src/templates/single-game/GameClock';
import type { GameState } from '../../../src/render/types';

/** A controllable timer: `advance(ms)` moves wall time + fires due intervals. */
function fakeTimer(): ClockTimer & { advance: (ms: number) => void } {
  let now = 0;
  const intervals: Array<{ fn: () => void; ms: number; next: number }> = [];
  return {
    now: () => now,
    setInterval: (fn, ms) => {
      const entry = { fn, ms, next: now + ms };
      intervals.push(entry);
      return entry;
    },
    clearInterval: (h) => {
      const i = intervals.indexOf(h as { fn: () => void; ms: number; next: number });
      if (i >= 0) intervals.splice(i, 1);
    },
    advance: (ms: number) => {
      const target = now + ms;
      // Fire each interval at its scheduled boundaries.
      let guard = 0;
      while (guard++ < 100000) {
        const due = intervals
          .filter((e) => e.next <= target)
          .sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.fn();
      }
      now = target;
    },
  };
}

function fb(periodClock: string, detail?: Record<string, unknown>, status?: string): GameState {
  return {
    game_id: 'g',
    seq: 1,
    ...(status ? { status } : {}),
    sport_context: { sport: 'football', period_clock: periodClock, ...(detail ? { detail } : {}) },
  };
}

describe('GameClock — football minute ticks between frames', () => {
  it('advances the displayed minute forward while running', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    const views: string[] = [];
    clock.start((v) => views.push(v.periodClock));

    // Two calibration frames 1s apart: 30' then 31' → rate 1 min / 1000ms.
    clock.sync(fb("30'", { half: '1H', minute: 30 }));
    t.advance(1000);
    clock.sync(fb("31'", { half: '1H', minute: 31 }));

    // Now tick forward 2s with NO new frame — the minute must climb past 31'.
    t.advance(2000);
    const v = clock.current();
    expect(v.minute).toBeGreaterThanOrEqual(32);
    expect(v.periodClock).toMatch(/^\d+'/);
    expect(v.running).toBe(true);
  });

  it('re-syncs to the server frame (server always wins)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync(fb("30'", { half: '1H', minute: 30 }));
    t.advance(5000); // local clock would have drifted forward
    // A server frame snaps it back to the authoritative 33'.
    clock.sync(fb("33'", { half: '1H', minute: 33 }));
    expect(clock.current().minute).toBe(33);
  });

  it('pauses at HALF TIME (does not advance)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync(fb('HT', { half: 'HT' }, 'halftime'));
    const before = clock.current().periodClock;
    t.advance(10000);
    expect(clock.current().periodClock).toBe('HT');
    expect(clock.current().running).toBe(false);
    expect(before).toBe('HT');
  });

  it('stops at FULL TIME', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync(fb('FT', undefined, 'final'));
    t.advance(10000);
    expect(clock.current().running).toBe(false);
    expect(clock.current().periodClock).toBe('FT');
  });

  it('does not advance before kickoff (pre_game)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync(fb('PRE', undefined, 'pre_game'));
    t.advance(10000);
    expect(clock.current().running).toBe(false);
  });

  it('respects a SLOW replay speed (small minute advance per wall-second)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    // Calibrate: 1 game-minute per 4000ms wall → slow replay.
    clock.sync(fb("10'", { half: '1H', minute: 10 }));
    t.advance(4000);
    clock.sync(fb("11'", { half: '1H', minute: 11 }));
    t.advance(4000); // ~1 more minute should accrue, not 4
    const v = clock.current();
    expect(v.minute).toBeGreaterThanOrEqual(11);
    expect(v.minute).toBeLessThanOrEqual(13);
  });

  it('clamps to the half ceiling and grows stoppage past 45 (1H)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync(fb("44'", { half: '1H', minute: 44 }));
    t.advance(1000);
    clock.sync(fb("45'", { half: '1H', minute: 45 })); // rate 1/1000
    t.advance(3000); // would be 48' but 1H ceils at 45 → 45+stoppage
    const v = clock.current();
    expect(v.minute).toBe(45);
    expect(v.stoppage).toBeGreaterThanOrEqual(1);
    expect(v.periodClock).toMatch(/45\+\d+'/);
  });

  it('passes a non-football sport period_clock through verbatim (no interpolation)', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    clock.start(() => {});
    clock.sync({
      game_id: 'b',
      seq: 1,
      sport_context: { sport: 'baseball', period_clock: 'TOP 5 1 OUT', detail: { inning: 5, half: 'top' } },
    });
    t.advance(10000);
    expect(clock.current().periodClock).toBe('TOP 5 1 OUT');
  });

  it('advances the pulse every tick so dependents can animate liveness', () => {
    const t = fakeTimer();
    const clock = new GameClock(t);
    const pulses: number[] = [];
    clock.start((v) => pulses.push(v.pulse));
    clock.sync(fb("10'", { half: '1H', minute: 10 }));
    t.advance(2000); // ~4 ticks at 500ms
    expect(new Set(pulses).size).toBeGreaterThan(1);
  });
});
