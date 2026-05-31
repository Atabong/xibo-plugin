import { describe, it, expect } from 'vitest';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { ProgramSlotPayload } from '../../../src/render/types';
import { RecordingCardTransitions } from './support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const slot = (gameIds: string[], primary: string | null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primary,
  game_ids: gameIds,
});

function mount(gameIds: string[], primary: string | null): HTMLElement {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  new MultiGameTemplate().mount(host, {
    programSlot: slot(gameIds, primary),
    theme: { state: 'default' },
    gameStateStore: new GameStateStore(journal),
    journal,
    cardTransitions: new RecordingCardTransitions(),
  });
  return host;
}

const primaryCards = (host: ParentNode): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-card[data-primary="true"]'));

describe('MultiGameTemplate primary marker (AC3)', () => {
  it('marks exactly the matching card data-primary when primary_game_id is in game_ids', () => {
    const host = mount(['g1', 'g2', 'g3'], 'g2');
    const marked = primaryCards(host);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset['gameId']).toBe('g2');
  });

  it('marks zero cards when primary_game_id is null', () => {
    expect(primaryCards(mount(['g1', 'g2'], null))).toHaveLength(0);
  });

  it('marks zero cards when primary_game_id is not one of the rendered games', () => {
    expect(primaryCards(mount(['g1', 'g2'], 'g9'))).toHaveLength(0);
  });
});
