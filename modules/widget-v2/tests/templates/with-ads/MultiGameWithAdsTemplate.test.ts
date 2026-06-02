import { describe, it, expect, beforeEach } from 'vitest';
import { MultiGameWithAdsTemplate } from '../../../src/templates/with-ads/MultiGameWithAdsTemplate';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { ProgramSlotPayload } from '../../../src/render/types';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyAndWarmAdManifest,
  applyColdAdManifest,
  adSlot,
} from './support';

const theme: ResolvedTheme = { state: 'default' };

const slot = (over: Partial<ProgramSlotPayload> = {}): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: 'g1',
  game_ids: ['g1', 'g2', 'g3', 'g4'],
  ...over,
});

const cardIds = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.cdq-card')).map((c) => c.dataset['gameId'] ?? '');

describe('MultiGameWithAdsTemplate.mount (SPEC-CRWDQ-041 #55)', () => {
  let host: HTMLElement;
  let store: GameStateStore;
  let journal: RecordingJournal;
  beforeEach(() => {
    host = document.createElement('div');
    journal = new RecordingJournal();
    store = new GameStateStore(journal);
  });

  it('renders the composite shell: .cdq-content (real grid) beside .cdq-ad-panel', async () => {
    const { store: assets } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot(),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    });

    expect(instance).not.toBeNull();
    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    expect(section).not.toBeNull();
    expect(section.classList.contains('cdq-with-ads-right')).toBe(true);
    expect(section.dataset['mode']).toBe('multiple_games_with_ads');

    const content = section.querySelector<HTMLElement>('.cdq-content')!;
    const adPanel = section.querySelector<HTMLElement>('.cdq-ad-panel')!;
    expect(content).not.toBeNull();
    expect(adPanel).not.toBeNull();

    // The REAL MultiGameTemplate output sits unmodified inside .cdq-content.
    expect(content.querySelector('.crowdaq-multi-game')).not.toBeNull();
    expect(cardIds(content)).toEqual(['g1', 'g2', 'g3', 'g4']);
    // The ad creative is in the panel with the manifest-resolved url.
    const img = adPanel.querySelector<HTMLImageElement>('img.cdq-ad-creative')!;
    expect(img.getAttribute('src')).toBe(urls['creative-1']);
  });

  it('on ad cache miss falls back to the bare MultiGameTemplate in the original host (no composite shell)', async () => {
    const { store: assets } = makeAssetStore();
    applyColdAdManifest(assets, ['creative-cold']);

    const instance = new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot(),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_ref: 'creative-cold' }),
      stateId: 'st-1',
    });

    // Content preserved (D-GRH-16): the grid mounted, but NOT inside a composite.
    expect(instance).not.toBeNull();
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(host.querySelector('.cdq-ad-panel')).toBeNull();
    expect(host.querySelector('.crowdaq-multi-game')).not.toBeNull();
    expect(cardIds(host)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(journal.typesOf('ad_asset_cache_miss')).toHaveLength(1);
  });

  it('declines with template_input_invalid when the ad_slot is null (no mount)', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot(),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: null,
      stateId: 'st-1',
    });

    expect(instance).toBeNull();
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(host.querySelector('.crowdaq-multi-game')).toBeNull();
    const invalid = journal.typesOf('template_input_invalid');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ reason: 'missing_ad_slot', state_id: 'st-1' });
  });

  it('declines (no mount) when the content child itself declines (card count out of range)', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot({ game_ids: ['only-one'], primary_game_id: 'only-one' }),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    });

    expect(instance).toBeNull();
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
    // The content child journaled its own decline reason.
    expect(journal.typesOf('template_input_invalid')).not.toHaveLength(0);
  });

  it('coexistence: the grid keeps its 4-card layout; the ad panel does not displace content', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot(),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    });

    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    const content = section.querySelector<HTMLElement>('.cdq-content')!;
    const adPanel = section.querySelector<HTMLElement>('.cdq-ad-panel')!;
    // Card count unchanged by the composite (D-GRH-15).
    expect(cardIds(content)).toHaveLength(4);
    // Content precedes the ad panel in document order (the right-column layout).
    expect(content.compareDocumentPosition(adPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('per-game GameState update mutates only the matching content card; the ad panel does not re-render', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot({ game_ids: ['g1', 'g2'], primary_game_id: 'g1' }),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    });

    const adImg = host.querySelector<HTMLImageElement>('img.cdq-ad-creative')!;
    const adSrcBefore = adImg.getAttribute('src');
    const g2Card = host.querySelector<HTMLElement>('.cdq-card[data-game-id="g2"]')!;
    const g1Before = host.querySelector<HTMLElement>('.cdq-card[data-game-id="g1"]')!.innerHTML;

    store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Lions', home_score: 3 });

    expect(g2Card.textContent).toContain('Lions');
    // g1 card and the ad panel image are untouched.
    expect(host.querySelector<HTMLElement>('.cdq-card[data-game-id="g1"]')!.innerHTML).toBe(g1Before);
    expect(adImg.getAttribute('src')).toBe(adSrcBefore);
  });

  it('ad_slot_completed fires on detach with ad_slot_id, ad_ref, state_id and the boundary dwell', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
      programSlot: slot(),
      theme,
      gameStateStore: store,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlot: adSlot({ ad_slot_id: 'ad-9', ad_ref: 'creative-1' }),
      stateId: 'st-77',
      dwellActualMs: () => 4200,
    })!;

    instance.detach();

    const completed = journal.typesOf('ad_slot_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      ad_slot_id: 'ad-9',
      ad_ref: 'creative-1',
      state_id: 'st-77',
      dwell_actual_ms: 4200,
    });
    // Composite shell is gone after detach.
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
  });
});
