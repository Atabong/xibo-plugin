import { describe, it, expect } from 'vitest';
import { WritableOverrideSuppressionState } from '../../src/overrides/OverrideSuppressionState';

describe('WritableOverrideSuppressionState', () => {
  it('starts inactive', () => {
    expect(new WritableOverrideSuppressionState().isActive).toBe(false);
  });

  it('reflects setActive in isActive', () => {
    const s = new WritableOverrideSuppressionState();
    s.setActive(true);
    expect(s.isActive).toBe(true);
    s.setActive(false);
    expect(s.isActive).toBe(false);
  });

  it('notifies subscribers synchronously on a state change', () => {
    const s = new WritableOverrideSuppressionState();
    const seen: boolean[] = [];
    s.subscribe((active) => seen.push(active));
    s.setActive(true);
    s.setActive(false);
    expect(seen).toEqual([true, false]);
  });

  it('does not notify when the value is unchanged (no flap)', () => {
    const s = new WritableOverrideSuppressionState();
    const seen: boolean[] = [];
    s.subscribe((active) => seen.push(active));
    s.setActive(true);
    s.setActive(true);
    expect(seen).toEqual([true]);
  });

  it('stops notifying after unsubscribe', () => {
    const s = new WritableOverrideSuppressionState();
    const seen: boolean[] = [];
    const unsub = s.subscribe((active) => seen.push(active));
    s.setActive(true);
    unsub();
    s.setActive(false);
    expect(seen).toEqual([true]);
  });
});
