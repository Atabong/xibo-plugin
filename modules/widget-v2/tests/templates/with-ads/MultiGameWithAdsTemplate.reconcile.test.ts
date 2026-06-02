import { describe, it, expect, beforeEach } from 'vitest';
import { MultiGameWithAdsTemplate } from '../../../src/templates/with-ads/MultiGameWithAdsTemplate';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { ProgramSlotPayload } from '../../../src/render/types';
import type { TemplateReconcileEvent } from '../../../src/render/TemplateInstance';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyAndWarmAdManifest,
  adSlot,
} from './support';

const theme: ResolvedTheme = { state: 'default' };

const slot = (over: Partial<ProgramSlotPayload> = {}): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: 'g1',
  game_ids: ['g1', 'g2'],
  ...over,
});

const programSlotEvent = (s: ProgramSlotPayload): TemplateReconcileEvent => ({
  kind: 'program_slot',
  slot: s,
});

const cardIds = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.cdq-card')).map((c) => c.dataset['gameId'] ?? '');

describe('MultiGameWithAdsInstance.reconcile (SPEC-CRWDQ-041 #56)', () => {
  let host: HTMLElement;
  let store: GameStateStore;
  let journal: RecordingJournal;
  beforeEach(() => {
    host = document.createElement('div');
    journal = new RecordingJournal();
    store = new GameStateStore(journal);
  });

  function mountComposite(programSlot: ProgramSlotPayload) {
    return new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot,
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: makeAssetStoreWarmed(),
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    })!;
  }

  // The store is warmed once per test (the ad creative is in the hot cache).
  let warmedStore: ReturnType<typeof makeAssetStore>['store'];
  function makeAssetStoreWarmed() {
    return warmedStore;
  }
  beforeEach(async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);
    warmedStore = assets;
  });

  it('exposes a reconcile hook on the composite instance', () => {
    const instance = mountComposite(slot());
    expect(typeof instance.reconcile).toBe('function');
  });

  it('delegates a program_slot event verbatim to the content child: cards add inside .cdq-content', async () => {
    const instance = mountComposite(slot({ game_ids: ['g1', 'g2'] }));
    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    const content = section.querySelector<HTMLElement>('.cdq-content')!;

    await instance.reconcile!(programSlotEvent(slot({ game_ids: ['g1', 'g2', 'g3'] })));

    // The add propagated INTO .cdq-content (the content child handled it).
    expect(cardIds(content)).toEqual(['g1', 'g2', 'g3']);
    const reconciled = journal.typesOf('multi_game_reconciled');
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ added: ['g3'], removed: [] });
  });

  it('propagates a card removal into .cdq-content', async () => {
    const instance = mountComposite(slot({ game_ids: ['g1', 'g2', 'g3'] }));
    const content = host.querySelector<HTMLElement>('.cdq-content')!;

    await instance.reconcile!(programSlotEvent(slot({ game_ids: ['g1', 'g3'] })));

    expect(cardIds(content)).toEqual(['g1', 'g3']);
    expect(journal.typesOf('multi_game_reconciled')[0]).toMatchObject({ removed: ['g2'] });
  });

  it('leaves the ad panel untouched across a reconcile: same <img>, same src, no flicker', async () => {
    const instance = mountComposite(slot({ game_ids: ['g1', 'g2'] }));
    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    const imgBefore = section.querySelector<HTMLImageElement>('.cdq-ad-panel img.cdq-ad-creative')!;
    const srcBefore = imgBefore.getAttribute('src');
    const panelBefore = section.querySelector<HTMLElement>('.cdq-ad-panel')!;

    await instance.reconcile!(programSlotEvent(slot({ game_ids: ['g1', 'g2', 'g3'] })));

    const imgAfter = section.querySelector<HTMLImageElement>('.cdq-ad-panel img.cdq-ad-creative')!;
    // Same node identity (not re-rendered) and same src — no flicker.
    expect(imgAfter).toBe(imgBefore);
    expect(section.querySelector<HTMLElement>('.cdq-ad-panel')).toBe(panelBefore);
    expect(imgAfter.getAttribute('src')).toBe(srcBefore);
  });

  it('treats game_state_revision as a no-op (per-game state reaches cards via their own subscription)', async () => {
    const instance = mountComposite(slot({ game_ids: ['g1', 'g2'] }));
    const content = host.querySelector<HTMLElement>('.cdq-content')!;

    await instance.reconcile!({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 5 } });

    expect(cardIds(content)).toEqual(['g1', 'g2']);
    expect(journal.typesOf('multi_game_reconciled')).toHaveLength(0);
  });
});
