import { describe, it, expect } from 'vitest';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import type { Fixture, FixtureListFrameTyped } from '../../../src/templates/fixtures/types';

const fixture = (eventId: string, over: Partial<Fixture> = {}): Fixture => ({
  eventId,
  sport: 'football',
  leagueId: 39,
  leagueName: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoffUtc: '2026-06-01T19:30:00Z',
  feedStatus: 'scheduled',
  ...over,
});

const frame = (fixtures: Fixture[]): FixtureListFrameTyped =>
  ({ message_type: 'FixtureList', payload: { fixtures } }) as FixtureListFrameTyped;

describe('FixtureListStore.applyList + resolve', () => {
  it('resolves a fixture by eventId after applyList', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA'), fixture('eB')]));
    expect(store.resolve('eA')).toMatchObject({ eventId: 'eA' });
    expect(store.resolve('eB')).toMatchObject({ eventId: 'eB' });
  });

  it('returns null for an eventId not in the current cached set', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA')]));
    expect(store.resolve('eGHOST')).toBeNull();
  });

  it('REPLACES the cached set on a new list (D-GRH-18), not merge', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA'), fixture('eB')]));
    store.applyList(frame([fixture('eB'), fixture('eC')]));
    expect(store.resolve('eA')).toBeNull();
    expect(store.resolve('eB')).toMatchObject({ eventId: 'eB' });
    expect(store.resolve('eC')).toMatchObject({ eventId: 'eC' });
  });
});

describe('FixtureListStore.subscribe', () => {
  it('fires the listener with the new fixture when its entry changes on re-push', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA', { feedStatus: 'scheduled' })]));
    const seen: Fixture[] = [];
    store.subscribe('eA', (f) => seen.push(f));

    store.applyList(frame([fixture('eA', { feedStatus: 'live' })]));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.feedStatus).toBe('live');
  });

  it('does not fire when the re-pushed entry is byte-identical', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA')]));
    const seen: Fixture[] = [];
    store.subscribe('eA', (f) => seen.push(f));
    store.applyList(frame([fixture('eA')]));
    expect(seen).toHaveLength(0);
  });

  it('does not fire for a subscribed eventId dropped from the new list', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA')]));
    const seen: Fixture[] = [];
    store.subscribe('eA', (f) => seen.push(f));
    store.applyList(frame([fixture('eB')]));
    expect(seen).toHaveLength(0);
  });

  it('unsubscribe stops further notifications', () => {
    const store = new FixtureListStore();
    store.applyList(frame([fixture('eA', { feedStatus: 'scheduled' })]));
    const seen: Fixture[] = [];
    const off = store.subscribe('eA', (f) => seen.push(f));
    off();
    store.applyList(frame([fixture('eA', { feedStatus: 'live' })]));
    expect(seen).toHaveLength(0);
  });
});
