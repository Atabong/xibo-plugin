/**
 * SPEC-CRWDQ-023 — the `single_game` business-mode template (D-GRH-30 #1).
 *
 * `mount(host, ctx)` renders the single-game DOM into `host` and subscribes to
 * the `GameStateStore` for the slot's `primary_game_id` (read from the
 * ProgramSlot — NEVER from the PlannedState, per D-GRH-21 / AC7). Each applied
 * GameState change re-renders the score/clock/overlay IN PLACE (no transition;
 * transitions run only on PlannedState swap). The returned instance's
 * `detach()` unsubscribes and hands back the outgoing DOM node for the
 * supersede transition.
 *
 * DOM (AC1): one `<section class="crowdaq-single-game" data-theme="…">` with a
 * sport-context header, a home/away/clock score block, and a last-moment
 * overlay — each sub-region tagged with a `data-testid`. No multi-game grid,
 * ad panel, or fixture card (AC: those are other templates' DOM).
 */
import type { GameStateStore } from '../../render/GameStateStore';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { GameState, ProgramSlotPayload } from '../../render/types';

/** Stable test ids for the template's sub-regions (AC1). */
export const TESTID = {
  root: 'single-game-root',
  sportContext: 'single-game-sport-context',
  score: 'single-game-score',
  homeTeam: 'single-game-home',
  awayTeam: 'single-game-away',
  clock: 'single-game-clock',
  overlay: 'single-game-overlay',
  placeholder: 'single-game-no-live',
} as const;

/** Default last-moment cap (existing widget convention). */
const DEFAULT_MAX_MOMENT_LENGTH = 140;

export interface SingleGameContext {
  /** Resolved ProgramSlot — the SINGLE source of `primary_game_id` (AC7). */
  programSlot: ProgramSlotPayload;
  /** Resolved theme for the `data-theme` attribute (SPEC theme resolution). */
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
  /** Last-moment text cap; defaults to the existing widget convention. */
  maxMomentLength?: number;
}

export interface SingleGameInstance {
  /** Unsubscribe from GameState and return the DOM node for the outgoing transition. */
  detach(): HTMLElement;
}

export class SingleGameTemplate {
  /** Mount the template, subscribing to the slot's primary game. */
  mount(host: HTMLElement, ctx: SingleGameContext): SingleGameInstance {
    const maxMoment = ctx.maxMomentLength ?? DEFAULT_MAX_MOMENT_LENGTH;
    const root = buildRoot(themeAttr(ctx.theme));
    host.appendChild(root);

    // AC7: the rendered game id is the ProgramSlot's primary_game_id only.
    const gameId = ctx.programSlot.primary_game_id;
    let unsubscribe = (): void => {};

    if (gameId === null) {
      // No live game referenced — the "no live game" placeholder. The activator
      // (not the template) owns the fallback journal; the template only renders.
      renderPlaceholder(root);
    } else {
      const render = (state: GameState | null): void => renderGame(root, state, maxMoment);
      render(ctx.gameStateStore.get(gameId));
      unsubscribe = ctx.gameStateStore.subscribe(gameId, (state) => render(state));
    }

    return {
      detach(): HTMLElement {
        unsubscribe();
        root.remove();
        return root;
      },
    };
  }
}

/** Build the empty template skeleton with all sub-region test ids. */
function buildRoot(themeAttrValue: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'crowdaq-single-game';
  root.dataset['theme'] = themeAttrValue;
  root.dataset['testid'] = TESTID.root;

  const header = document.createElement('header');
  header.className = 'cdq-sport-context';
  header.dataset['testid'] = TESTID.sportContext;

  const score = document.createElement('div');
  score.className = 'cdq-score';
  score.dataset['testid'] = TESTID.score;

  const home = document.createElement('div');
  home.className = 'cdq-team cdq-home';
  home.dataset['testid'] = TESTID.homeTeam;

  const clock = document.createElement('div');
  clock.className = 'cdq-clock';
  clock.dataset['testid'] = TESTID.clock;

  const away = document.createElement('div');
  away.className = 'cdq-team cdq-away';
  away.dataset['testid'] = TESTID.awayTeam;

  score.append(home, clock, away);

  const overlay = document.createElement('aside');
  overlay.className = 'cdq-overlay';
  overlay.dataset['testid'] = TESTID.overlay;
  overlay.hidden = true;

  root.append(header, score, overlay);
  return root;
}

/** Render the "no live game" placeholder (AC5 authoring-error path). */
function renderPlaceholder(root: HTMLElement): void {
  const placeholder = document.createElement('div');
  placeholder.className = 'cdq-no-live-game';
  placeholder.dataset['testid'] = TESTID.placeholder;
  placeholder.textContent = 'No live game';
  root.append(placeholder);
}

/** Populate the score / clock / sport-context / overlay from current state. */
function renderGame(root: HTMLElement, state: GameState | null, maxMoment: number): void {
  const sel = (testid: string): HTMLElement | null =>
    root.querySelector(`[data-testid="${testid}"]`);

  const header = sel(TESTID.sportContext);
  if (header) {
    const ctx = state?.sport_context;
    const parts = [ctx?.sport, ctx?.league, ctx?.venue].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    header.textContent = parts.join(' · ');
  }

  const home = sel(TESTID.homeTeam);
  if (home) home.textContent = teamLine(state?.home_team, state?.home_score);

  const away = sel(TESTID.awayTeam);
  if (away) away.textContent = teamLine(state?.away_team, state?.away_score);

  const clock = sel(TESTID.clock);
  if (clock) clock.textContent = state?.sport_context?.period_clock ?? '';

  const overlay = sel(TESTID.overlay);
  if (overlay) {
    const moment = state?.last_moment;
    if (typeof moment === 'string' && moment.length > 0) {
      overlay.textContent = moment.slice(0, maxMoment);
      overlay.hidden = false;
    } else {
      overlay.textContent = '';
      overlay.hidden = true;
    }
  }
}

/** A team line: "Name Score", with blanks where the state has no value. */
function teamLine(name: string | undefined, score: number | undefined): string {
  const n = name ?? '';
  const s = score === undefined ? '' : String(score);
  return `${n} ${s}`.trim();
}
