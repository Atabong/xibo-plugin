/**
 * SPEC-CRWDQ-084 — HARD RENDER GATE (jsdom).
 *
 * Proves, in the FULL SingleGameTemplate mount (the same path the s58
 * escalateToSafe activator drives), that:
 *   1. mount NEVER throws for football / baseball / unknown sport (so it never
 *      escalates to safe_info instead of rendering rich — composes with s58);
 *   2. the soccer panel renders a NON-EMPTY event timeline (scorers/cards/subs)
 *      + half/stoppage;
 *   3. the baseball panel renders a NON-EMPTY inning line-score grid + count +
 *      bases;
 *   4. the CLOCK TICKS — the football minute advances between server frames
 *      (driven by the local GameClock) and re-syncs DOWN on a server frame
 *      (server wins);
 *   5. the baseball INNING advances on a server frame and the line-score grid
 *      FILLS as innings arrive (inning-by-inning, not a single final flash).
 */
import { describe, it, expect } from 'vitest';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import {
  FOOTBALL_TESTID,
  BASEBALL_TESTID,
} from '../../../src/templates/single-game/sport-detail/index';
import type { ClockTimer } from '../../../src/templates/single-game/GameClock';
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
const byId = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

/** A controllable clock timer for the GameClock; advance() fires due intervals. */
function fakeTimer(): ClockTimer & { advance: (ms: number) => void } {
  let now = 0;
  const ivs: Array<{ fn: () => void; ms: number; next: number }> = [];
  return {
    now: () => now,
    setInterval: (fn, ms) => { const e = { fn, ms, next: now + ms }; ivs.push(e); return e; },
    clearInterval: (h) => { const i = ivs.indexOf(h as { fn: () => void; ms: number; next: number }); if (i >= 0) ivs.splice(i, 1); },
    advance: (ms) => {
      const target = now + ms; let g = 0;
      while (g++ < 100000) {
        const due = ivs.filter((e) => e.next <= target).sort((a, b) => a.next - b.next)[0];
        if (!due) break; now = due.next; due.next += due.ms; due.fn();
      }
      now = target;
    },
  };
}

/** Mount the full template against a store, with an injectable clock timer.
 *  Returns the host + a `push` that upserts a new server frame. */
function mountLive(initial: GameState, timer?: ClockTimer): {
  host: HTMLElement;
  push: (s: GameState) => void;
  threw: boolean;
} {
  const host = document.createElement('div');
  const store = new GameStateStore(new Journal());
  store.upsertSnapshot(initial);
  let threw = false;
  try {
    new SingleGameTemplate().mount(host, {
      programSlot: slot(initial.game_id),
      theme: { state: 'default' },
      gameStateStore: store,
      ...(timer ? { clockTimer: timer } : {}),
    });
  } catch {
    threw = true;
  }
  return { host, threw, push: (s) => store.upsertSnapshot(s) };
}

const clockText = (host: HTMLElement): string => {
  const c = byId(host, TESTID.clock);
  return (c?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

describe('SPEC-CRWDQ-084 render gate — never throws (composes with s58 escalateToSafe)', () => {
  it('football mount does not throw + renders the rich panel', () => {
    const { host, threw } = mountLive({
      game_id: 'wc', seq: 1, home_team: 'Argentina', away_team: 'France',
      home_score: 2, away_score: 0,
      sport_context: { sport: 'football', league: 'World Cup', period_clock: "36'", detail: { half: '1H', minute: 36, stoppage: 0 } },
      timeline: [
        { seq: 0, kind: 'goal', clock: "23'", team: 'home', player: 'L. Messi' },
        { seq: 1, kind: 'goal', clock: "36'", team: 'home', player: 'Á. Di María' },
      ],
    });
    expect(threw).toBe(false);
    expect(byId(host, TESTID.root)).not.toBeNull();
    expect(byId(host, FOOTBALL_TESTID.root)).not.toBeNull();
  });

  it('baseball mount does not throw + renders the rich panel', () => {
    const { host, threw } = mountLive({
      game_id: 'mlb', seq: 1, home_team: 'Cubs', away_team: 'Athletics',
      home_score: 1, away_score: 0,
      sport_context: { sport: 'baseball', league: 'MLB', period_clock: 'BOT 1', detail: { inning: 1, half: 'bottom', lineScore: [{ inning: 1, home: 1, away: 0 }] } },
    });
    expect(threw).toBe(false);
    expect(byId(host, BASEBALL_TESTID.root)).not.toBeNull();
  });

  it('unknown sport mount does not throw (shell-only, never blank-by-exception)', () => {
    const { host, threw } = mountLive({
      game_id: 'x', seq: 1, sport_context: { sport: 'cricket', period_clock: 'OVER 12' },
    });
    expect(threw).toBe(false);
    expect(byId(host, TESTID.root)).not.toBeNull();
  });
});

describe('SPEC-CRWDQ-084 render gate — soccer timeline + half is NON-EMPTY', () => {
  it('renders timeline rows for scorers/cards/subs with text', () => {
    const { host } = mountLive({
      game_id: 'wc', seq: 1, home_team: 'Argentina', away_team: 'France', home_score: 2, away_score: 1,
      sport_context: { sport: 'football', period_clock: "64'", detail: { half: '2H', minute: 64, stoppage: 0 } },
      timeline: [
        { seq: 0, kind: 'goal', clock: "23'", team: 'home', player: 'L. Messi' },
        { seq: 1, kind: 'card', clock: "31'", team: 'away', player: 'Dembélé', detail: 'yellow' },
        { seq: 2, kind: 'sub', clock: "41'", team: 'away', detail: 'Kolo Muani ◄ Giroud' },
      ],
    });
    const tl = byId(host, FOOTBALL_TESTID.timeline)!;
    expect(tl.children.length).toBeGreaterThanOrEqual(3);
    const text = tl.textContent ?? '';
    expect(text).toContain('L. Messi');
    expect(text).toContain('Dembélé');
    expect(text).toContain('Kolo Muani');
    // half + stoppage treatment present + non-empty
    const half = byId(host, FOOTBALL_TESTID.half)!;
    expect((half.textContent ?? '').length).toBeGreaterThan(0);
    expect(half.textContent).toContain('2ND HALF');
  });

  it('renders stoppage time (45+2)', () => {
    const { host } = mountLive({
      game_id: 'wc', seq: 1, sport_context: { sport: 'football', period_clock: "45+2'", detail: { half: '1H', minute: 45, stoppage: 2 } },
      timeline: [{ seq: 0, kind: 'goal', clock: "45+1'", team: 'home', player: 'X' }],
    });
    expect(byId(host, FOOTBALL_TESTID.half)!.textContent).toContain("45+2'");
  });
});

describe('SPEC-CRWDQ-084 render gate — baseball line-score + count/bases NON-EMPTY', () => {
  it('renders the inning grid with multiple innings + count + bases', () => {
    const { host } = mountLive({
      game_id: 'mlb', seq: 1, home_team: 'Cubs', away_team: 'Athletics', home_score: 4, away_score: 3,
      sport_context: { sport: 'baseball', period_clock: 'BOT 7', detail: {
        inning: 7, half: 'bottom', balls: 2, strikes: 1, outs: 1,
        bases: { first: true, second: false, third: true },
        lineScore: [
          { inning: 1, home: 1, away: 0 }, { inning: 2, home: 0, away: 2 },
          { inning: 3, home: 2, away: 0 }, { inning: 7, home: 1, away: 1 },
        ],
        hits: { home: 8, away: 6 }, errors: { home: 0, away: 1 },
      } },
    });
    const grid = byId(host, BASEBALL_TESTID.linescore)!;
    expect(grid.querySelectorAll('.cdq-bb-inn').length).toBeGreaterThanOrEqual(9);
    expect(grid.querySelectorAll('tr.cdq-bb-row').length).toBe(2);
    expect(grid.textContent).toContain('CUBS');
    // count
    const cnt = byId(host, BASEBALL_TESTID.count)!;
    expect(cnt.hidden).toBe(false);
    expect(cnt.querySelector('.cdq-bb-count-cell[data-k="B"] .cdq-bb-count-val')!.textContent).toBe('2');
    // bases occupied
    const bases = byId(host, BASEBALL_TESTID.bases)!;
    expect(bases.querySelector('.cdq-bb-base[data-pos="first"]')!.getAttribute('data-on')).toBe('true');
    expect(bases.querySelector('.cdq-bb-base[data-pos="third"]')!.getAttribute('data-on')).toBe('true');
  });
});

describe('SPEC-CRWDQ-084 render gate — the CLOCK TICKS (the headline requirement)', () => {
  it('football minute advances between server frames, then re-syncs DOWN on a server frame', () => {
    const t = fakeTimer();
    const { host, push } = mountLive({
      game_id: 'wc', seq: 1, sport_context: { sport: 'football', period_clock: "10'", detail: { half: '1H', minute: 10 } },
    }, t);
    // Calibrate the local clock rate with a second authoritative frame 1s later
    // (≈ replay speed): minute 10' → 11' over 1000ms.
    t.advance(1000);
    push({ game_id: 'wc', seq: 2, sport_context: { sport: 'football', period_clock: "11'", detail: { half: '1H', minute: 11 } } });
    const t0 = clockText(host);
    // Now advance wall time with NO new server frame — the clock must TICK FORWARD.
    t.advance(3000);
    const t1 = clockText(host);
    const m0 = Number((t0.match(/(\d+)/) ?? [])[1]);
    const m1 = Number((t1.match(/(\d+)/) ?? [])[1]);
    expect(m1).toBeGreaterThan(m0); // the displayed minute MOVED between frames
    // A new server frame re-syncs the clock (server wins) — snap back to 13'.
    push({ game_id: 'wc', seq: 3, sport_context: { sport: 'football', period_clock: "13'", detail: { half: '1H', minute: 13 } } });
    expect(Number((clockText(host).match(/(\d+)/) ?? [])[1])).toBe(13);
  });

  it('clamps at HALF TIME — does not tick past HT', () => {
    const t = fakeTimer();
    const { host } = mountLive({
      game_id: 'wc', seq: 1, status: 'halftime',
      sport_context: { sport: 'football', period_clock: 'HT', detail: { half: 'HT' } },
    }, t);
    const before = clockText(host);
    t.advance(20000);
    expect(clockText(host)).toBe(before); // frozen at HT
    expect(clockText(host)).toContain('HT');
  });

  it('clamps at FULL TIME — does not tick past FT', () => {
    const t = fakeTimer();
    const { host } = mountLive({
      game_id: 'wc', seq: 1, status: 'final',
      sport_context: { sport: 'football', period_clock: 'FT' },
    }, t);
    t.advance(20000);
    expect(clockText(host)).toContain('FT');
  });
});

describe('SPEC-CRWDQ-084 render gate — baseball innings PROGRESS (no flash)', () => {
  it('inning advances + the line-score grid FILLS as server frames arrive', () => {
    const { host, push } = mountLive({
      game_id: 'mlb', seq: 1, home_team: 'Cubs', away_team: 'Athletics', home_score: 0, away_score: 0,
      sport_context: { sport: 'baseball', period_clock: 'TOP 1', detail: { inning: 1, half: 'top', lineScore: [{ inning: 1, home: null, away: 0 }] } },
    });
    const filledCells = (): number =>
      Array.from(byId(host, BASEBALL_TESTID.linescore)!.querySelectorAll('.cdq-bb-cell'))
        .filter((c) => (c.textContent ?? '').trim() !== '').length;
    const inningNum = (): string => byId(host, BASEBALL_TESTID.inning)!.textContent ?? '';
    const c1 = filledCells();
    // Inning 3 arrives — score built up, more cells filled.
    push({ game_id: 'mlb', seq: 2, home_team: 'Cubs', away_team: 'Athletics', home_score: 1, away_score: 2,
      sport_context: { sport: 'baseball', period_clock: 'BOT 3', detail: { inning: 3, half: 'bottom', lineScore: [
        { inning: 1, home: 0, away: 1 }, { inning: 2, home: 0, away: 1 }, { inning: 3, home: 1, away: 0 } ] } } });
    expect(inningNum()).toContain('3');
    expect(filledCells()).toBeGreaterThan(c1); // grid FILLED inning-by-inning
    // Inning 9 final — even more filled, score climbed (not a 0-0→final flash).
    push({ game_id: 'mlb', seq: 3, home_team: 'Cubs', away_team: 'Athletics', home_score: 7, away_score: 6,
      sport_context: { sport: 'baseball', period_clock: 'BOT 9', detail: { inning: 9, half: 'end', lineScore: [
        { inning: 1, home: 0, away: 1 }, { inning: 2, home: 0, away: 1 }, { inning: 3, home: 1, away: 0 },
        { inning: 4, home: 2, away: 1 }, { inning: 9, home: 1, away: 0 } ] } } });
    expect(inningNum()).toContain('9');
    expect(byId(host, BASEBALL_TESTID.linescore)!.textContent).toContain('CUBS');
  });
});
