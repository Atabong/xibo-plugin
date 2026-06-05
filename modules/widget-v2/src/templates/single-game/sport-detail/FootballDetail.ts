/**
 * SPEC-CRWDQ-084 — the SOCCER (football) detail panel.
 *
 * Renders the rich data a soccer broadcast shows that the bare score bug hides:
 *   - a broadcast-style EVENT TIMELINE (goals ⚽ w/ scorer, cards 🟨🟥 w/ player,
 *     subs 🔁 in◄out, VAR, penalties 🅿️) down a strip, newest first, capped so
 *     it stays readable on a bar TV (no dense table),
 *   - a HALF / CLOCK treatment (1H / HT / 2H / ET / PEN + minute & stoppage),
 *   - a POSSESSION + SHOTS stat strip when the feed carries them.
 *
 * Reads ONLY `state.timeline` + `state.sport_context.detail` (FootballDetail) —
 * decoupled from the shell. Re-paints in place on every applied GameState.
 */
import type { FootballDetail, GameState, GameTimelineEntry } from '../../../render/types';
import type { SportDetailInstance, SportDetailPanel } from './registry';

/** Stable test ids for the football detail sub-regions. */
export const FOOTBALL_TESTID = {
  root: 'sg-detail-football',
  half: 'sg-detail-football-half',
  timeline: 'sg-detail-football-timeline',
  stats: 'sg-detail-football-stats',
} as const;

/** How many timeline rows to show (newest first) — broadcast-readable. */
const MAX_ROWS = 6;

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

/** Emoji glyph for a timeline kind. */
function glyph(entry: GameTimelineEntry): string {
  switch (entry.kind) {
    case 'goal':
      return '⚽';
    case 'card':
      return entry.detail === 'red' ? '🟥' : '🟨';
    case 'sub':
      return '🔁';
    case 'penalty':
      return '🅿️';
    case 'var':
      return 'VAR';
    default:
      return '•';
  }
}

/** The readable label for a timeline row (player / sub text / VAR note). */
function rowText(entry: GameTimelineEntry): string {
  switch (entry.kind) {
    case 'sub':
      return entry.detail ?? entry.player ?? 'Substitution';
    case 'var':
      return entry.detail ?? 'VAR check';
    case 'penalty':
      return `${entry.player ?? 'Penalty'}${entry.detail ? ` (${entry.detail})` : ''}`;
    default:
      return entry.player ?? entry.kind.toUpperCase();
  }
}

/** Human half label for the half pill. */
function halfLabel(d: FootballDetail | undefined): string {
  switch (d?.half) {
    case '1H':
      return '1ST HALF';
    case '2H':
      return '2ND HALF';
    case 'HT':
      return 'HALF TIME';
    case 'ET':
      return 'EXTRA TIME';
    case 'PEN':
      return 'PENALTIES';
    default:
      return '';
  }
}

export const FootballDetailPanel: SportDetailPanel = {
  mount(host: HTMLElement): SportDetailInstance {
    const root = div('cdq-detail cdq-detail-football');
    root.dataset['testid'] = FOOTBALL_TESTID.root;

    const half = div('cdq-fb-half');
    half.dataset['testid'] = FOOTBALL_TESTID.half;
    half.append(span('cdq-fb-half-label'), span('cdq-fb-half-clock'));

    const timeline = document.createElement('ol');
    timeline.className = 'cdq-fb-timeline';
    timeline.dataset['testid'] = FOOTBALL_TESTID.timeline;

    const stats = div('cdq-fb-stats');
    stats.dataset['testid'] = FOOTBALL_TESTID.stats;
    stats.hidden = true;

    root.append(half, timeline, stats);
    host.append(root);

    return {
      update(state: GameState | null): void {
        const d = state?.sport_context?.detail as FootballDetail | undefined;

        // ---- half / clock treatment --------------------------------------
        const labelEl = half.querySelector<HTMLElement>('.cdq-fb-half-label');
        const clockEl = half.querySelector<HTMLElement>('.cdq-fb-half-clock');
        const label = halfLabel(d);
        if (labelEl) labelEl.textContent = label;
        if (clockEl) {
          if (d?.half === 'HT' || d?.half === 'PEN') {
            clockEl.textContent = '';
          } else if (typeof d?.minute === 'number') {
            const stop = d.stoppage && d.stoppage > 0 ? `+${d.stoppage}` : '';
            clockEl.textContent = `${d.minute}${stop}'`;
          } else {
            clockEl.textContent = '';
          }
        }
        half.hidden = label.length === 0 && !d?.minute;

        // ---- event timeline (newest first, capped) -----------------------
        const rows = (state?.timeline ?? [])
          .filter((e) => e.kind !== 'inning' && e.kind !== 'score')
          .slice(-MAX_ROWS)
          .reverse();
        timeline.replaceChildren();
        for (const entry of rows) {
          const li = document.createElement('li');
          li.className = `cdq-fb-row cdq-fb-${entry.kind}`;
          if (entry.team) li.dataset['team'] = entry.team;
          const min = span('cdq-fb-min');
          min.textContent = entry.clock ?? '';
          const g = span('cdq-fb-glyph');
          g.textContent = glyph(entry);
          const txt = span('cdq-fb-text');
          txt.textContent = rowText(entry);
          li.append(min, g, txt);
          timeline.append(li);
        }
        timeline.hidden = rows.length === 0;

        // ---- possession + shots stat strip -------------------------------
        if (d?.possession || d?.shots) {
          stats.replaceChildren();
          if (d.possession) {
            stats.append(statBar('POSSESSION', d.possession.home, d.possession.away, true));
          }
          if (d.shots) {
            stats.append(statBar('SHOTS', d.shots.home, d.shots.away, false));
          }
          stats.hidden = false;
        } else {
          stats.hidden = true;
        }
      },
    };
  },
};

/** A home-vs-away stat row (a split bar for possession, counts for shots). */
function statBar(label: string, home: number, away: number, asBar: boolean): HTMLElement {
  const row = div('cdq-fb-stat');
  const h = span('cdq-fb-stat-home');
  h.textContent = asBar ? `${home}%` : String(home);
  const l = span('cdq-fb-stat-label');
  l.textContent = label;
  const a = span('cdq-fb-stat-away');
  a.textContent = asBar ? `${away}%` : String(away);
  if (asBar) {
    const total = home + away || 1;
    row.style.setProperty('--home-pct', `${(home / total) * 100}%`);
  }
  row.append(h, l, a);
  return row;
}
