import { describe, it, expect, beforeEach } from 'vitest';
import { FixturesWithAdsTemplate } from '../../../src/templates/with-ads/FixturesWithAdsTemplate';
import { FixturesTemplate } from '../../../src/templates/fixtures/FixturesTemplate';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { TransitionExecutor, type TransitionDefinition } from '../../../src/render/TransitionExecutor';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { ProgramSlotPayload, TransitionSpec } from '../../../src/render/types';
import type { TemplateReconcileEvent } from '../../../src/render/TemplateInstance';
import type { Fixture, FixtureListFrameTyped } from '../../../src/templates/fixtures/types';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyAndWarmAdManifest,
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

const programSlotEvent = (s: ProgramSlotPayload): TemplateReconcileEvent => ({
  kind: 'program_slot',
  slot: s,
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

describe('FixturesWithAdsInstance.reconcile (SPEC-CRWDQ-041 #56)', () => {
  let host: HTMLElement;
  let journal: RecordingJournal;
  beforeEach(() => {
    host = document.createElement('div');
    journal = new RecordingJournal();
  });

  async function mountComposite(fixtureIds: string[]) {
    const { store: assets } = makeAssetStore();
    await applyAndWarmAdManifest(assets, ['creative-1']);
    return new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
      programSlot: slot(fixtureIds),
      theme,
      timezone: TZ,
      fixtureListStore: makeFixtureStore(['e1', 'e2', 'e3', 'e4']),
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
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      stateId: 'st-1',
    })!;
  }

  it('exposes a reconcile hook on the composite instance', async () => {
    const instance = await mountComposite(['e1', 'e2']);
    expect(typeof instance.reconcile).toBe('function');
  });

  it('propagates a fixtures add/remove into .cdq-content, leaving the ad panel untouched', async () => {
    const instance = await mountComposite(['e1', 'e2']);
    const section = host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    const content = section.querySelector<HTMLElement>('.cdq-content')!;
    const imgBefore = section.querySelector<HTMLImageElement>('.cdq-ad-panel img.cdq-ad-creative')!;
    const srcBefore = imgBefore.getAttribute('src');

    await instance.reconcile!(programSlotEvent(slot(['e1', 'e3'])));

    expect(fixtureCards(content)).toEqual(['e1', 'e3']);
    const reconciled = journal.typesOf('fixtures_reconciled');
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ added: ['e3'], removed: ['e2'] });

    // Ad panel untouched: same <img> node, same src, no flicker.
    const imgAfter = section.querySelector<HTMLImageElement>('.cdq-ad-panel img.cdq-ad-creative')!;
    expect(imgAfter).toBe(imgBefore);
    expect(imgAfter.getAttribute('src')).toBe(srcBefore);
  });
});
