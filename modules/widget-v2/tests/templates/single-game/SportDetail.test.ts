/**
 * SPEC-CRWDQ-084 — the sport-detail registry + the football & baseball panels,
 * and the SingleGameTemplate's detail-region dispatch.
 *
 * Proves: the registry dispatches per sport (football/baseball registered,
 * others null); the soccer panel renders a timeline from events + the half/clock;
 * the baseball panel renders a line score + count + bases; the template mounts
 * the right panel and keeps all existing testids + the score bug.
 */
import { describe, it, expect } from 'vitest';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import {
  sportDetailPanel,
  registeredSports,
  FOOTBALL_TESTID,
  BASEBALL_TESTID,
} from '../../../src/templates/single-game/sport-detail/index';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameState, ProgramSlotPayload } from '../../../src/render/types';

class Journal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(e: RenderJournalEntry): void {
    this.entries.push(e);
  }
}

const slot = (id: string | null): ProgramSlotPayload => ({
  program_slot_id: 's', primary_game_id: id, game_ids: [], fixture_ids: [],
});

function mountWith(state: GameState): HTMLElement {
  const host = document.createElement('div');
  const store = new GameStateStore(new Journal());
  store.upsertSnapshot(state);
  new SingleGameTemplate().mount(host, {
    programSlot: slot(state.game_id),
    theme: { state: 'default' },
    gameStateStore: store,
  });
  return host;
}
const byId = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

describe('sport-detail registry dispatch', () => {
  it('registers football + baseball, returns null for unregistered sports', () => {
    expect(registeredSports()).toEqual(['baseball', 'football']);
    expect(sportDetailPanel('football')).not.toBeNull();
    expect(sportDetailPanel('baseball')).not.toBeNull();
    expect(sportDetailPanel('basketball')).toBeNull();
    expect(sportDetailPanel('hockey')).toBeNull();
    expect(sportDetailPanel(undefined)).toBeNull();
  });
});

describe('football detail panel', () => {
  const wcState: GameState = {
    game_id: 'wc',
    seq: 1,
    home_team: 'Argentina',
    away_team: 'France',
    home_score: 3,
    away_score: 3,
    sport_context: {
      sport: 'football',
      league: 'World Cup',
      period_clock: "80'",
      detail: { half: '2H', minute: 80, stoppage: 0, possession: { home: 54, away: 46 }, shots: { home: 12, away: 9 } },
    },
    timeline: [
      { seq: 0, kind: 'goal', clock: "23'", team: 'home', player: 'L. Messi' },
      { seq: 1, kind: 'goal', clock: "36'", team: 'home', player: 'Á. Di María' },
      { seq: 2, kind: 'card', clock: "31'", team: 'away', player: 'Dembélé', detail: 'yellow' },
      { seq: 3, kind: 'sub', clock: "41'", team: 'away', detail: 'Kolo Muani ◄ Giroud' },
      { seq: 4, kind: 'goal', clock: "80'", team: 'away', player: 'K. Mbappé' },
    ],
  };

  it('renders the event timeline with scorers, cards, and subs', () => {
    const host = mountWith(wcState);
    const tl = byId(host, FOOTBALL_TESTID.timeline);
    expect(tl).not.toBeNull();
    const text = tl!.textContent ?? '';
    expect(text).toContain('L. Messi');
    expect(text).toContain('Dembélé');
    expect(text).toContain('Kolo Muani');
    expect(text).toContain('K. Mbappé');
    // Rows carry the per-kind class so CSS can style goals/cards distinctly.
    expect(tl!.querySelector('.cdq-fb-goal')).not.toBeNull();
    expect(tl!.querySelector('.cdq-fb-card')).not.toBeNull();
    expect(tl!.querySelector('.cdq-fb-sub')).not.toBeNull();
  });

  it('renders the half/clock treatment', () => {
    const host = mountWith(wcState);
    const half = byId(host, FOOTBALL_TESTID.half);
    expect(half?.textContent).toContain('2ND HALF');
    expect(half?.textContent).toContain("80'");
  });

  it('renders the possession + shots stat strip when present', () => {
    const host = mountWith(wcState);
    const stats = byId(host, FOOTBALL_TESTID.stats);
    expect(stats?.hidden).toBe(false);
    expect(stats?.textContent).toContain('POSSESSION');
    expect(stats?.textContent).toContain('SHOTS');
    expect(stats?.textContent).toContain('54%');
  });

  it('keeps the existing shell testids + score bug (no regression)', () => {
    const host = mountWith(wcState);
    for (const id of [TESTID.root, TESTID.score, TESTID.homeTeam, TESTID.awayTeam, TESTID.clock, TESTID.overlay]) {
      expect(byId(host, id), id).not.toBeNull();
    }
    expect(host.querySelector('.cdq-score-home')?.textContent).toBe('3');
  });
});

describe('baseball detail panel', () => {
  const mlbState: GameState = {
    game_id: 'mlb',
    seq: 1,
    home_team: 'Chicago Cubs',
    away_team: 'Athletics',
    home_score: 7,
    away_score: 6,
    sport_context: {
      sport: 'baseball',
      league: 'MLB',
      period_clock: 'BOT 9',
      detail: {
        inning: 9,
        half: 'bottom',
        balls: 2,
        strikes: 1,
        outs: 1,
        bases: { first: true, second: false, third: true },
        lineScore: [
          { inning: 1, home: 1, away: 0 },
          { inning: 2, home: 0, away: 2 },
          { inning: 3, home: 2, away: 0 },
          { inning: 9, home: 1, away: 0 },
        ],
        hits: { home: 11, away: 9 },
        errors: { home: 0, away: 1 },
      },
    },
  };

  it('renders an inning line-score grid with R/H/E', () => {
    const host = mountWith(mlbState);
    const ls = byId(host, BASEBALL_TESTID.linescore);
    expect(ls).not.toBeNull();
    const text = ls!.textContent ?? '';
    expect(text).toContain('CHICAGO CUBS');
    expect(text).toContain('ATHLETICS');
    // R/H/E header.
    expect(text).toContain('R');
    expect(text).toContain('H');
    expect(text).toContain('E');
    // It has at least 9 inning columns in the header.
    const header = ls!.querySelector('tr.cdq-bb-head');
    expect(header!.querySelectorAll('.cdq-bb-inn').length).toBeGreaterThanOrEqual(9);
  });

  it('renders the current inning + top/bottom indicator', () => {
    const host = mountWith(mlbState);
    const inning = byId(host, BASEBALL_TESTID.inning);
    expect(inning?.hidden).toBe(false);
    expect(inning?.dataset['half']).toBe('bottom');
    expect(inning?.textContent).toContain('9');
  });

  it('renders the count (balls-strikes-outs)', () => {
    const host = mountWith(mlbState);
    const count = byId(host, BASEBALL_TESTID.count);
    expect(count?.hidden).toBe(false);
    const val = (k: string): string | undefined =>
      count!.querySelector<HTMLElement>(`.cdq-bb-count-cell[data-k="${k}"] .cdq-bb-count-val`)?.textContent ?? undefined;
    expect(val('B')).toBe('2');
    expect(val('S')).toBe('1');
    expect(val('O')).toBe('1');
  });

  it('renders the bases diamond with occupied bases', () => {
    const host = mountWith(mlbState);
    const bases = byId(host, BASEBALL_TESTID.bases);
    expect(bases?.hidden).toBe(false);
    const on = (p: string): boolean =>
      bases!.querySelector<HTMLElement>(`.cdq-bb-base[data-pos="${p}"]`)?.dataset['on'] === 'true';
    expect(on('first')).toBe(true);
    expect(on('second')).toBe(false);
    expect(on('third')).toBe(true);
  });

  it('a thin finished game renders just the line score (no count/bases)', () => {
    const host = mountWith({
      game_id: 'thin',
      seq: 1,
      home_team: 'A',
      away_team: 'B',
      home_score: 5,
      away_score: 4,
      sport_context: {
        sport: 'baseball',
        period_clock: 'FINAL',
        detail: { inning: 9, half: 'end', lineScore: [{ inning: 1, home: 1, away: 0 }] },
      },
    });
    expect(byId(host, BASEBALL_TESTID.linescore)).not.toBeNull();
    expect(byId(host, BASEBALL_TESTID.count)?.hidden).toBe(true);
    expect(byId(host, BASEBALL_TESTID.bases)?.hidden).toBe(true);
  });
});

describe('template detail dispatch', () => {
  it('mounts the football panel for a football game, not the baseball panel', () => {
    const host = mountWith({
      game_id: 'g', seq: 1, sport_context: { sport: 'football', period_clock: "10'", detail: { half: '1H', minute: 10 } },
      timeline: [{ seq: 0, kind: 'goal', clock: "5'", team: 'home', player: 'X' }],
    });
    expect(byId(host, FOOTBALL_TESTID.root)).not.toBeNull();
    expect(byId(host, BASEBALL_TESTID.root)).toBeNull();
  });

  it('renders shell-only (no detail panel) for an unregistered sport', () => {
    const host = mountWith({
      game_id: 'g', seq: 1, sport_context: { sport: 'basketball', period_clock: 'Q3 8:42' },
    });
    const detailHost = byId(host, TESTID.detail);
    expect(detailHost).not.toBeNull();
    expect(detailHost!.querySelector('.cdq-detail')).toBeNull(); // empty host
  });
});
