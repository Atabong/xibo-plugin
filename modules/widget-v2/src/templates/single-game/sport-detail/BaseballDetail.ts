/**
 * SPEC-CRWDQ-084 — the BASEBALL detail panel.
 *
 * Renders the rich data a baseball scorebug shows:
 *   - an INNING LINE-SCORE GRID (innings across the top, a row per side, with
 *     R / H / E totals on the right),
 *   - a CURRENT INNING + TOP/BOTTOM indicator (▲ top, ▼ bottom),
 *   - a COUNT (balls–strikes–outs) when the feed carries it,
 *   - a BASES DIAMOND showing occupied bases when known.
 *
 * Reads ONLY `state.sport_context.detail` (BaseballDetail) + scores — decoupled
 * from the shell. Re-paints in place on every applied GameState. A thin
 * backfilled game (final line score only) renders just the grid, which is fine.
 */
import type { BaseballDetail, GameState } from '../../../render/types';
import type { SportDetailInstance, SportDetailPanel } from './registry';

export const BASEBALL_TESTID = {
  root: 'sg-detail-baseball',
  linescore: 'sg-detail-baseball-linescore',
  inning: 'sg-detail-baseball-inning',
  count: 'sg-detail-baseball-count',
  bases: 'sg-detail-baseball-bases',
} as const;

function div(cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}
function span(cls: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  return el;
}

/** Sum a side's line-score runs (R column) — null cells count as 0. */
function runsFromLine(line: BaseballDetail['lineScore'], side: 'home' | 'away'): number {
  return (line ?? []).reduce((acc, c) => acc + (c[side] ?? 0), 0);
}

export const BaseballDetailPanel: SportDetailPanel = {
  mount(host: HTMLElement): SportDetailInstance {
    const root = div('cdq-detail cdq-detail-baseball');
    root.dataset['testid'] = BASEBALL_TESTID.root;

    // Line-score grid (a <table> for clean column alignment).
    const grid = document.createElement('table');
    grid.className = 'cdq-bb-linescore';
    grid.dataset['testid'] = BASEBALL_TESTID.linescore;

    // Right rail: inning indicator + count + bases diamond.
    const rail = div('cdq-bb-rail');

    const inning = div('cdq-bb-inning');
    inning.dataset['testid'] = BASEBALL_TESTID.inning;
    inning.append(span('cdq-bb-inning-arrow'), span('cdq-bb-inning-num'));

    const count = div('cdq-bb-count');
    count.dataset['testid'] = BASEBALL_TESTID.count;
    count.append(countCell('B'), countCell('S'), countCell('O'));

    const bases = div('cdq-bb-bases');
    bases.dataset['testid'] = BASEBALL_TESTID.bases;
    bases.append(baseDot('second'), baseDot('third'), baseDot('first'), baseDot('home'));

    rail.append(inning, count, bases);
    root.append(grid, rail);
    host.append(root);

    return {
      update(state: GameState | null): void {
        const d = (state?.sport_context?.detail as BaseballDetail | undefined) ?? {};
        const line = d.lineScore ?? [];

        // ---- line-score grid ---------------------------------------------
        renderGrid(grid, state, d, line);

        // ---- current inning + top/bottom ---------------------------------
        const arrow = inning.querySelector<HTMLElement>('.cdq-bb-inning-arrow');
        const num = inning.querySelector<HTMLElement>('.cdq-bb-inning-num');
        const half = d.half;
        if (arrow) arrow.textContent = half === 'bottom' ? '▼' : half === 'top' ? '▲' : '●';
        if (num) num.textContent = d.inning ? `${ordinal(d.inning)}` : '';
        inning.hidden = !d.inning;
        if (half === 'top') inning.dataset['half'] = 'top';
        else if (half === 'bottom') inning.dataset['half'] = 'bottom';
        else delete inning.dataset['half'];

        // ---- count (B-S-O) -----------------------------------------------
        const hasCount =
          d.balls !== undefined || d.strikes !== undefined || d.outs !== undefined;
        setCount(count, 'B', d.balls);
        setCount(count, 'S', d.strikes);
        setCount(count, 'O', d.outs);
        count.hidden = !hasCount;

        // ---- bases diamond -----------------------------------------------
        const b = d.bases;
        setBase(bases, 'first', b?.first);
        setBase(bases, 'second', b?.second);
        setBase(bases, 'third', b?.third);
        bases.hidden = !b;
      },
    };
  },
};

/** Build the inning-by-inning grid: header row of innings + R/H/E, a row/side. */
function renderGrid(
  grid: HTMLTableElement,
  state: GameState | null,
  d: BaseballDetail,
  line: NonNullable<BaseballDetail['lineScore']>,
): void {
  const innings = line.map((c) => c.inning).sort((a, b) => a - b);
  const maxInning = Math.max(d.inning ?? 0, innings[innings.length - 1] ?? 0, 9);
  grid.replaceChildren();

  const head = grid.insertRow();
  head.className = 'cdq-bb-head';
  head.insertCell().textContent = ''; // team-name corner
  for (let i = 1; i <= maxInning; i += 1) {
    const c = head.insertCell();
    c.className = 'cdq-bb-inn';
    c.textContent = String(i);
  }
  for (const k of ['R', 'H', 'E']) {
    const c = head.insertCell();
    c.className = 'cdq-bb-total-head';
    c.textContent = k;
  }

  const awayR = runsFromLine(line, 'away');
  const homeR = runsFromLine(line, 'home');
  addSideRow(
    grid,
    state?.away_team ?? 'AWAY',
    'away',
    line,
    maxInning,
    state?.away_score ?? awayR,
    d.hits?.away,
    d.errors?.away,
  );
  addSideRow(
    grid,
    state?.home_team ?? 'HOME',
    'home',
    line,
    maxInning,
    state?.home_score ?? homeR,
    d.hits?.home,
    d.errors?.home,
  );
}

function addSideRow(
  grid: HTMLTableElement,
  name: string,
  side: 'home' | 'away',
  line: NonNullable<BaseballDetail['lineScore']>,
  maxInning: number,
  runs: number,
  hits: number | undefined,
  errors: number | undefined,
): void {
  const row = grid.insertRow();
  row.className = `cdq-bb-row cdq-bb-${side}`;
  const nameCell = row.insertCell();
  nameCell.className = 'cdq-bb-team';
  nameCell.textContent = (name || side).slice(0, 14).toUpperCase();
  for (let i = 1; i <= maxInning; i += 1) {
    const cell = row.insertCell();
    cell.className = 'cdq-bb-cell';
    const c = line.find((e) => e.inning === i);
    const v = c ? c[side] : null;
    cell.textContent = v === null || v === undefined ? '' : String(v);
  }
  const r = row.insertCell();
  r.className = 'cdq-bb-total cdq-bb-r';
  r.textContent = String(runs);
  const h = row.insertCell();
  h.className = 'cdq-bb-total';
  h.textContent = hits === undefined ? '–' : String(hits);
  const e = row.insertCell();
  e.className = 'cdq-bb-total';
  e.textContent = errors === undefined ? '–' : String(errors);
}

function countCell(label: 'B' | 'S' | 'O'): HTMLElement {
  const cell = div('cdq-bb-count-cell');
  cell.dataset['k'] = label;
  const l = span('cdq-bb-count-label');
  l.textContent = label;
  const v = span('cdq-bb-count-val');
  v.textContent = '';
  cell.append(l, v);
  return cell;
}

function setCount(count: HTMLElement, label: 'B' | 'S' | 'O', val: number | undefined): void {
  const cell = count.querySelector<HTMLElement>(`.cdq-bb-count-cell[data-k="${label}"] .cdq-bb-count-val`);
  if (cell) cell.textContent = val === undefined ? '–' : String(val);
}

function baseDot(pos: 'first' | 'second' | 'third' | 'home'): HTMLElement {
  const dot = div('cdq-bb-base');
  dot.dataset['pos'] = pos;
  return dot;
}

function setBase(bases: HTMLElement, pos: 'first' | 'second' | 'third', on: boolean | undefined): void {
  const dot = bases.querySelector<HTMLElement>(`.cdq-bb-base[data-pos="${pos}"]`);
  if (dot) {
    if (on) dot.dataset['on'] = 'true';
    else delete dot.dataset['on'];
  }
}

/** 1 → 1ST, 2 → 2ND, 3 → 3RD, n → nTH. */
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
