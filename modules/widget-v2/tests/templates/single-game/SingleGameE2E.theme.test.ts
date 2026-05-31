/**
 * SPEC-CRWDQ-023 #37 — end-to-end theme resolution (spec activation flow step 5
 * + "Test cases": pending apply at boundary; theme per-slot / bar-fallthrough /
 * boot-default).
 *
 * ThemeResolver is unit-tested in isolation; here the three resolution outcomes
 * are pinned through the activated render so the rendered `data-theme` attribute
 * — the observable consequence — is what the assertions read. The boundary
 * theme swap re-resolves against the freshly-applied bar theme through the real
 * pending-apply drain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeE2E,
  plannedState,
  programSlot,
  prefsWithTheme,
  dataTheme,
  flush,
  FixedBarTheme,
} from './e2e-support';
import { THEME_ATTR_DEFAULT } from '../../../src/render/ThemeResolver';

const activate = async (
  h: ReturnType<typeof makeE2E>,
  over: Partial<Record<string, unknown>> = {},
): Promise<void> => {
  h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
  h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
  await h.dispatcher.dispatch(plannedState(over));
  await flush();
};

describe('single_game e2e — theme resolution at mount (Test case: theme per-slot/bar/default)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the per-state theme_id when the PlannedState carries one', async () => {
    const h = makeE2E(new FixedBarTheme({ state: 'set', id: 'bar-light' }));
    await activate(h, { theme_id: 'midnight' });
    // Per-state theme wins over the bar-wide theme.
    expect(dataTheme(h.host)).toBe('midnight');
  });

  it('falls through to the bar-wide theme when the PlannedState theme_id is null', async () => {
    const h = makeE2E(new FixedBarTheme({ state: 'set', id: 'bar-light' }));
    await activate(h, { theme_id: null });
    expect(dataTheme(h.host)).toBe('bar-light');
  });

  it('renders the boot-default theme when neither a per-state nor a bar theme is set', async () => {
    const h = makeE2E(new FixedBarTheme(null));
    await activate(h, { theme_id: null });
    expect(dataTheme(h.host)).toBe(THEME_ATTR_DEFAULT);
  });
});

describe('single_game e2e — pending preference apply at dwell boundary (Test case: pending apply)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('swaps the stylesheet + data-theme to the new bar theme only at the boundary', async () => {
    const h = makeE2E(new FixedBarTheme(null));
    await activate(h, { theme_id: null, dwell_target_ms: 2000 });
    expect(dataTheme(h.host)).toBe(THEME_ATTR_DEFAULT);

    h.pendingApply.queue(prefsWithTheme({ state: 'set', id: 'bar-dark' }));
    // Not yet applied — the boundary has not been reached.
    expect(h.styleSheets.applied).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);

    expect(h.styleSheets.applied).toEqual(['bar-dark']);
    expect(dataTheme(h.host)).toBe('bar-dark');
  });

  it('keeps a per-state theme_id at the boundary even when a bar-wide apply is pending', async () => {
    const h = makeE2E(new FixedBarTheme(null));
    await activate(h, { theme_id: 'midnight', dwell_target_ms: 2000 });

    h.pendingApply.queue(prefsWithTheme({ state: 'set', id: 'bar-dark' }));
    await vi.advanceTimersByTimeAsync(2000);

    // Per-state theme still wins; the stylesheet seam follows the resolved id.
    expect(dataTheme(h.host)).toBe('midnight');
    expect(h.styleSheets.applied).toEqual(['midnight']);
  });

  it('drains the pending slot so a second boundary sees nothing pending', async () => {
    const h = makeE2E(new FixedBarTheme(null));
    await activate(h, { theme_id: null, dwell_target_ms: 1000 });
    h.pendingApply.queue(prefsWithTheme({ state: 'set', id: 'bar-dark' }));

    await vi.advanceTimersByTimeAsync(1000); // first boundary consumes the apply
    expect(h.styleSheets.applied).toEqual(['bar-dark']);

    // Re-arm by activating a new state, reach its boundary: no second swap.
    h.dispatcher.dispatch(programSlot('slot-2', 'g1'));
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2', dwell_target_ms: 1000 }));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.styleSheets.applied).toEqual(['bar-dark']);
  });
});
