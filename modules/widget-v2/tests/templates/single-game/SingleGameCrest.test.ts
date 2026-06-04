/**
 * SPEC-CRWDQ-S11 — single_game renders the REAL club crest image resolved from
 * the AssetManifest by team, with a clean fallback to the colour-block monogram.
 */
import { describe, it, expect } from 'vitest';

import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameState, ProgramSlotPayload } from '../../../src/render/types';
import type { CrestResolver } from '../../../src/render/CrestResolver';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const slot = (primaryGameId: string | null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primaryGameId,
  game_ids: [],
  fixture_ids: [],
});

const state = (over: Partial<GameState> = {}): GameState => ({
  game_id: 'g1',
  seq: 1,
  home_team: 'Borussia Dortmund',
  away_team: 'Bayern München',
  home_score: 2,
  away_score: 1,
  sport_context: { sport: 'soccer', league: 'Bundesliga', period_clock: "67'" },
  ...over,
});

/** A stub resolver returning a crest URL only for the teams it's told about. */
function stubResolver(map: Record<string, string>): CrestResolver {
  return {
    crestUrlForTeam: (name?: string) => (name && map[name]) ?? null,
    assetIdForTeam: (name?: string) => (name && map[name] ? `crest:${name}` : null),
    onCrestReady: () => () => {},
  } as unknown as CrestResolver;
}

const homeBlock = (host: ParentNode): HTMLElement =>
  host.querySelector(`[data-testid="${TESTID.homeTeam}"]`) as HTMLElement;
const awayBlock = (host: ParentNode): HTMLElement =>
  host.querySelector(`[data-testid="${TESTID.awayTeam}"]`) as HTMLElement;

describe('SingleGameTemplate crest rendering (SPEC-CRWDQ-S11)', () => {
  it('renders a real crest <img> for a team whose crest is published', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(state());
    new SingleGameTemplate().mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
      crestResolver: stubResolver({
        'Borussia Dortmund': 'http://gw/assets/crest:api-football:165',
        'Bayern München': 'http://gw/assets/crest:api-football:157',
      }),
    });

    const homeImg = homeBlock(host).querySelector<HTMLImageElement>('img.cdq-crest-img');
    expect(homeImg).not.toBeNull();
    expect(homeImg!.getAttribute('src')).toBe('http://gw/assets/crest:api-football:165');
    expect(homeBlock(host).querySelector('.cdq-crest')!.getAttribute('data-has-crest')).toBe('true');
    // The monogram is suppressed when a real badge shows.
    const mono = homeBlock(host).querySelector<HTMLElement>('.cdq-crest-mono');
    expect(mono!.hidden).toBe(true);

    const awayImg = awayBlock(host).querySelector<HTMLImageElement>('img.cdq-crest-img');
    expect(awayImg!.getAttribute('src')).toBe('http://gw/assets/crest:api-football:157');
  });

  it('falls back to the colour-block monogram when no crest is published', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(state());
    new SingleGameTemplate().mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
      crestResolver: stubResolver({}), // nothing published
    });

    const home = homeBlock(host);
    const img = home.querySelector<HTMLImageElement>('img.cdq-crest-img');
    // No real badge: either no img or a hidden one; the monogram carries the side.
    expect(img === null || img.hidden).toBe(true);
    expect(home.querySelector('.cdq-crest')!.hasAttribute('data-has-crest')).toBe(false);
    const mono = home.querySelector<HTMLElement>('.cdq-crest-mono');
    expect(mono!.hidden).toBe(false);
    expect(mono!.textContent).toBe('BOR'); // "Borussia Dortmund" → first 3 upper
  });

  it('still renders the "NAME N" data line for the e2e contract regardless of crest', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(state());
    new SingleGameTemplate().mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
      crestResolver: stubResolver({ 'Borussia Dortmund': 'http://gw/assets/x' }),
    });
    const full = homeBlock(host).querySelector<HTMLElement>('.cdq-team-full');
    expect(full!.textContent).toBe('Borussia Dortmund 2');
  });

  it('works with no crestResolver at all (legacy colour-block behaviour)', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot(state());
    new SingleGameTemplate().mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    const mono = homeBlock(host).querySelector<HTMLElement>('.cdq-crest-mono');
    expect(mono!.hidden).toBe(false);
    expect(mono!.textContent).toBe('BOR');
  });
});
