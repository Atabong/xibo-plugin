/**
 * SPEC-CRWDQ-066 (part 2) — composite-level lifecycle behaviours that part 1
 * exercised only on the bare `LiveFixtureTile`, not through the assembled
 * composite:
 *
 *  - status flip to `final` mid-slot freezes the promoted tile and keeps it in
 *    its `fixture_ids` cell (NO auto-demote — the player waits for the backend to
 *    re-promote via a new ProgramSlot);
 *  - supersede / detach unsubscribes the live tile AND every static tile, with
 *    the "exactly once" guarantee verified BEHAVIOURALLY (INV-FACTORY-16): a
 *    post-detach store update mutates nothing, and a second detach is a harmless
 *    no-op rather than a double-unsubscribe / throw.
 *
 * Every store is the real shared instance (INV-FACTORY-16); only the journal
 * sink, the asset fetch, and the card-animation player are substituted
 * (INV-FACTORY-17). The status flip arrives as an authoritative snapshot
 * (D-GRH-49): the shared SPEC-CRWDQ-023 GameStateStore carries `status` only on a
 * full snapshot, not on a per-field GameEvent delta (its merge propagates
 * score / clock / moment, not status) — so the realistic final-flip path is an
 * upsertSnapshot, NOT a synthetic GameEvent status field.
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
} from './support';

const THEME = resolveTheme(null, { currentBarTheme: () => null });
const NOW = (): number => Date.parse('2026-06-01T18:00:00Z');

function makeFixtures(): FixtureListStore {
  const store = new FixtureListStore();
  store.applyList(
    fixtureFrame([
      fixture('fA', { homeTeam: 'Arsenal', awayTeam: 'Chelsea', feedStatus: 'live' }),
      fixture('fB', { homeTeam: 'Spurs', awayTeam: 'Fulham', feedStatus: 'scheduled' }),
      fixture('fC', { homeTeam: 'Leeds', awayTeam: 'Wolves', feedStatus: 'scheduled' }),
    ]),
  );
  return store;
}

function mount(fixtureIds: string[], primaryGameId: string) {
  const journal = new RecordingJournal();
  const fixtures = makeFixtures();
  const games = makeGameStateStore(journal);
  const { store: assets } = makeAssetStore();
  applyBadgeManifest(assets, []);
  seedGame(games, primaryGameId, {
    home_score: 24,
    away_score: 21,
    sport_context: { period_clock: 'Q4 0:30' },
  });
  const host = document.createElement('div');

  const slot: ProgramSlotPayload = {
    program_slot_id: 'slot-1',
    primary_game_id: primaryGameId,
    game_ids: [],
    fixture_ids: fixtureIds,
  };

  const instance = new FixturesWithLiveGameTemplate().mount(host, {
    programSlot: slot,
    theme: THEME,
    timezone: 'America/Chicago',
    fixtureListStore: fixtures,
    assetManifestStore: assets,
    gameStateStore: games,
    journal,
    cardTransitions: new RecordingCardTransitions(),
    now: NOW,
    pendingApply: null,
  });

  return { instance, host, journal, fixtures, games };
}

const cards = (host: ParentNode): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-fixture-card'));
const ids = (host: ParentNode): string[] => cards(host).map((c) => c.dataset['eventId'] ?? '');
const liveCard = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('.cdq-fixture-card.cdq-tile-live');
const sel = (host: ParentNode, testid: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe('FixturesWithLiveGameTemplate status flip to final (SPEC-CRWDQ-066 part 2)', () => {
  it('freezes the promoted tile on FINAL and keeps it in its cell — no auto-demote to a static card', () => {
    const { host, games } = mount(['fA', 'fB', 'fC'], 'fA');
    const liveBefore = liveCard(host)!;
    expect(sel(liveBefore, LIVE_TILE_TESTID.status)!.textContent).toBe('LIVE');

    // Authoritative snapshot carrying status:final (D-GRH-49) — the GameEvent
    // delta path cannot express a status transition on the shared store.
    games.upsertSnapshot({
      game_id: 'fA',
      seq: 2,
      home_score: 24,
      away_score: 21,
      status: 'final',
      sport_context: { period_clock: 'Q4 0:00' },
    });

    const liveAfter = liveCard(host)!;
    // Same promoted node, same cell position, still the live tile (no demote).
    expect(liveAfter).toBe(liveBefore);
    expect(ids(host)).toEqual(['fA', 'fB', 'fC']);
    expect(liveAfter.dataset['gameId']).toBe('fA');
    // Pill flipped to FINAL; the score block is frozen on the last values.
    expect(sel(liveAfter, LIVE_TILE_TESTID.status)!.textContent).toBe('FINAL');
    expect(sel(liveAfter, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('24');
    expect(sel(liveAfter, LIVE_TILE_TESTID.awayScore)!.textContent).toBe('21');
  });
});

describe('FixturesWithLiveGameTemplate supersede unsubscribe (SPEC-CRWDQ-066 part 2)', () => {
  it('detach unsubscribes the live tile and EVERY static tile — verified behaviourally, exactly once', () => {
    // Two static tiles (fB, fC) so "every static tile" is more than one.
    const { host, instance, games, fixtures } = mount(['fA', 'fB', 'fC'], 'fA');
    const live = liveCard(host)!;
    const fB = cards(host).find((c) => c.dataset['eventId'] === 'fB')!;
    const fC = cards(host).find((c) => c.dataset['eventId'] === 'fC')!;

    const liveScoreBefore = sel(live, LIVE_TILE_TESTID.homeScore)!.textContent;
    const fbHomeBefore = fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent;
    const fcHomeBefore = fC.querySelector('[data-testid="cdq-fixture-home"]')!.textContent;

    const returned = instance!.detach();
    expect(returned.classList.contains('crowdaq-fixtures-with-live-game')).toBe(true);

    // Post-detach pushes on every channel must mutate NONE of the detached nodes
    // — the behavioural proof that each subscription was removed (INV-16).
    games.applyEvent(gameEvent('fA', 2, { home_score: 99 }));
    fixtures.applyList(
      fixtureFrame([
        fixture('fB', { homeTeam: 'CHANGED-B', feedStatus: 'live' }),
        fixture('fC', { homeTeam: 'CHANGED-C', feedStatus: 'live' }),
      ]),
    );

    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe(liveScoreBefore);
    expect(fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe(fbHomeBefore);
    expect(fC.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe(fcHomeBefore);
  });

  it('a second detach is a harmless no-op — no double-unsubscribe, still inert to pushes', () => {
    const { host, instance, games, fixtures } = mount(['fA', 'fB'], 'fA');
    const live = liveCard(host)!;
    const fB = cards(host).find((c) => c.dataset['eventId'] === 'fB')!;
    const liveScoreBefore = sel(live, LIVE_TILE_TESTID.homeScore)!.textContent;
    const fbHomeBefore = fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent;

    instance!.detach();
    // The "exactly once" guarantee: detaching again neither throws nor resurrects
    // any subscription.
    expect(() => instance!.detach()).not.toThrow();

    games.applyEvent(gameEvent('fA', 2, { home_score: 77 }));
    fixtures.applyList(fixtureFrame([fixture('fB', { homeTeam: 'CHANGED', feedStatus: 'live' })]));

    expect(sel(live, LIVE_TILE_TESTID.homeScore)!.textContent).toBe(liveScoreBefore);
    expect(fB.querySelector('[data-testid="cdq-fixture-home"]')!.textContent).toBe(fbHomeBefore);
  });
});
