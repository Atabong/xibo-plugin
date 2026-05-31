/**
 * SPEC-CRWDQ-023 #37 — end-to-end render lifecycle (spec "Test cases":
 * supersede, idempotent re-activation, re-push order edge).
 *
 * The activator's unit tests prove the mount/detach mechanics; these pin the
 * end-to-end consequences through the real dispatcher pipeline: after a
 * supersede the OLD game's live subscription is gone (its events no longer
 * paint), an idempotent re-push arms exactly one dwell, and a ProgramSlot that
 * arrives only AFTER the 5 s buffer window does not retroactively double-mount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeE2E, plannedState, programSlot, rootCount, text, flush, TESTID } from './e2e-support';

describe('single_game e2e — supersede (Test case: supersede)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the new slot and leaves exactly one section after a new state_id', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Tigers' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlot('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState());
    await flush();
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2' }));
    await flush();

    expect(rootCount(h.host)).toBe(1);
    expect(text(h.host, TESTID.homeTeam)).toContain('Tigers');
  });

  it('removes the superseded slot\'s live subscription so the old game stops painting', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 1 });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Tigers', home_score: 0 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlot('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState());
    await flush();
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2' }));
    await flush();

    // A late event for the OLD game must not mutate the now-mounted new slot.
    h.store.applyEvent({ game_id: 'g1', seq: 2, home_score: 99 });

    expect(text(h.host, TESTID.homeTeam)).toContain('Tigers');
    expect(text(h.host, TESTID.homeTeam)).not.toContain('99');
  });

  it('runs an outgoing transition on supersede (incoming + outgoing + incoming)', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlot('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState());
    await flush();
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2' }));
    await flush();

    // First mount transition, the outgoing fade, then the second mount transition.
    expect(h.player.played).toHaveLength(3);
  });
});

describe('single_game e2e — idempotent re-activation (Test case: idempotent re-activation)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms exactly one dwell so a repeated state_id yields one dwell_boundary_reached', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 1000 }));
    await flush();
    // Re-push the identical state — a no-op (no re-arm, no second mount).
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 1000 }));
    await flush();

    await vi.advanceTimersByTimeAsync(1000);

    expect(rootCount(h.host)).toBe(1);
    expect(h.player.played).toHaveLength(1);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });
});

describe('single_game e2e — re-push buffer window (Test case: re-push order edge)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts when the ProgramSlot arrives within the 5 s buffer window', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    await h.dispatcher.dispatch(plannedState());
    await flush();
    expect(rootCount(h.host)).toBe(0); // buffered

    await vi.advanceTimersByTimeAsync(4000); // still inside the window
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await flush();

    expect(rootCount(h.host)).toBe(1);
    expect(h.journal.typesOf('template_buffer_timeout')).toHaveLength(0);
  });

  it('falls through to the placeholder on timeout and does not double-mount on a late slot', async () => {
    const h = makeE2E();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    await h.dispatcher.dispatch(plannedState());

    await vi.advanceTimersByTimeAsync(5000); // window elapses -> fallthrough
    expect(h.journal.typesOf('template_buffer_timeout')).toHaveLength(1);
    expect(h.host.querySelector(`[data-testid="${TESTID.placeholder}"]`)).not.toBeNull();

    // The slot arrives LATE (after the window). It must not resurrect the buffer.
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await flush();

    // Still exactly one (placeholder) section — no second mount with live score.
    expect(rootCount(h.host)).toBe(1);
    expect(h.host.querySelector(`[data-testid="${TESTID.placeholder}"]`)).not.toBeNull();
    expect(text(h.host, TESTID.homeTeam)).not.toContain('Lions');
  });
});
