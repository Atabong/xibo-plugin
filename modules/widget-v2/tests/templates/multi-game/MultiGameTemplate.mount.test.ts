import { describe, it, expect } from 'vitest';
import { MultiGameTemplate, MULTI_TESTID } from '../../../src/templates/multi-game/MultiGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { ProgramSlotPayload } from '../../../src/render/types';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import { RecordingCardTransitions } from './support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const slot = (gameIds: string[], primary: string | null = null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primary,
  game_ids: gameIds,
});

function mount(opts: {
  gameIds: string[];
  primary?: string | null;
  theme?: ResolvedTheme;
}): { host: HTMLElement; store: GameStateStore; journal: RecordingJournal } {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  new MultiGameTemplate().mount(host, {
    programSlot: slot(opts.gameIds, opts.primary ?? null),
    theme: opts.theme ?? { state: 'default' },
    gameStateStore: store,
    journal,
    cardTransitions: new RecordingCardTransitions(),
  });
  return { host, store, journal };
}

const cards = (host: ParentNode): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-card'));

describe('MultiGameTemplate.mount DOM (AC1)', () => {
  it('renders a crowdaq-multi-game cdq-grid-2x2 section carrying card-count + theme', () => {
    const { host } = mount({ gameIds: ['g1', 'g2'], theme: { state: 'set', id: 'midnight' } });
    const section = host.querySelector<HTMLElement>('section.crowdaq-multi-game.cdq-grid-2x2');
    expect(section).not.toBeNull();
    expect(section?.dataset['cardCount']).toBe('2');
    expect(section?.dataset['theme']).toBe('midnight');
    expect(section?.dataset['testid']).toBe(MULTI_TESTID.root);
  });

  it('renders one cdq-card per game_id, preserving order with data-game-id + data-position', () => {
    const { host } = mount({ gameIds: ['g1', 'g2', 'g3', 'g4'] });
    const rendered = cards(host);
    expect(rendered.map((c) => c.dataset['gameId'])).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(rendered.map((c) => c.dataset['position'])).toEqual(['0', '1', '2', '3']);
  });

  it('sets data-card-count to 3 for a three-game slot', () => {
    const { host } = mount({ gameIds: ['g1', 'g2', 'g3'] });
    expect(host.querySelector<HTMLElement>('.cdq-grid-2x2')?.dataset['cardCount']).toBe('3');
    expect(cards(host)).toHaveLength(3);
  });
});
