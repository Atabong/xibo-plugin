/**
 * SPEC-CRWDQ-023 #37 — end-to-end seq ordering + transition fallback
 * (spec "Test cases": out-of-order GameEvent, transition catalog miss).
 *
 * Both are covered at the unit level by GameStateStore / TransitionExecutor;
 * here they are exercised through the activated render pipeline so the visible
 * DOM consequence (no stale paint; mount still happens) is pinned end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeE2E, plannedState, programSlot, rootCount, text, flush, TESTID } from './e2e-support';

describe('single_game e2e — out-of-order GameEvent (Test case: seq regression)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a regressed event so the rendered score keeps the latest applied value', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await flush();

    h.store.applyEvent({ game_id: 'g1', seq: 5, home_score: 5 });
    expect(text(h.host, TESTID.homeTeam)).toContain('5');

    // seq 3 regresses past the applied seq 5 — dropped, DOM unchanged.
    h.store.applyEvent({ game_id: 'g1', seq: 3, home_score: 99 });

    expect(text(h.host, TESTID.homeTeam)).toContain('5');
    expect(text(h.host, TESTID.homeTeam)).not.toContain('99');
  });

  it('journals game_event_seq_regression for the dropped event', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await flush();

    h.store.applyEvent({ game_id: 'g1', seq: 5, home_score: 5 });
    h.store.applyEvent({ game_id: 'g1', seq: 3, home_score: 99 });

    const regressions = h.journal.typesOf('game_event_seq_regression');
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ game_id: 'g1', seq: 3, last_applied_seq: 5 });
  });
});

describe('single_game e2e — transition catalog miss (Test case: catalog miss)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('still mounts the template when the PlannedState transition misses the catalog', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(
      plannedState({ transition: { animation_id: 'nonexistent', duration_ms: 200 } }),
    );
    await flush();

    expect(rootCount(h.host)).toBe(1);
    expect(text(h.host, TESTID.homeTeam)).toContain('Lions');
  });

  it('journals transition_catalog_miss for the unknown animation_id', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(
      plannedState({ transition: { animation_id: 'nonexistent', duration_ms: 200 } }),
    );
    await flush();

    const misses = h.journal.typesOf('transition_catalog_miss');
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({ animation_id: 'nonexistent' });
  });
});
