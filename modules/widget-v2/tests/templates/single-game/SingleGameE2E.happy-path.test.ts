/**
 * SPEC-CRWDQ-023 #37 — end-to-end happy path (spec "Test cases" #1).
 *
 * Exercises the full activation flow through the REAL FrameDispatcher with all
 * real render modules wired together: ProgramSlot then PlannedState{single_game}
 * then GameState arrivals -> the DOM contains home/away/score, the live
 * subscription fires on a subsequent GameEvent, and the DOM re-renders in place
 * WITHOUT a second transition (spec activation flow step 7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeE2E, plannedState, programSlot, rootCount, text, flush, TESTID } from './e2e-support';

describe('single_game e2e — happy path activation (Test case #1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the score block from the in-store snapshot when slot then state arrive', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({
      game_id: 'g1',
      seq: 1,
      home_team: 'Lions',
      away_team: 'Bears',
      home_score: 2,
      away_score: 1,
      sport_context: { sport: 'soccer', period_clock: "45'" },
    });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await flush();

    expect(rootCount(h.host)).toBe(1);
    expect(text(h.host, TESTID.homeTeam)).toContain('Lions');
    expect(text(h.host, TESTID.homeTeam)).toContain('2');
    expect(text(h.host, TESTID.awayTeam)).toContain('Bears');
    expect(text(h.host, TESTID.clock)).toBe("45'");
  });

  it('re-renders the score in place on a later GameEvent without a second transition', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 2 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await flush();
    const transitionsAfterMount = h.player.played.length;

    // A live delta arrives on the multiplexed stream after activation.
    h.store.applyEvent({ game_id: 'g1', seq: 2, home_score: 3 });

    expect(text(h.host, TESTID.homeTeam)).toContain('3');
    // No transition runs on a per-event update — only on a PlannedState swap.
    expect(h.player.played.length).toBe(transitionsAfterMount);
  });

  it('surfaces the last-moment overlay only once a moment event lands', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', last_moment: '' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await flush();
    const overlay = h.host.querySelector(`[data-testid="${TESTID.overlay}"]`) as HTMLElement;
    expect(overlay.hidden).toBe(true);

    h.store.applyEvent({ game_id: 'g1', seq: 2, last_moment: 'GOAL! Lions 3-1' });

    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toBe('GOAL! Lions 3-1');
  });
});
