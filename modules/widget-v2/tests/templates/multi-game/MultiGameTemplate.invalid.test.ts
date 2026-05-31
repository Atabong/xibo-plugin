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
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

const slot = (gameIds: string[]): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: gameIds[0] ?? null,
  game_ids: gameIds,
});

function attemptMount(gameIds: string[]): { host: HTMLElement; journal: RecordingJournal } {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const instance = new MultiGameTemplate().mount(host, {
    programSlot: slot(gameIds),
    theme: { state: 'default' },
    gameStateStore: new GameStateStore(journal),
    journal,
    cardTransitions: new RecordingCardTransitions(),
  });
  expect(instance).toBeNull();
  return { host, journal };
}

describe('MultiGameTemplate.mount card-count guard (AC2)', () => {
  it('declines to mount and journals template_input_invalid for a single-card slot', () => {
    const { host, journal } = attemptMount(['g1']);
    expect(host.querySelector('section.crowdaq-multi-game')).toBeNull();
    const invalid = journal.typesOf('template_input_invalid');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ reason: 'card_count_out_of_range', card_count: 1 });
  });

  it('declines to mount for a five-card slot (above the [2,4] range)', () => {
    const { host, journal } = attemptMount(['g1', 'g2', 'g3', 'g4', 'g5']);
    expect(host.querySelector('section.crowdaq-multi-game')).toBeNull();
    expect(journal.typesOf('template_input_invalid')[0]).toMatchObject({ card_count: 5 });
  });
});
