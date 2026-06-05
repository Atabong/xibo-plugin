/**
 * S26 — single_game template renders sport-appropriate scoreboards
 * (baseball / basketball / hockey / american_football) from sport_context,
 * without breaking football rendering. Branches on `sport_context.sport`.
 */
import { describe, it, expect } from 'vitest';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameState, ProgramSlotPayload } from '../../../src/render/types';

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

function mountWith(state: GameState): HTMLElement {
  const host = document.createElement('div');
  const store = new GameStateStore(new RecordingJournal());
  store.upsertSnapshot(state);
  new SingleGameTemplate().mount(host, {
    programSlot: slot(state.game_id),
    theme: { state: 'default' },
    gameStateStore: store,
  });
  return host;
}

const byTestId = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

describe('SingleGameTemplate sport-aware rendering (S26)', () => {
  it('baseball: renders runs + a TOP/BOT inning period label', () => {
    const host = mountWith({
      game_id: 'mlb1',
      seq: 1,
      home_team: 'Yankees',
      away_team: 'Red Sox',
      home_score: 3,
      away_score: 2,
      sport_context: { sport: 'baseball', league: 'MLB', period_clock: 'TOP 5 1 OUT' },
    });
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('Yankees');
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('3');
    // period label split out of "TOP 5 1 OUT" → period "TOP", clock "5 1 OUT"
    const clock = byTestId(host, TESTID.clock);
    expect(clock?.textContent).toContain('TOP');
    expect(clock?.textContent).toContain('5');
    // sport stamped on the root for CSS / assertions
    expect(host.querySelector('section.crowdaq-single-game')?.getAttribute('data-sport')).toBe(
      'baseball',
    );
    // context strap shows a friendly label + league
    expect(byTestId(host, TESTID.sportContext)?.textContent).toContain('MLB');
    expect(byTestId(host, TESTID.sportContext)?.textContent).toContain('Baseball');
  });

  it('basketball: renders points + a "Q3 8:42" period clock', () => {
    const host = mountWith({
      game_id: 'nba1',
      seq: 1,
      home_team: 'Lakers',
      away_team: 'Celtics',
      home_score: 78,
      away_score: 75,
      sport_context: { sport: 'basketball', league: 'NBA', period_clock: 'Q3 8:42' },
    });
    const clock = byTestId(host, TESTID.clock);
    expect(clock?.textContent).toContain('Q3');
    expect(clock?.textContent).toContain('8:42');
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('78');
  });

  it('hockey: renders a "P2 12:10" period clock', () => {
    const host = mountWith({
      game_id: 'nhl1',
      seq: 1,
      home_team: 'Oilers',
      away_team: 'Panthers',
      home_score: 2,
      away_score: 1,
      sport_context: { sport: 'hockey', league: 'NHL', period_clock: 'P2 12:10' },
    });
    const clock = byTestId(host, TESTID.clock);
    expect(clock?.textContent).toContain('P2');
    expect(clock?.textContent).toContain('12:10');
  });

  it('a score increase flashes the sport-appropriate word (RUN for baseball)', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot({
      game_id: 'mlb2',
      seq: 1,
      home_team: 'Yankees',
      away_team: 'Red Sox',
      home_score: 0,
      away_score: 0,
      sport_context: { sport: 'baseball', league: 'MLB', period_clock: 'TOP 1' },
    });
    new SingleGameTemplate().mount(host, {
      programSlot: slot('mlb2'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    store.applyEvent({ game_id: 'mlb2', seq: 2, home_score: 1, away_score: 0 });
    const word = host.querySelector('.cdq-goal-word');
    expect(word?.textContent).toBe('RUN');
  });

  it('football still renders GOAL on a score (no regression)', () => {
    const host = document.createElement('div');
    const store = new GameStateStore(new RecordingJournal());
    store.upsertSnapshot({
      game_id: 'epl1',
      seq: 1,
      home_team: 'Lions',
      away_team: 'Bears',
      home_score: 0,
      away_score: 0,
      sport_context: { sport: 'football', league: 'EPL', period_clock: "12'" },
    });
    new SingleGameTemplate().mount(host, {
      programSlot: slot('epl1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    store.applyEvent({ game_id: 'epl1', seq: 2, home_score: 1, away_score: 0 });
    expect(host.querySelector('.cdq-goal-word')?.textContent).toBe('GOAL');
  });
});
