import { describe, it, expect, beforeEach } from 'vitest';
import { MultiGameWithAdsTemplate } from '../../../src/templates/with-ads/MultiGameWithAdsTemplate';
import { FixturesWithAdsTemplate } from '../../../src/templates/with-ads/FixturesWithAdsTemplate';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { FixturesTemplate } from '../../../src/templates/fixtures/FixturesTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
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
  adSlot,
} from './support';

const theme: ResolvedTheme = { state: 'default' };
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

function makeFixtureStore(ids: string[]): FixtureListStore {
  const store = new FixtureListStore();
  store.applyList({
    message_type: 'FixtureList',
    payload: { fixtures: ids.map(fixture) },
  } as FixtureListFrameTyped);
  return store;
}

/**
 * Supersede must detach BOTH children exactly once (AC). Per INV-FACTORY-16 we
 * do NOT spy on internal collaborator methods; instead we verify the
 * detach-once intent through OBSERVABLE teardown state on REAL child instances:
 *
 *   - both children's DOM is gone from the host after detach (both detaches ran),
 *   - the content child UNSUBSCRIBED — a post-detach GameState update mutates no
 *     DOM (a missing content detach would leave a live, subscribed card),
 *   - `ad_slot_completed` is recorded exactly once (a double composite-detach
 *     would record it twice — the spec's "exactly once" boundary).
 */
describe('with-ads supersede detaches both children exactly once (SPEC-CRWDQ-041 #56)', () => {
  describe('multiple_games_with_ads', () => {
    let host: HTMLElement;
    let store: GameStateStore;
    let journal: RecordingJournal;
    beforeEach(() => {
      host = document.createElement('div');
      journal = new RecordingJournal();
      store = new GameStateStore(journal);
    });

    async function mountComposite() {
      const { store: assets } = makeAssetStore();
      await applyAndWarmAdManifest(assets, ['creative-1']);
      return new MultiGameWithAdsTemplate(new MultiGameTemplate()).mount(host, {
        programSlot: {
          program_slot_id: 'slot-1',
          primary_game_id: 'g1',
          game_ids: ['g1', 'g2'],
        },
        theme,
        gameStateStore: store,
        journal,
        cardTransitions: new RecordingCardTransitions(),
        assetManifestStore: assets,
        adSlot: adSlot({ ad_ref: 'creative-1' }),
        stateId: 'st-1',
        dwellActualMs: () => 3300,
      })!;
    }

    it('removes BOTH children DOM, unsubscribes the content child, journals ad_slot_completed once', async () => {
      const instance = await mountComposite();
      expect(host.querySelector('.crowdaq-multi-game')).not.toBeNull();
      expect(host.querySelector('.cdq-ad-panel')).not.toBeNull();

      const outgoing = instance.detach();

      // Both children torn down: no content grid, no ad panel anywhere.
      expect(host.querySelector('.crowdaq-multi-game')).toBeNull();
      expect(host.querySelector('.cdq-ad-panel')).toBeNull();
      expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();
      expect(outgoing.classList.contains('crowdaq-with-ads')).toBe(true);

      // Content child unsubscribed (detached exactly): a now-late GameState
      // update for a previously-rendered game mutates nothing.
      const before = host.innerHTML;
      store.upsertSnapshot({ game_id: 'g1', seq: 9, home_team: 'Lions', home_score: 7 });
      expect(host.innerHTML).toBe(before);

      // ad_slot_completed recorded exactly once with the boundary dwell.
      const completed = journal.typesOf('ad_slot_completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ dwell_actual_ms: 3300 });
    });
  });

  describe('fixtures_with_ads', () => {
    let host: HTMLElement;
    let journal: RecordingJournal;
    beforeEach(() => {
      host = document.createElement('div');
      journal = new RecordingJournal();
    });

    async function mountComposite() {
      const { store: assets } = makeAssetStore();
      await applyAndWarmAdManifest(assets, ['creative-1']);
      return new FixturesWithAdsTemplate(new FixturesTemplate()).mount(host, {
        programSlot: {
          program_slot_id: 'slot-1',
          primary_game_id: null,
          game_ids: [],
          fixture_ids: ['e1', 'e2'],
        },
        theme,
        timezone: 'America/Chicago',
        fixtureListStore: makeFixtureStore(['e1', 'e2']),
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
        stateId: 'st-2',
        dwellActualMs: () => 5500,
      })!;
    }

    it('removes BOTH children DOM and journals ad_slot_completed once', async () => {
      const instance = await mountComposite();
      expect(host.querySelector('.crowdaq-fixtures')).not.toBeNull();
      expect(host.querySelector('.cdq-ad-panel')).not.toBeNull();

      instance.detach();

      expect(host.querySelector('.crowdaq-fixtures')).toBeNull();
      expect(host.querySelector('.cdq-ad-panel')).toBeNull();
      expect(host.querySelector('section.crowdaq-with-ads')).toBeNull();

      const completed = journal.typesOf('ad_slot_completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ dwell_actual_ms: 5500 });
    });
  });
});
