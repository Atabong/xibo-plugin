import { describe, it, expect } from 'vitest';
import type {
  TemplateInstance,
  TemplateReconcileEvent,
} from '../../../src/render/TemplateInstance';
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { ProgramSlotPayload } from '../../../src/render/types';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const slot = (primaryGameId: string | null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primaryGameId,
});

describe('TemplateReconcileEvent contract (AC3)', () => {
  it('discriminates on three kinds, each carrying its own payload', () => {
    // The union is exhaustive over exactly three kinds; a kind-switch must
    // narrow each arm to its payload field.
    const events: TemplateReconcileEvent[] = [
      { kind: 'program_slot', slot: { program_slot_id: 'slot-1', primary_game_id: 'g1' } },
      {
        kind: 'ad_slot',
        adSlot: { ad_slot_id: 'ad-1', ad_class: 'banner', ad_ref: 'a1', ad_ref_type: 'asset_id', policy: {} },
      },
      { kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 7 } },
    ];

    const kinds = events.map((e) => {
      switch (e.kind) {
        case 'program_slot':
          return e.slot.program_slot_id;
        case 'ad_slot':
          return e.adSlot.ad_slot_id;
        case 'game_state_revision':
          return e.gameState.game_id;
      }
    });

    expect(kinds).toEqual(['slot-1', 'ad-1', 'g1']);
  });
});

describe('SingleGameInstance reconcile? (AC3)', () => {
  it('does not implement the optional reconcile? hook (documented bare case)', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });

    // The bare single_game instance satisfies TemplateInstance but leaves
    // reconcile? undefined — the activator must treat it as "not implemented".
    const instance: TemplateInstance = new SingleGameTemplate().mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });

    expect(instance.reconcile).toBeUndefined();
    expect(typeof instance.detach).toBe('function');
  });
});
