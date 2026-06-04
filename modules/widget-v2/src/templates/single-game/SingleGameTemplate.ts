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
 * S9 broadcast redesign: the DOM is now a real on-air score bug — a league /
 * competition bar, two team blocks (a team-colour crest stack + a strong
 * typographic team treatment, since the wire carries no logo/colour data —
 * the colour is DERIVED deterministically from the team code), a big tabular
 * score, a clock + period pill, and a live excitement/momentum meter. A score
 * increase drives a CSS-only PUNCH + flash + a transient "GOAL" moment on the
 * scoring side. All sub-regions keep their stable `data-testid` so the existing
 * e2e + non-regression assertions hold (home/away lines still read "NAME N").
 *
 * DOM (AC1): one `<section class="crowdaq-single-game" data-theme="…">` with a
 * sport-context header, a home/away/clock score block, and a last-moment
 * overlay — each sub-region tagged with a `data-testid`. No multi-game grid,
 * ad panel, or fixture card (AC: those are other templates' DOM).
 */
import type { GameStateStore } from '../../render/GameStateStore';
import type { TemplateInstance } from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { GameState, ProgramSlotPayload } from '../../render/types';
import type { CrestResolver } from '../../render/CrestResolver';

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

/** How long the GOAL punch / banner stays on screen after a score change (ms). */
const GOAL_FLASH_MS = 4200;

export interface SingleGameContext {
  /** Resolved ProgramSlot — the SINGLE source of `primary_game_id` (AC7). */
  programSlot: ProgramSlotPayload;
  /** Resolved theme for the `data-theme` attribute (SPEC theme resolution). */
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
  /** Last-moment text cap; defaults to the existing widget convention. */
  maxMomentLength?: number;
  /**
   * SPEC-CRWDQ-S11 — resolve a real club crest from the AssetManifest by team.
   * When present and the team's crest is published + warmed, the team block
   * renders the real badge IMAGE; otherwise it falls back to the existing
   * derived-colour monogram block (never a broken image). Optional so existing
   * callers/tests that don't pass it keep the colour-block behaviour.
   */
  crestResolver?: CrestResolver;
}

/**
 * The bare single_game instance. It satisfies the shared `TemplateInstance`
 * contract but deliberately leaves `reconcile?` UNimplemented (AC3): single_game
 * content has no sub-element transitions, so D-GRH-13 in-place revisions reach
 * it through the `GameStateStore` subscription, not the reconcile hook. The
 * activator treats the absent hook as `hook_not_implemented` (AC4).
 */
export type SingleGameInstance = TemplateInstance;

/** Per-mount mutable render state the score-change detector reads. */
interface RenderMemo {
  homeScore: number | null;
  awayScore: number | null;
  goalTimer: ReturnType<typeof setTimeout> | null;
}

export class SingleGameTemplate {
  /** Mount the template, subscribing to the slot's primary game. */
  mount(host: HTMLElement, ctx: SingleGameContext): SingleGameInstance {
    const maxMoment = ctx.maxMomentLength ?? DEFAULT_MAX_MOMENT_LENGTH;
    const root = buildRoot(themeAttr(ctx.theme));
    host.appendChild(root);

    // AC7: the rendered game id is the ProgramSlot's primary_game_id only.
    const gameId = ctx.programSlot.primary_game_id;
    const memo: RenderMemo = { homeScore: null, awayScore: null, goalTimer: null };
    let unsubscribe = (): void => {};
    let unsubCrest = (): void => {};

    if (gameId === null) {
      // No live game referenced — the "no live game" placeholder. The activator
      // (not the template) owns the fallback journal; the template only renders.
      renderPlaceholder(root);
    } else {
      const render = (state: GameState | null): void =>
        renderGame(root, state, maxMoment, memo, ctx.crestResolver);
      render(ctx.gameStateStore.get(gameId));
      unsubscribe = ctx.gameStateStore.subscribe(gameId, (state) => render(state));
      // SPEC-CRWDQ-S11 — when a crest warms (async, best-effort), re-paint so
      // the real badge swaps in over the colour block (no new GameState needed).
      if (ctx.crestResolver) {
        unsubCrest = ctx.crestResolver.onCrestReady(() =>
          render(ctx.gameStateStore.get(gameId)),
        );
      }
    }

    return {
      detach(): HTMLElement {
        unsubscribe();
        unsubCrest();
        if (memo.goalTimer !== null) clearTimeout(memo.goalTimer);
        root.remove();
        return root;
      },
    };
  }
}

/**
 * Build the broadcast score-bug skeleton with all sub-region test ids. The
 * structure is data-light by default — populated in place by renderGame() —
 * so it satisfies AC1 (one section + the tagged sub-regions) while carrying
 * the new on-air chrome (league bar, crest stacks, excitement meter, banner).
 */
function buildRoot(themeAttrValue: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'crowdaq-single-game';
  root.dataset['theme'] = themeAttrValue;
  root.dataset['testid'] = TESTID.root;

  // Atmospheric depth layers (CSS paints gradient mesh + grain + vignette).
  root.append(div('cdq-bg-mesh'), div('cdq-bg-grain'), div('cdq-bg-vignette'));

  // League / competition bar (top) — the on-air strap line.
  const header = document.createElement('header');
  header.className = 'cdq-sport-context';
  header.dataset['testid'] = TESTID.sportContext;
  header.append(span('cdq-live-dot'), span('cdq-context-text'));

  // The scoreboard plate: home block · score column · away block.
  const score = document.createElement('div');
  score.className = 'cdq-score';
  score.dataset['testid'] = TESTID.score;

  const home = buildTeamBlock('home');
  home.dataset['testid'] = TESTID.homeTeam;

  const center = div('cdq-score-center');
  const scoreNums = div('cdq-score-nums');
  scoreNums.append(span('cdq-score-home'), span('cdq-score-sep'), span('cdq-score-away'));
  const clock = document.createElement('div');
  clock.className = 'cdq-clock';
  clock.dataset['testid'] = TESTID.clock;
  clock.append(span('cdq-period'), span('cdq-clock-time'));
  center.append(scoreNums, clock);

  const away = buildTeamBlock('away');
  away.dataset['testid'] = TESTID.awayTeam;

  score.append(home, center, away);

  // Excitement / momentum meter (bottom strip).
  const meter = div('cdq-excitement');
  meter.dataset['testid'] = 'single-game-excitement';
  const meterLabel = span('cdq-excitement-label');
  meterLabel.textContent = 'EXCITEMENT';
  const meterTrack = div('cdq-excitement-track');
  const meterFill = div('cdq-excitement-fill');
  meterTrack.append(meterFill);
  meter.append(meterLabel, meterTrack);

  // The last-moment overlay (ticker) + the big transient GOAL banner.
  const overlay = document.createElement('aside');
  overlay.className = 'cdq-overlay';
  overlay.dataset['testid'] = TESTID.overlay;
  overlay.hidden = true;

  const banner = div('cdq-goal-banner');
  banner.dataset['testid'] = 'single-game-goal-banner';
  banner.setAttribute('aria-hidden', 'true');
  banner.append(span('cdq-goal-word'), span('cdq-goal-sub'));

  root.append(header, score, meter, overlay, banner);
  return root;
}

/** A team block: a colour crest stack + the team name treatment. */
function buildTeamBlock(side: 'home' | 'away'): HTMLElement {
  const block = div(`cdq-team cdq-${side}`);
  const crest = div('cdq-crest');
  crest.append(span('cdq-crest-mono')); // monogram inside the colour block
  const name = div('cdq-team-name');
  const full = span('cdq-team-full'); // accessible / data line "NAME N"
  full.hidden = true;
  block.append(crest, name, full);
  return block;
}

/** Render the "no live game" placeholder (AC5 authoring-error path). */
function renderPlaceholder(root: HTMLElement): void {
  const placeholder = document.createElement('div');
  placeholder.className = 'cdq-no-live-game';
  placeholder.dataset['testid'] = TESTID.placeholder;
  placeholder.textContent = 'STANDING BY';
  root.append(placeholder);
}

/** Populate the score / clock / sport-context / overlay from current state. */
function renderGame(
  root: HTMLElement,
  state: GameState | null,
  maxMoment: number,
  memo: RenderMemo,
  crestResolver?: CrestResolver,
): void {
  const sel = (testid: string): HTMLElement | null => root.querySelector(`[data-testid="${testid}"]`);
  const q = (cls: string): HTMLElement | null => root.querySelector(`.${cls}`);

  // ---- league / competition strap ----------------------------------------
  const ctx = state?.sport_context;
  const ctxText = q('cdq-context-text');
  if (ctxText) {
    const parts = [ctx?.league, ctx?.sport, ctx?.venue].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    ctxText.textContent = parts.length ? parts.join('  ·  ') : 'LIVE';
  }

  // ---- team blocks (name + real crest, falling back to derived colour) ----
  paintTeam(sel(TESTID.homeTeam), state?.home_team, state?.home_score, crestResolver);
  paintTeam(sel(TESTID.awayTeam), state?.away_team, state?.away_score, crestResolver);

  // ---- big score numerals -------------------------------------------------
  const hNum = q('cdq-score-home');
  const aNum = q('cdq-score-away');
  if (hNum) hNum.textContent = scoreText(state?.home_score);
  if (aNum) aNum.textContent = scoreText(state?.away_score);

  // ---- clock + period -----------------------------------------------------
  const period = q('cdq-period');
  const clockTime = q('cdq-clock-time');
  const pc = parsePeriodClock(state?.sport_context?.period_clock);
  if (period) period.textContent = pc.period;
  if (clockTime) clockTime.textContent = pc.clock;
  // tick pulse on every clock revision (CSS animation re-trigger)
  const clockEl = sel(TESTID.clock);
  if (clockEl && (pc.period || pc.clock)) retrigger(clockEl, 'cdq-tick');

  // ---- excitement meter ---------------------------------------------------
  const fill = q('cdq-excitement-fill');
  if (fill) fill.style.width = `${excitementPct(state)}%`;

  // ---- last-moment ticker -------------------------------------------------
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

  // ---- score-change detection -> GOAL punch + flash + banner --------------
  const newHome = numOrNull(state?.home_score);
  const newAway = numOrNull(state?.away_score);
  const homeScored = scoreIncreased(memo.homeScore, newHome);
  const awayScored = scoreIncreased(memo.awayScore, newAway);
  if (homeScored || awayScored) {
    fireGoal(root, homeScored ? 'home' : 'away', state, memo);
  }
  memo.homeScore = newHome;
  memo.awayScore = newAway;
}

/** Paint one team block: name treatment + REAL crest image when published,
 *  else the derived-colour monogram block. */
function paintTeam(
  block: HTMLElement | null,
  name: string | undefined,
  score: number | undefined,
  crestResolver?: CrestResolver,
): void {
  if (!block) return;
  const n = (name ?? '').trim();
  const nameEl = block.querySelector<HTMLElement>('.cdq-team-name');
  if (nameEl) {
    nameEl.textContent = n;
    // S12 — names must be fully legible, never clipped mid-word with "…".
    // Render the full name across up to two lines and shrink-to-fit so even a
    // long club name ("BORUSSIA DORTMUND", "EINTRACHT FRANKFURT") reads cleanly
    // at the bar. fitTeamName runs after layout (rAF) so it measures real box
    // widths; the CSS gives a generous floor + wrap so the fallback is legible
    // even before the fit pass (and on the headless settle frame).
    nameEl.style.removeProperty('--name-scale');
    scheduleFit(nameEl);
  }
  const mono = block.querySelector<HTMLElement>('.cdq-crest-mono');
  const crest = block.querySelector<HTMLElement>('.cdq-crest');
  const shortCode = n.length > 0 && n.length <= 3;

  // SPEC-CRWDQ-S11 — prefer the REAL club badge resolved from the AssetManifest.
  const crestUrl = crestResolver?.crestUrlForTeam(name) ?? null;
  if (crest) {
    let img = crest.querySelector<HTMLImageElement>('img.cdq-crest-img');
    if (crestUrl) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'cdq-crest-img';
        img.alt = '';
        img.decoding = 'async';
        crest.appendChild(img);
      }
      if (img.getAttribute('src') !== crestUrl) img.src = crestUrl;
      img.hidden = false;
      crest.dataset['hasCrest'] = 'true';
      if (mono) mono.hidden = true;
      crest.hidden = false; // a real badge always shows, even for a short code
    } else {
      // No real crest — colour-block monogram fallback (unchanged behaviour).
      if (img) img.hidden = true;
      delete crest.dataset['hasCrest'];
      if (mono) {
        mono.hidden = false;
        mono.textContent = shortCode ? '' : n.slice(0, 3).toUpperCase();
      }
      crest.hidden = shortCode;
    }
  }

  // Data line kept for the e2e contract: "NAME N" (hidden, used by assertions).
  const full = block.querySelector<HTMLElement>('.cdq-team-full');
  if (full) full.textContent = teamLine(name, score);
  // Derive a stable team colour from the code and stamp it as a CSS variable.
  if (n.length > 0) {
    const { h, accent, ink } = teamColour(n);
    block.style.setProperty('--team-h', String(h));
    block.style.setProperty('--team-accent', accent);
    block.style.setProperty('--team-ink', ink);
  }
}

/**
 * Fire the broadcast GOAL moment on the scoring side: a CSS punch on the score
 * numeral, a full-bleed flash, and a transient banner. CSS-only motion driven
 * by transient classes/attrs we add then remove (D-GRH-31 smooth, no layout
 * thrash). Re-armable: a second goal before the first clears resets the timer.
 */
function fireGoal(root: HTMLElement, side: 'home' | 'away', state: GameState | null, memo: RenderMemo): void {
  root.dataset['goal'] = side;
  const num = root.querySelector<HTMLElement>(side === 'home' ? '.cdq-score-home' : '.cdq-score-away');
  if (num) retrigger(num, 'cdq-punch');
  retrigger(root, 'cdq-flash');

  const banner = root.querySelector<HTMLElement>('.cdq-goal-banner');
  if (banner) {
    const word = banner.querySelector<HTMLElement>('.cdq-goal-word');
    const sub = banner.querySelector<HTMLElement>('.cdq-goal-sub');
    const team = (side === 'home' ? state?.home_team : state?.away_team) ?? '';
    if (word) word.textContent = 'GOAL';
    if (sub) sub.textContent = team ? `${team.toUpperCase()}` : '';
    banner.setAttribute('aria-hidden', 'false');
    banner.classList.add('is-on');
  }

  if (memo.goalTimer !== null) clearTimeout(memo.goalTimer);
  memo.goalTimer = setTimeout(() => {
    delete root.dataset['goal'];
    const b = root.querySelector<HTMLElement>('.cdq-goal-banner');
    if (b) {
      b.classList.remove('is-on');
      b.setAttribute('aria-hidden', 'true');
    }
    memo.goalTimer = null;
  }, GOAL_FLASH_MS);
}

/* ----------------------------- pure helpers ------------------------------ */

/**
 * S12 — shrink-to-fit a team name so the FULL name reads, never an ellipsis.
 * The CSS lets the name wrap to two lines (`text-wrap: balance`); this pass
 * then scales the font down (via a `--name-scale` custom property the CSS
 * multiplies into the clamp) only when the wrapped text still overflows its
 * box — so short codes stay big + bold and only genuinely long names shrink.
 *
 * Runs on a `requestAnimationFrame` so it measures the real, laid-out box. It
 * is best-effort + idempotent: in a non-DOM/headless-without-rAF context it
 * degrades to the CSS wrap (already legible). It NEVER blocks the render path.
 */
function scheduleFit(nameEl: HTMLElement): void {
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => {
          setTimeout(() => cb(0), 0);
          return 0;
        };
  raf(() => fitTeamName(nameEl));
}

function fitTeamName(nameEl: HTMLElement): void {
  // Measure against the available box. The name lives in a 1fr grid cell, so
  // clientWidth is the room it gets; allow up to two wrapped lines.
  const maxW = nameEl.clientWidth;
  if (maxW <= 0) return; // not laid out (headless pre-paint) — CSS wrap covers it
  let scale = 1;
  nameEl.style.setProperty('--name-scale', '1');
  // The 2-line line-box height: read the computed line-height * 2 as the cap.
  const lineH = parseFloat(getComputedStyle(nameEl).lineHeight) || nameEl.clientHeight;
  const maxH = lineH * 2 + 2;
  // Shrink in small steps until both axes fit (or we hit a sane floor).
  for (let i = 0; i < 14; i += 1) {
    const fits = nameEl.scrollWidth <= maxW + 1 && nameEl.scrollHeight <= maxH;
    if (fits) break;
    scale -= 0.06;
    if (scale < 0.46) {
      scale = 0.46;
      nameEl.style.setProperty('--name-scale', String(scale));
      break;
    }
    nameEl.style.setProperty('--name-scale', String(scale));
  }
}

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

/** Re-trigger a CSS animation class by removing + re-adding on the next frame. */
function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  // Force reflow so the re-add restarts the animation (snap Chromium safe).
  void el.offsetWidth;
  el.classList.add(cls);
}

/** A team line: "Name Score", with blanks where the state has no value. */
function teamLine(name: string | undefined, score: number | undefined): string {
  const n = name ?? '';
  const s = score === undefined ? '' : String(score);
  return `${n} ${s}`.trim();
}

function scoreText(score: number | undefined): string {
  return score === undefined ? '–' : String(score);
}

function numOrNull(score: number | undefined): number | null {
  return typeof score === 'number' ? score : null;
}

function scoreIncreased(prev: number | null, next: number | null): boolean {
  return prev !== null && next !== null && next > prev;
}

/**
 * Split a pre-formatted period_clock (e.g. "12'", "Q3 04:11", "HT", "45+2'")
 * into a short period label + a clock string. The wire pre-formats this
 * (D-GRH-09), so we only do a light, defensive split for layout.
 */
function parsePeriodClock(pc: string | undefined): { period: string; clock: string } {
  const s = (pc ?? '').trim();
  if (s.length === 0) return { period: '', clock: '' };
  // "Q3 04:11" / "1H 12:00" -> ["Q3","04:11"]; "12'" / "HT" -> single token.
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (m) return { period: m[1]!.toUpperCase(), clock: m[2]! };
  // A lone clock-ish token (contains a digit) is the clock; else it's a label.
  return /\d/.test(s) ? { period: '', clock: s } : { period: s.toUpperCase(), clock: '' };
}

/**
 * The excitement percentage (0–100) for the broadcast momentum meter.
 *
 * SPEC-CRWDQ-S13 (D-GRH-78): the backend now computes a REAL excitement signal
 * from the live GameState (score, period, clock) + the recent GameEvent history
 * and emits it on `sport_context.excitement`. When that wire value is present we
 * render it verbatim — so the meter reflects the actual match and SPIKES the
 * instant a goal lands (the backend re-stamps the spiked value on the GameEvent,
 * which the GameStateStore merges into `sport_context`).
 *
 * The legacy DERIVED proxy is kept ONLY as a fallback for a frame that carries
 * no `sport_context.excitement` (an older backend, or a twin/mock frame): a
 * deterministic base lifted by total goals + closeness + a recent moment.
 */
function excitementPct(state: GameState | null): number {
  if (!state) return 18;
  const real = state.sport_context?.excitement;
  if (typeof real === 'number' && Number.isFinite(real)) {
    return Math.max(0, Math.min(100, real));
  }
  // Fallback proxy (no real signal on this frame).
  const goals = (state.home_score ?? 0) + (state.away_score ?? 0);
  const close = Math.abs((state.home_score ?? 0) - (state.away_score ?? 0)) <= 1 ? 18 : 0;
  const moment = state.last_moment && state.last_moment.length > 0 ? 22 : 0;
  return Math.max(12, Math.min(100, 30 + goals * 9 + close + moment));
}

/**
 * Derive a stable team colour from the team code. No logo/colour data is on
 * the wire (RESOLVED: AssetManifest carries no per-team crest), so we map the
 * code deterministically to a vivid hue (golden-angle spread off a string
 * hash) and return an accent + a readable ink colour. Sensible + consistent:
 * the same code always yields the same colour across renders and bars.
 */
function teamColour(code: string): { h: number; accent: string; ink: string } {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  const h = Math.round(((hash % 360) + (code.charCodeAt(0) % 2 ? 0 : 137)) % 360);
  const accent = `hsl(${h} 78% 56%)`;
  const ink = '#0b0e16';
  return { h, accent, ink };
}
