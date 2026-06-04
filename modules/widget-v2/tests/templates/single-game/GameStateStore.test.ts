import { describe, it, expect } from 'vitest';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameEvent, GameState } from '../../../src/render/types';

/** In-memory journal — a real sink (system boundary), not a mock. */
class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const snapshot = (over: Partial<GameState> = {}): GameState => ({
  game_id: 'g1',
  seq: 10,
  home_team: 'Home',
  away_team: 'Away',
  home_score: 1,
  away_score: 0,
  sport_context: { sport: 'soccer', period_clock: "45'" },
  ...over,
});

const event = (seq: number, over: Partial<GameEvent> = {}): GameEvent => ({
  game_id: 'g1',
  seq,
  ...over,
});

describe('GameStateStore snapshots', () => {
  it('applies a full snapshot as the current state', () => {
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(snapshot());
    expect(store.get('g1')?.home_score).toBe(1);
  });

  it('returns null before any state is applied for a game', () => {
    const store = new GameStateStore(new RecordingJournal());
    expect(store.get('unknown')).toBeNull();
  });

  it('resets the seq baseline so an older-seq snapshot still replaces state', () => {
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(snapshot({ seq: 50, home_score: 5 }));
    store.upsertSnapshot(snapshot({ seq: 3, home_score: 9 }));
    expect(store.get('g1')?.home_score).toBe(9);
  });
});

describe('GameStateStore events', () => {
  it('applies a per-field delta over the prior state, preserving absent fields', () => {
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(snapshot());
    store.applyEvent(event(11, { home_score: 2 }));
    const state = store.get('g1');
    expect(state?.home_score).toBe(2);
    expect(state?.away_score).toBe(0);
  });

  it('merges sport_context field-by-field rather than replacing it whole', () => {
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(snapshot());
    store.applyEvent(event(11, { sport_context: { period_clock: "46'" } }));
    const ctx = store.get('g1')?.sport_context;
    expect(ctx?.period_clock).toBe("46'");
    expect(ctx?.sport).toBe('soccer');
  });

  it('exposes the most recent applied event via lastEvent', () => {
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(snapshot());
    store.applyEvent(event(11, { last_moment: 'GOAL' }));
    expect(store.lastEvent('g1')?.last_moment).toBe('GOAL');
  });

  it('drops an out-of-order event and journals game_event_seq_regression', () => {
    const journal = new RecordingJournal();
    const store = new GameStateStore(journal);
    store.upsertSnapshot(snapshot({ seq: 10 }));
    store.applyEvent(event(12, { home_score: 3 }));
    store.applyEvent(event(11, { home_score: 99 })); // regression: 11 <= 12
    expect(store.get('g1')?.home_score).toBe(3);
    expect(journal.entries).toEqual([
      { type: 'game_event_seq_regression', game_id: 'g1', seq: 11, last_applied_seq: 12 },
    ]);
  });
});

describe('GameStateStore subscriptions', () => {
  it('fires the subscriber on every applied change', () => {
    const store = new GameStateStore(new RecordingJournal());
    const seen: number[] = [];
    store.subscribe('g1', (s) => seen.push(s.seq));
    store.upsertSnapshot(snapshot({ seq: 10 }));
    store.applyEvent(event(11, { home_score: 2 }));
    expect(seen).toEqual([10, 11]);
  });

  it('does not fire the subscriber for a dropped out-of-order event', () => {
    const store = new GameStateStore(new RecordingJournal());
    const seen: number[] = [];
    store.upsertSnapshot(snapshot({ seq: 10 }));
    store.subscribe('g1', (s) => seen.push(s.seq));
    store.applyEvent(event(5, { home_score: 2 })); // regression -> dropped
    expect(seen).toEqual([]);
  });

  it('stops firing after unsubscribe', () => {
    const store = new GameStateStore(new RecordingJournal());
    const seen: number[] = [];
    const off = store.subscribe('g1', (s) => seen.push(s.seq));
    store.upsertSnapshot(snapshot({ seq: 10 }));
    off();
    store.applyEvent(event(11, { home_score: 2 }));
    expect(seen).toEqual([10]);
  });
});
