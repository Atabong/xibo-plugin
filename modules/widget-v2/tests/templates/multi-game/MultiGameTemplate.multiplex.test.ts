import { describe, it, expect } from 'vitest';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { CARD_TESTID } from '../../../src/templates/multi-game/CardSet';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { ProgramSlotPayload } from '../../../src/render/types';
import { RecordingCardTransitions } from './support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

const slot = (gameIds: string[]): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: gameIds[0] ?? null,
  game_ids: gameIds,
});

function setup(gameIds: string[]): { host: HTMLElement; store: GameStateStore; journal: RecordingJournal } {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  new MultiGameTemplate().mount(host, {
    programSlot: slot(gameIds),
    theme: { state: 'default' },
    gameStateStore: store,
    journal,
    cardTransitions: new RecordingCardTransitions(),
  });
  return { host, store, journal };
}

const cardFor = (host: ParentNode, gameId: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.cdq-card[data-game-id="${gameId}"]`);

const homeText = (host: ParentNode, gameId: string): string =>
  cardFor(host, gameId)?.querySelector(`[data-testid="${CARD_TESTID.homeTeam}"]`)?.textContent ?? '';

describe('MultiGameTemplate per-game multiplexing (AC4)', () => {
  it('renders each card from the state already in the store at mount', () => {
    const host = document.createElement('div');
    const journal = new RecordingJournal();
    const store = new GameStateStore(journal);
    store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 2 });
    store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Bears', home_score: 0 });
    new MultiGameTemplate().mount(host, {
      programSlot: slot(['g1', 'g2']),
      theme: { state: 'default' },
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
    });
    expect(homeText(host, 'g1')).toContain('Lions');
    expect(homeText(host, 'g2')).toContain('Bears');
  });

  it('mutates only the card whose game a delta targets, leaving the others intact', () => {
    const { host, store } = setup(['g1', 'g2']);
    store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 0 });
    store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Bears', home_score: 0 });

    store.applyEvent({ game_id: 'g1', seq: 2, home_score: 3 });

    expect(homeText(host, 'g1')).toContain('3');
    expect(homeText(host, 'g2')).toContain('0');
    expect(homeText(host, 'g2')).not.toContain('3');
  });
});

describe('MultiGameTemplate per-game seq tracking (AC8)', () => {
  it('drops an out-of-order delta for one game without disturbing the others', () => {
    const { host, store, journal } = setup(['g1', 'g2']);
    store.upsertSnapshot({ game_id: 'g1', seq: 5, home_team: 'Lions', home_score: 5 });
    store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Bears', home_score: 1 });

    // A regressed seq for g1 must be dropped; g2 untouched.
    store.applyEvent({ game_id: 'g1', seq: 3, home_score: 99 });

    expect(homeText(host, 'g1')).toContain('5');
    expect(homeText(host, 'g1')).not.toContain('99');
    expect(homeText(host, 'g2')).toContain('1');
    expect(journal.typesOf('game_event_seq_regression')).toHaveLength(1);
  });
});
