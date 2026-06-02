/**
 * SPEC-CRWDQ-066 — the `fixtures_with_live_game` composite template (the
 * "mixed-state" composite, D-GRH-30 #7).
 *
 * Mount renders one `<li class="cdq-fixture-card cdq-tile-live" data-game-id>`
 * for the promoted fixture (its body a real `LiveFixtureTile`) plus a real
 * SPEC-CRWDQ-034 static card for each remaining fixture_id, in fixture_ids
 * order. Promotion is the direct id match `fixture_id === primary_game_id`
 * (both canonical event_id). Constraint violations journal
 * `template_input_invalid` and decline the mount.
 *
 * Every shared store is the REAL instance (INV-FACTORY-16): the
 * `FixtureListStore`, the `GameStateStore`, the `AssetManifestStore`; the
 * static cards are the real `FixtureCardSet`, the live tile the real
 * `LiveFixtureTile`. Only the genuine boundaries are substituted
 * (INV-FACTORY-17): the journal sink, the asset fetch, the clock (via the
 * formatter's injected `now`).
 */
import { describe, it, expect } from 'vitest';
import { FixturesWithLiveGameTemplate } from '../../../src/templates/mixed-state/FixturesWithLiveGameTemplate';
import { LIVE_TILE_TESTID } from '../../../src/templates/mixed-state/LiveFixtureTile';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { resolveTheme } from '../../../src/render/ThemeResolver';
import type { ProgramSlotPayload } from '../../../src/render/types';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyBadgeManifest,
  makeGameStateStore,
  seedGame,
  gameEvent,
  fixture,
  fixtureFrame,
  typesOf,
} from './support';

const THEME = resolveTheme(null, { currentBarTheme: () => null });
const NOW = (): number => Date.parse('2026-06-01T18:00:00Z');

interface MountOpts {
  fixtureIds: string[];
  primaryGameId: string | null;
}

function makeFixtures(): FixtureListStore {
  const store = new FixtureListStore();
  store.applyList(
    fixtureFrame([
      fixture('fA', { homeTeam: 'Arsenal', awayTeam: 'Chelsea', feedStatus: 'live' }),
      fixture('fB', { homeTeam: 'Spurs', awayTeam: 'Fulham', feedStatus: 'scheduled' }),
      fixture('fC', { homeTeam: 'Leeds', awayTeam: 'Wolves', feedStatus: 'scheduled' }),
      fixture('fD', { homeTeam: 'Brentford', awayTeam: 'Everton', feedStatus: 'scheduled' }),
    ]),
  );
  return store;
}

function mount(opts: MountOpts) {
  const journal = new RecordingJournal();
  const fixtures = makeFixtures();
  const games = makeGameStateStore(journal);
  const { store: assets } = makeAssetStore();
  applyBadgeManifest(assets, []);
  // Seed the promoted game (D-GRH-49: in-store before the PlannedState arrives).
  if (opts.primaryGameId) {
    seedGame(games, opts.primaryGameId, {
      home_score: 14,
      away_score: 7,
      sport_context: { period_clock: 'Q3 8:12' },
    });
  }
  const cardTransitions = new RecordingCardTransitions();
  const host = document.createElement('div');

  const slot: ProgramSlotPayload = {
    program_slot_id: 'slot-1',
    primary_game_id: opts.primaryGameId,
    game_ids: [],
    fixture_ids: opts.fixtureIds,
  };

  const instance = new FixturesWithLiveGameTemplate().mount(host, {
    programSlot: slot,
    theme: THEME,
    timezone: 'America/Chicago',
    fixtureListStore: fixtures,
    assetManifestStore: assets,
    gameStateStore: games,
    journal,
    cardTransitions,
    now: NOW,
    pendingApply: null,
  });

  return { instance, host, journal, fixtures, games, cardTransitions };
}

const cards = (host: ParentNode): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-fixture-card'));
// Every `<li>` (static + promoted) carries `data-event-id` (the SPEC-034 card
// primitive's attribute); the promoted tile additionally carries data-fixture-id.
const ids = (host: ParentNode): string[] =>
  cards(host).map((c) => c.dataset['eventId'] ?? '');
const liveCard = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('.cdq-fixture-card.cdq-tile-live');
const sel = (host: ParentNode, testid: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe('FixturesWithLiveGameTemplate mount (SPEC-CRWDQ-066)', () => {
  it('renders the promoted fixture as a live tile and the rest as static cards, in fixture_ids order', () => {
    const { host } = mount({ fixtureIds: ['fA', 'fB', 'fC'], primaryGameId: 'fA' });

    expect(host.querySelector('section.crowdaq-fixtures-with-live-game')).not.toBeNull();
    expect(host.querySelector('.cdq-fixture-list')).not.toBeNull();
    expect(ids(host)).toEqual(['fA', 'fB', 'fC']);

    const live = liveCard(host)!;
    expect(live.dataset['fixtureId']).toBe('fA');
    expect(live.dataset['gameId']).toBe('fA');
    expect(live.dataset['status']).toBe('live');
    // The promoted tile's body is a real LiveFixtureTile fed by the seeded snapshot.
    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('14');
    expect(sel(live, LIVE_TILE_TESTID.awayScore)!.textContent).toBe('7');
    expect(sel(live, LIVE_TILE_TESTID.status)!.textContent).toBe('LIVE');

    // fB / fC are static cards (no cdq-tile-live, the SPEC-034 card body).
    const fB = cards(host).find((c) => c.dataset['eventId'] === 'fB')!;
    expect(fB.classList.contains('cdq-tile-live')).toBe(false);
    expect(fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe('Spurs');
  });

  it('promotes a non-first fixture by primary_game_id without moving it', () => {
    const { host } = mount({ fixtureIds: ['fA', 'fB', 'fC'], primaryGameId: 'fB' });
    expect(ids(host)).toEqual(['fA', 'fB', 'fC']);
    expect(liveCard(host)!.dataset['fixtureId']).toBe('fB');
    expect(liveCard(host)!.dataset['gameId']).toBe('fB');
  });

  it('updates the live tile in place on a GameEvent; no other tile re-renders', () => {
    const { host, games } = mount({ fixtureIds: ['fA', 'fB', 'fC'], primaryGameId: 'fA' });
    const live = liveCard(host)!;
    const fbHome = cards(host)
      .find((c) => c.dataset['eventId'] === 'fB')!
      .querySelector('[data-testid="cdq-fixture-home"]')!;
    const fbBefore = fbHome.textContent;

    games.applyEvent(gameEvent('fA', 2, { home_score: 21 }));

    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('21');
    expect(fbHome.textContent).toBe(fbBefore); // untouched
  });

  it('updates a static tile in place on a FixtureList re-push WITHOUT auto-promoting it', () => {
    const { host, fixtures } = mount({ fixtureIds: ['fA', 'fB', 'fC'], primaryGameId: 'fA' });

    // Re-push flips fB to live.
    fixtures.applyList(
      fixtureFrame([
        fixture('fA', { feedStatus: 'live' }),
        fixture('fB', { homeTeam: 'Spurs', awayTeam: 'Fulham', feedStatus: 'live' }),
        fixture('fC', { feedStatus: 'scheduled' }),
      ]),
    );

    const fB = cards(host).find((c) => c.dataset['eventId'] === 'fB')!;
    expect(fB.dataset['status']).toBe('live');
    // NOT auto-promoted: still a static card, no live tile, fA stays the live one.
    expect(fB.classList.contains('cdq-tile-live')).toBe(false);
    expect(liveCard(host)!.dataset['fixtureId']).toBe('fA');
  });

  it('journals template_input_invalid + declines when primary_game_id matches no fixture', () => {
    const { host, journal } = mount({ fixtureIds: ['fA', 'fB'], primaryGameId: 'G_GHOST' });
    expect(host.querySelector('section')).toBeNull();
    expect(typesOf(journal.entries, 'template_input_invalid')).toHaveLength(1);
    expect(typesOf(journal.entries, 'template_input_invalid')[0]).toMatchObject({
      reason: 'promoted_fixture_not_found',
    });
  });

  it('journals template_input_invalid + declines when primary_game_id is null', () => {
    const { host, journal } = mount({ fixtureIds: ['fA', 'fB'], primaryGameId: null });
    expect(host.querySelector('section')).toBeNull();
    expect(typesOf(journal.entries, 'template_input_invalid')).toHaveLength(1);
  });

  it('journals template_input_invalid + declines when fixture_ids is empty', () => {
    const { host, journal } = mount({ fixtureIds: [], primaryGameId: 'fA' });
    expect(host.querySelector('section')).toBeNull();
    expect(typesOf(journal.entries, 'template_input_invalid')).toHaveLength(1);
  });
});

describe('FixturesWithLiveGameTemplate reconcile (SPEC-CRWDQ-066)', () => {
  it('re-promotes a new primary_game_id: old live tile demotes to static, new fixture mounts live; journals live_tile_reconciled', async () => {
    const { host, journal, games, instance } = mount({
      fixtureIds: ['fA', 'fB', 'fC'],
      primaryGameId: 'fA',
    });
    // Seed the next promoted game.
    seedGame(games, 'fB', { home_score: 3, away_score: 1, sport_context: { period_clock: 'P2' } });

    await instance!.reconcile!({
      kind: 'program_slot',
      slot: {
        program_slot_id: 'slot-1',
        primary_game_id: 'fB',
        game_ids: [],
        fixture_ids: ['fA', 'fB', 'fC'],
      },
    });

    // fA demoted to static; fB promoted.
    const fA = cards(host).find((c) => c.dataset['eventId'] === 'fA')!;
    expect(fA.classList.contains('cdq-tile-live')).toBe(false);
    expect(fA.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe('Arsenal');

    const live = liveCard(host)!;
    expect(live.dataset['fixtureId']).toBe('fB');
    expect(live.dataset['gameId']).toBe('fB');
    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('3');

    const rec = typesOf(journal.entries, 'live_tile_reconciled');
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      previous_game_id: 'fA',
      new_game_id: 'fB',
      demoted_fixture_id: 'fA',
    });
  });

  it('unsubscribes the old live tile on re-promote: a stale GameEvent for the old game does not mutate the demoted card', async () => {
    const { host, games, instance } = mount({ fixtureIds: ['fA', 'fB'], primaryGameId: 'fA' });
    seedGame(games, 'fB', { home_score: 0, away_score: 0, sport_context: { period_clock: 'P1' } });

    await instance!.reconcile!({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'fB', game_ids: [], fixture_ids: ['fA', 'fB'] },
    });

    // fA is now a static card; an event for fA must not paint a live score onto it.
    games.applyEvent(gameEvent('fA', 5, { home_score: 99 }));
    const fA = cards(host).find((c) => c.dataset['eventId'] === 'fA')!;
    expect(fA.querySelector('[data-testid="live-tile-home-score"]')).toBeNull();
  });

  it('same promoted game, fixture_ids changed: no live-tile restructure, static portion reconciles', async () => {
    const { host, journal, instance } = mount({ fixtureIds: ['fA', 'fB', 'fC'], primaryGameId: 'fA' });
    const liveBefore = liveCard(host)!;

    await instance!.reconcile!({
      kind: 'program_slot',
      slot: {
        program_slot_id: 'slot-1',
        primary_game_id: 'fA',
        game_ids: [],
        fixture_ids: ['fA', 'fB', 'fD'], // fC removed, fD added
      },
    });

    expect(liveCard(host)).toBe(liveBefore); // same node, not re-mounted
    expect(ids(host)).toEqual(['fA', 'fB', 'fD']);
    // No re-promotion journal when the promoted game is unchanged.
    expect(typesOf(journal.entries, 'live_tile_reconciled')).toHaveLength(0);
  });

  it('ad_slot and game_state_revision reconcile kinds are no-ops', async () => {
    const { host, instance } = mount({ fixtureIds: ['fA', 'fB'], primaryGameId: 'fA' });
    const liveBefore = liveCard(host)!;

    await instance!.reconcile!({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'a', ad_class: 'c', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    await instance!.reconcile!({ kind: 'game_state_revision', gameState: { game_id: 'fA', seq: 9 } });

    expect(liveCard(host)).toBe(liveBefore);
    expect(ids(host)).toEqual(['fA', 'fB']);
  });
});

describe('FixturesWithLiveGameTemplate detach (SPEC-CRWDQ-066)', () => {
  it('detach() unsubscribes the live tile and every static card; returns the section', () => {
    const { host, instance, games, fixtures } = mount({
      fixtureIds: ['fA', 'fB'],
      primaryGameId: 'fA',
    });
    const live = liveCard(host)!;
    const fB = cards(host).find((c) => c.dataset['eventId'] === 'fB')!;
    const fbHomeBefore = fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent;
    const liveScoreBefore = sel(live, LIVE_TILE_TESTID.homeScore)!.textContent;

    const returned = instance!.detach();
    expect(returned.classList.contains('crowdaq-fixtures-with-live-game')).toBe(true);

    // Post-detach pushes must not mutate the detached nodes.
    games.applyEvent(gameEvent('fA', 2, { home_score: 50 }));
    fixtures.applyList(fixtureFrame([fixture('fB', { homeTeam: 'CHANGED', feedStatus: 'live' })]));

    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe(liveScoreBefore);
    expect(fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe(fbHomeBefore);
  });
});
