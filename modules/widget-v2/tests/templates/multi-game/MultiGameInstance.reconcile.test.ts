import { describe, it, expect } from 'vitest';
import {
  MultiGameTemplate,
  type MultiGameInstance,
} from '../../../src/templates/multi-game/MultiGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { ProgramSlotPayload } from '../../../src/render/types';
import type { TemplateReconcileEvent } from '../../../src/render/TemplateInstance';
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

const slot = (gameIds: string[], primary: string | null = gameIds[0] ?? null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primary,
  game_ids: gameIds,
});

const programSlotEvent = (s: ProgramSlotPayload): TemplateReconcileEvent => ({
  kind: 'program_slot',
  slot: s,
});

interface Harness {
  host: HTMLElement;
  instance: MultiGameInstance;
  journal: RecordingJournal;
  transitions: RecordingCardTransitions;
}

function mount(gameIds: string[], primary?: string | null): Harness {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const transitions = new RecordingCardTransitions();
  const instance = new MultiGameTemplate().mount(host, {
    programSlot: slot(gameIds, primary === undefined ? gameIds[0] ?? null : primary),
    theme: { state: 'default' },
    gameStateStore: new GameStateStore(journal),
    journal,
    cardTransitions: transitions,
  });
  if (instance === null) throw new Error('expected a mounted instance');
  return { host, instance, journal, transitions };
}

const order = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-card')).map((c) => c.dataset['gameId'] ?? '');

const positions = (host: ParentNode): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const c of Array.from(host.querySelectorAll<HTMLElement>('.cdq-card'))) {
    map[c.dataset['gameId'] ?? ''] = c.dataset['position'] ?? '';
  }
  return map;
};

describe('MultiGameInstance.reconcile add (AC6/AC7)', () => {
  it('adds the new card with a slide-in enter, updates card-count, journals added', async () => {
    const h = mount(['g1', 'g2']);
    await h.instance.reconcile(programSlotEvent(slot(['g1', 'g2', 'g3'])));

    expect(order(h.host)).toEqual(['g1', 'g2', 'g3']);
    expect(h.host.querySelector<HTMLElement>('.cdq-grid-2x2')?.dataset['cardCount']).toBe('3');
    expect(h.transitions.phasesFor('g3')).toEqual(['enter']);
    const reconciled = h.journal.typesOf('multi_game_reconciled');
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ added: ['g3'], removed: [], reordered: [] });
  });
});

describe('MultiGameInstance.reconcile remove (AC6/AC7)', () => {
  it('removes the dropped card with a slide-out exit, repositions survivors, journals removed+reordered', async () => {
    const h = mount(['g1', 'g2', 'g3']);
    await h.instance.reconcile(programSlotEvent(slot(['g1', 'g3'])));

    expect(order(h.host)).toEqual(['g1', 'g3']);
    expect(positions(h.host)).toEqual({ g1: '0', g3: '1' });
    expect(h.transitions.phasesFor('g2')).toEqual(['exit']);
    const reconciled = h.journal.typesOf('multi_game_reconciled');
    expect(reconciled[0]).toMatchObject({ removed: ['g2'], added: [], reordered: ['g3'] });
  });
});

describe('MultiGameInstance.reconcile reorder only (AC6/AC7)', () => {
  it('repositions without add/remove and journals reordered only', async () => {
    const h = mount(['g1', 'g2', 'g3']);
    await h.instance.reconcile(programSlotEvent(slot(['g3', 'g1', 'g2'])));

    expect(order(h.host)).toEqual(['g3', 'g1', 'g2']);
    expect(h.transitions.played).toHaveLength(0);
    const reconciled = h.journal.typesOf('multi_game_reconciled');
    expect(reconciled[0]).toMatchObject({ added: [], removed: [] });
    expect(reconciled[0]?.['reordered']).toContain('g3');
  });
});

describe('MultiGameInstance.reconcile unchanged (AC7)', () => {
  it('emits no journal when the game_ids set and order are identical', async () => {
    const h = mount(['g1', 'g2']);
    await h.instance.reconcile(programSlotEvent(slot(['g1', 'g2'])));
    expect(h.journal.typesOf('multi_game_reconciled')).toHaveLength(0);
  });
});

describe('MultiGameInstance.reconcile primary shift (AC3 across reconciles)', () => {
  it('moves data-primary to the new primary game and keeps exactly one marked', async () => {
    const h = mount(['g1', 'g2'], 'g1');
    await h.instance.reconcile(programSlotEvent(slot(['g1', 'g2'], 'g2')));

    const marked = Array.from(
      h.host.querySelectorAll<HTMLElement>('.cdq-card[data-primary="true"]'),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset['gameId']).toBe('g2');
  });
});

describe('MultiGameInstance.reconcile non-program_slot kinds (AC6)', () => {
  it('treats ad_slot and game_state_revision events as no-ops', async () => {
    const h = mount(['g1', 'g2']);
    await h.instance.reconcile({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'ad-1', ad_class: 'b', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    await h.instance.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 9 } });

    expect(order(h.host)).toEqual(['g1', 'g2']);
    expect(h.journal.typesOf('multi_game_reconciled')).toHaveLength(0);
    expect(h.transitions.played).toHaveLength(0);
  });
});
