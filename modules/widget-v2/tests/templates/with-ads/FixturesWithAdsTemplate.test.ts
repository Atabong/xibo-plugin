import { describe, it, expect, beforeEach } from 'vitest';
import { FixturesWithAdsTemplate } from '../../../src/templates/with-ads/FixturesWithAdsTemplate';
import { FixturesTemplate } from '../../../src/templates/fixtures/FixturesTemplate';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { TransitionExecutor, type TransitionDefinition } from '../../../src/render/TransitionExecutor';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { ProgramSlotPayload, TransitionSpec } from '../../../src/render/types';
import type { Fixture, FixtureListFrameTyped } from '../../../src/templates/fixtures/types';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyAndWarmAdManifest,
  applyColdAdManifest,
  adSlot,
} from './support';

const theme: ResolvedTheme = { state: 'default' };
const TZ = 'America/Chicago';
const CUT: TransitionSpec = { animation_id: 'cut', duration_ms: 0 };

class RecordingPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(d: TransitionDefinition): Promise<void> {
    this.played.push(d);
  }
}

const fixture = (eventId: string): Fixture => ({
  eventId,
  sport: 'football',
  leagueId: 39,
  leagueName: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoffUtc: '2026-06-02T00:30:00Z',
  feedStatus: 'scheduled',
});

const slot = (fixtureIds: string[]): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: null,
  game_ids: [],
  fixture_ids: fixtureIds,
});

function makeFixtureStore(ids: string[]): FixtureListStore {
  const store = new FixtureListStore();
  store.applyList({
    message_type: 'FixtureList',
    payload: { fixtures: ids.map(fixture) },
  } as FixtureListFrameTyped);
  return store;
}

const fixtureCards = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.cdq-fixture-card')).map((c) => c.dataset['eventId'] ?? '');

describe('FixturesWithAdsTemplate.mount (SPEC-CRWDQ-041 #55)', () => {
  let host: HTMLElement;
  let journal: RecordingJournal;
  beforeEach(() => {
    host = document.createElement('div');
    journal = new RecordingJournal();
  });

  function commonCtx(assets: ReturnType<typeof makeAssetStore>['store']) {
    return {
      programSlot: slot(['e1', 'e2', 'e3']),
      theme,
      timezone: TZ,
      fixtureListStore: makeFixtureStore(['e1', 'e2', 'e3']),
      transitionExecutor: new TransitionExecutor({
        catalog: new Map([['cut', { opacity: [1, 1] }]]),
        assets,
        player: new RecordingPlayer(),
        journal,
      }),
      transition: CUT,
      journal,
      cardTransitions: new RecordingCardTransitions(),
      pendingApply: null,
      assetManifestStore: assets,
    };
  }

  it('renders the composite shell with the real fixtures list beside the ad panel', async () => {
    const { store: assets } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
      ...commonCtx(assets),
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    });

    expect(instance).not.toBeNull();
    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    expect(section.dataset['mode']).toBe('fixtures_with_ads');
    expect(section.classList.contains('cdq-with-ads-right')).toBe(true);

    const content = section.querySelector<HTMLElement>('.cdq-content')!;
    expect(content.querySelector('.crowdaq-fixtures')).not.toBeNull();
    expect(fixtureCards(content)).toEqual(['e1', 'e2', 'e3']);

    const img = section.querySelector<HTMLImageElement>('.cdq-ad-panel img.cdq-ad-creative')!;
    expect(img.getAttribute('src')).toBe(urls['creative-1']);
  });

  it('on ad cache miss falls back to the bare fixtures list in the original host', async () => {
    const { store: assets } = makeAssetStore();
    applyColdAdManifest(assets, ['creative-cold']);

    const instance = new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
      ...commonCtx(assets),
      adSlot: adSlot({ ad_ref: 'creative-cold' }),
      stateId: 'st-1',
    });

    // Content preserved (D-GRH-16). SPEC-CRWDQ-S11 (deferred swap-in, commit
    // 1bf96e2): on a cold creative the composite keeps the shell + a deferred
    // `.cdq-ad-panel` (the real creative swaps in WHEN it warms) rather than
    // eagerly collapsing to a bare list. The fixtures list mounts inside
    // `.cdq-content` and stays visible throughout.
    expect(instance).not.toBeNull();
    expect(host.querySelector('section.crowdaq-with-ads')).not.toBeNull();
    expect(host.querySelector('.cdq-content .crowdaq-fixtures')).not.toBeNull();
    expect(fixtureCards(host)).toEqual(['e1', 'e2', 'e3']);
  });

  it('declines with template_input_invalid when the ad_slot is null', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
      ...commonCtx(assets),
      adSlot: null,
      stateId: 'st-1',
    });

    expect(instance).toBeNull();
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(host.querySelector('.crowdaq-fixtures')).toBeNull();
    expect(journal.typesOf('template_input_invalid')).toHaveLength(1);
  });

  it('ad_slot_completed fires on detach with the boundary dwell', async () => {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);

    const instance = new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
      ...commonCtx(assets),
      adSlot: adSlot({ ad_slot_id: 'ad-5', ad_ref: 'creative-1' }),
      stateId: 'st-3',
      dwellActualMs: () => 9000,
    })!;

    instance.detach();
    const completed = journal.typesOf('ad_slot_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ad_slot_id: 'ad-5', state_id: 'st-3', dwell_actual_ms: 9000 });
    expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
  });
});
