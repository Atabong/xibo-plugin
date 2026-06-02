/**
 * SPEC-CRWDQ-066 — `LiveFixtureTile`, the reduced-surface live render that
 * replaces a static fixture card's body when its fixture is the promoted game.
 *
 * The tile reuses the SPEC-CRWDQ-023 `GameStateStore.subscribe` wiring (real
 * store, INV-FACTORY-16) and renders ONLY a compact score block + a LIVE/FINAL
 * pill — no sport_context header, no last_moment overlay (those are the
 * full-surface single_game template's). Team NAMES come from the `Fixture`
 * frame, never from `GameState` (the wire carries no team_id on a GameState).
 */
import { describe, it, expect } from 'vitest';
import {
  LiveFixtureTile,
  LIVE_TILE_TESTID,
} from '../../../src/templates/mixed-state/LiveFixtureTile';
import {
  RecordingJournal,
  makeAssetStore,
  applyBadgeManifest,
  makeGameStateStore,
  seedGame,
  gameEvent,
  fixture,
} from './support';

const sel = (host: ParentNode, testid: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe('LiveFixtureTile (SPEC-CRWDQ-066)', () => {
  it('renders a compact score block from the current GameState snapshot + team names from the fixture', () => {
    const journal = new RecordingJournal();
    const store = makeGameStateStore(journal);
    seedGame(store, 'G1', {
      home_score: 14,
      away_score: 7,
      sport_context: { period_clock: 'Q3 8:12' },
    });
    const { store: assets } = makeAssetStore();
    applyBadgeManifest(assets, []);
    const host = document.createElement('li');

    new LiveFixtureTile().mount(host, {
      gameId: 'G1',
      fixture: fixture('fA', { homeTeam: 'Arsenal', awayTeam: 'Chelsea' }),
      gameStateStore: store,
      assetManifestStore: assets,
    });

    expect(sel(host, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('14');
    expect(sel(host, LIVE_TILE_TESTID.awayScore)!.textContent).toBe('7');
    expect(sel(host, LIVE_TILE_TESTID.clock)!.textContent).toBe('Q3 8:12');
    // Team identity is the fixture's, not GameState's.
    expect(host.querySelector('.cdq-tile-home .cdq-team-name')!.textContent).toBe('Arsenal');
    expect(host.querySelector('.cdq-tile-away .cdq-team-name')!.textContent).toBe('Chelsea');
    // The promoted-tile affordances: a score block + a LIVE pill, nothing else.
    expect(sel(host, LIVE_TILE_TESTID.status)!.textContent).toBe('LIVE');
    expect(host.querySelector('.cdq-sport-context')).toBeNull();
    expect(host.querySelector('.cdq-overlay')).toBeNull();
  });

  it('mutates the score/clock text nodes in place on a GameEvent delta (no re-mount)', () => {
    const journal = new RecordingJournal();
    const store = makeGameStateStore(journal);
    seedGame(store, 'G1', { home_score: 14, away_score: 7, sport_context: { period_clock: 'Q3 8:12' } });
    const { store: assets } = makeAssetStore();
    applyBadgeManifest(assets, []);
    const host = document.createElement('li');

    new LiveFixtureTile().mount(host, {
      gameId: 'G1',
      fixture: fixture('fA'),
      gameStateStore: store,
      assetManifestStore: assets,
    });
    const scoreEl = sel(host, LIVE_TILE_TESTID.homeScore)!;

    store.applyEvent(gameEvent('G1', 2, { home_score: 21, sport_context: { period_clock: 'Q3 6:40' } }));

    // The SAME element was mutated, not replaced.
    expect(sel(host, LIVE_TILE_TESTID.homeScore)).toBe(scoreEl);
    expect(scoreEl.textContent).toBe('21');
    expect(sel(host, LIVE_TILE_TESTID.clock)!.textContent).toBe('Q3 6:40');
    expect(sel(host, LIVE_TILE_TESTID.awayScore)!.textContent).toBe('7');
  });

  it('freezes the score block and swaps LIVE for FINAL when status flips to final', () => {
    // The status flip arrives as an authoritative snapshot (D-GRH-49): the
    // shared SPEC-CRWDQ-023 GameStateStore carries `status` only on a full
    // snapshot, not on a per-field GameEvent delta (its merge propagates score
    // / clock / moment, not status — the recap template reads `status` the same
    // way). See the dev note / disclosure for the GameEvent-status gap.
    const journal = new RecordingJournal();
    const store = makeGameStateStore(journal);
    seedGame(store, 'G1', { home_score: 24, away_score: 21, sport_context: { period_clock: 'Q4 0:00' } });
    const { store: assets } = makeAssetStore();
    applyBadgeManifest(assets, []);
    const host = document.createElement('li');

    new LiveFixtureTile().mount(host, {
      gameId: 'G1',
      fixture: fixture('fA'),
      gameStateStore: store,
      assetManifestStore: assets,
    });
    expect(sel(host, LIVE_TILE_TESTID.status)!.textContent).toBe('LIVE');

    store.upsertSnapshot({
      game_id: 'G1',
      seq: 2,
      home_score: 24,
      away_score: 21,
      status: 'final',
      sport_context: { period_clock: 'Q4 0:00' },
    });

    expect(sel(host, LIVE_TILE_TESTID.status)!.textContent).toBe('FINAL');
    // Frozen on the last applied values.
    expect(sel(host, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('24');
    expect(sel(host, LIVE_TILE_TESTID.awayScore)!.textContent).toBe('21');
  });

  it('falls back to league-name text when the sport-badge asset is a cache miss (D-GRH-08); the score still renders', () => {
    const journal = new RecordingJournal();
    const store = makeGameStateStore(journal);
    seedGame(store, 'G1', { home_score: 3, away_score: 0, sport_context: { period_clock: 'P1' } });
    const { store: assets } = makeAssetStore();
    applyBadgeManifest(assets, []); // no badge entries -> get() misses
    const host = document.createElement('li');

    new LiveFixtureTile().mount(host, {
      gameId: 'G1',
      fixture: fixture('fA', { leagueName: 'Premier League' }),
      gameStateStore: store,
      assetManifestStore: assets,
    });

    const badge = host.querySelector('.cdq-sport-badge')!;
    expect(badge.querySelector('img')).toBeNull();
    expect(badge.textContent).toBe('Premier League');
    // The score block is unaffected by the badge miss.
    expect(sel(host, LIVE_TILE_TESTID.homeScore)!.textContent).toBe('3');
  });

  it('detach() unsubscribes the GameStateStore listener (no further mutation after detach)', () => {
    const journal = new RecordingJournal();
    const store = makeGameStateStore(journal);
    seedGame(store, 'G1', { home_score: 1, away_score: 0, sport_context: { period_clock: 'P1' } });
    const { store: assets } = makeAssetStore();
    applyBadgeManifest(assets, []);
    const host = document.createElement('li');

    const instance = new LiveFixtureTile().mount(host, {
      gameId: 'G1',
      fixture: fixture('fA'),
      gameStateStore: store,
      assetManifestStore: assets,
    });
    const scoreEl = sel(host, LIVE_TILE_TESTID.homeScore)!;

    const returned = instance.detach();
    expect(returned).toBe(host);

    store.applyEvent(gameEvent('G1', 2, { home_score: 99 }));
    expect(scoreEl.textContent).toBe('1');
  });
});
