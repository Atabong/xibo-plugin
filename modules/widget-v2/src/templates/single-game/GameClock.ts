/**
 * SPEC-CRWDQ-084 — a continuously-advancing local game clock for the
 * single_game shell.
 *
 * THE PROBLEM: the displayed clock only changes when a discrete GameState frame
 * arrives (a goal / event). Between frames it is FROZEN, so a viewer glancing at
 * the bar can't tell anything is happening — the broadcast looks dead.
 *
 * THE FIX: a LOCAL clock that advances the displayed game-time forward between
 * server frames, starting from the last authoritative value the backend sent,
 * at the right rate, and RE-SYNCs to the server on every new frame (server
 * ALWAYS wins; the local tick only fills the gaps). It NEVER runs past the
 * period end or past what the next server frame would show — it clamps.
 *
 * Rate: a replay is paced at `speed`× real time, but the widget isn't told the
 * speed, so the clock MEASURES it from consecutive authoritative frames — the
 * ratio of game-minute advance to wall-time advance — and uses that to tick
 * between frames. The first frame (no prior) ticks at a conservative real-time
 * rate until a second frame calibrates it. A live feed (frames ~1 game-min per
 * 60s) calibrates to ~real time naturally.
 *
 * Sports:
 *   - football: ticks the MINUTE up (and stoppage), paused at HT / FT /
 *     pre_game, clamped to the current half's nominal end (45' / 90' / 120').
 *   - baseball: the inning/half is event-driven (low cadence), so the clock
 *     exposes a moving "alive" pulse phase the panel animates — the inning value
 *     itself only advances on a real server frame (no fabricated innings).
 *
 * The clock is render-agnostic: it computes a `ClockView` the shell + panels
 * read; it does not touch the DOM. `start(onTick)` drives a setInterval that
 * fires `onTick(view)` ~2×/second so the displayed time visibly moves.
 */
import type { FootballDetail, GameState } from '../../render/types';

/** A timer seam so tests drive the tick loop deterministically. */
export interface ClockTimer {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimer: ClockTimer = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** The derived, renderable clock view. */
export interface ClockView {
  sport: string;
  /** True while the clock is actively advancing (live play). */
  running: boolean;
  /** Football: the displayed whole minute (interpolated between frames). */
  minute?: number;
  /** Football: displayed stoppage minutes (+n), 0 when none. */
  stoppage?: number;
  /** Football half label, when known. */
  half?: FootballDetail['half'];
  /** A pre-formatted period_clock string the shell pill renders (e.g. "47'",
   *  "HT", "FT"). Mirrors the backend `period_clock` contract so the shell's
   *  existing parsePeriodClock keeps working — but now it MOVES between frames. */
  periodClock: string;
  /** A 0..1 monotonic phase that advances every tick — the "alive" pulse the
   *  baseball panel + a live dot animate even when no scalar value changes. */
  pulse: number;
}

/** Nominal whole-minute ceiling for a football half (so the tick clamps). */
function footballHalfCeiling(half: FootballDetail['half'] | undefined): number {
  switch (half) {
    case '1H':
      return 45;
    case '2H':
      return 90;
    case 'ET':
      return 120;
    default:
      return 90;
  }
}

/** Is this football state in a PAUSED period (clock should not advance)? */
function footballPaused(period: string | undefined, half: FootballDetail['half'] | undefined): boolean {
  if (half === 'HT' || half === 'PEN') return true;
  const p = (period ?? '').toUpperCase();
  return p === 'HT' || p === 'FT' || p === 'PEN' || p === 'PRE_GAME' || p === 'PRE';
}

export class GameClock {
  private readonly timer: ClockTimer;
  private handle: unknown = null;
  private onTick: ((view: ClockView) => void) | null = null;

  private sport = 'football';
  private running = false;
  private pulse = 0;

  // Authoritative anchor (last server frame).
  private anchorWall = 0; // wall-time when the anchor frame landed
  private anchorMinute = 0; // football game-minute at the anchor
  private anchorStoppage = 0;
  private half: FootballDetail['half'] | undefined;
  private period: string | undefined;
  private periodClockRaw = ''; // server's period_clock string at the anchor

  // Measured advance rate: game-minutes per wall-millisecond.
  private minutesPerMs = 1 / 60_000; // default ~real time
  private prevMinute: number | null = null;
  private prevWall: number | null = null;

  constructor(timer: ClockTimer = realTimer) {
    this.timer = timer;
  }

  /** Begin ticking; `onTick` fires ~2×/s with the current interpolated view. */
  start(onTick: (view: ClockView) => void): void {
    this.onTick = onTick;
    if (this.handle !== null) return;
    this.handle = this.timer.setInterval(() => this.fire(), 500);
  }

  /** Stop ticking and release the interval. */
  stop(): void {
    if (this.handle !== null) {
      this.timer.clearInterval(this.handle);
      this.handle = null;
    }
    this.onTick = null;
  }

  /**
   * Re-sync to an authoritative server frame. The server ALWAYS wins: the
   * displayed clock snaps to this frame's value, the advance rate recalibrates
   * from the delta since the previous frame, and ticking resumes (or pauses for
   * a book-end period). Fires an immediate view so the snap shows at once.
   */
  sync(state: GameState | null): void {
    const wall = this.timer.now();
    this.sport = state?.sport_context?.sport ?? 'football';
    this.periodClockRaw = (state?.sport_context?.period_clock ?? '').trim();
    // The render GameState has no top-level `period`; derive the period token
    // from the lifecycle `status` (final → FT, halftime → HT, pre_game → PRE)
    // and, failing that, from a bare label in `period_clock` (HT/FT/PEN/1H/2H).
    this.period = periodFromState(state, this.periodClockRaw);

    // Only FOOTBALL (soccer) has a smoothly-interpolatable wall-clock minute.
    // Every other sport (baseball, basketball, hockey, …) is event-driven /
    // carries a pre-formatted period_clock the backend owns — pass it through
    // verbatim and keep only the "alive" pulse moving. This also guarantees no
    // regression to those sports' existing pill rendering.
    if (this.sport !== 'football' && this.sport !== 'soccer') {
      const p = (this.period ?? '').toUpperCase();
      this.running = p !== 'FT' && p !== 'PRE_GAME' && p !== 'PRE' && p !== '';
      this.anchorWall = wall;
      if (this.onTick) this.onTick(this.view(wall));
      return;
    }

    const d = state?.sport_context?.detail as FootballDetail | undefined;
    const minute = typeof d?.minute === 'number' ? d.minute : parseMinute(this.periodClockRaw);
    const stoppage = typeof d?.stoppage === 'number' ? d.stoppage : 0;
    this.half = d?.half ?? halfFromPeriod(this.period);

    // Calibrate the advance rate from the minute delta vs wall delta since the
    // previous authoritative frame (replay speed inference). Guard against
    // resets (minute went backwards → a loop restart; don't calibrate).
    if (
      this.prevMinute !== null &&
      this.prevWall !== null &&
      minute !== null &&
      minute > this.prevMinute &&
      wall > this.prevWall
    ) {
      const dMin = minute - this.prevMinute;
      const dWall = wall - this.prevWall;
      const rate = dMin / dWall;
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        // Smooth so a single sparse gap doesn't whipsaw the rate.
        this.minutesPerMs = this.minutesPerMs * 0.4 + rate * 0.6;
      }
    }
    this.prevMinute = minute;
    this.prevWall = wall;

    this.anchorWall = wall;
    this.anchorMinute = minute ?? this.anchorMinute;
    this.anchorStoppage = stoppage;
    this.running = !footballPaused(this.period, this.half);

    if (this.onTick) this.onTick(this.view(wall));
  }

  /** Compute (without firing) the current interpolated view — for tests. */
  current(): ClockView {
    return this.view(this.timer.now());
  }

  private fire(): void {
    this.pulse = (this.pulse + 0.08) % 1;
    if (this.onTick) this.onTick(this.view(this.timer.now()));
  }

  private view(wall: number): ClockView {
    if (this.sport !== 'football' && this.sport !== 'soccer') {
      return {
        sport: this.sport,
        running: this.running,
        periodClock: this.periodClockRaw,
        pulse: this.pulse,
      };
    }

    // Football: interpolate the minute forward from the anchor at the measured
    // rate, but only while running, and clamp to the half ceiling so it never
    // overruns (45'+stoppage / 90' / 120') or past the book-end.
    let minute = this.anchorMinute;
    let stoppage = this.anchorStoppage;
    if (this.running) {
      const elapsedMs = Math.max(0, wall - this.anchorWall);
      const advanced = this.anchorMinute + elapsedMs * this.minutesPerMs;
      const ceiling = footballHalfCeiling(this.half);
      if (advanced <= ceiling) {
        minute = Math.floor(advanced);
        stoppage = this.anchorStoppage;
      } else {
        // Past the nominal half end → hold the ceiling and grow stoppage.
        minute = ceiling;
        const overMin = advanced - ceiling;
        stoppage = Math.max(this.anchorStoppage, Math.floor(overMin) + this.anchorStoppage);
      }
    }

    return {
      sport: this.sport,
      running: this.running,
      minute,
      stoppage,
      half: this.half,
      periodClock: footballPeriodClock(this.period, this.half, minute, stoppage, this.periodClockRaw),
      pulse: this.pulse,
    };
  }
}

/**
 * Derive the period token from the render state. Prefer the lifecycle `status`
 * (final/halftime/pre_game), else a BARE label in period_clock (HT/FT/PEN/ET/
 * 1H/2H — the replay converter renders book-ends as the label alone), else
 * undefined (a live minute pill like "45'" → no book-end → running).
 */
function periodFromState(state: GameState | null, periodClockRaw: string): string | undefined {
  const status = (state?.status ?? '').toLowerCase();
  if (status === 'final') return 'FT';
  if (status === 'halftime') return 'HT';
  if (status === 'pre_game') return 'PRE_GAME';
  if (status === 'penalty_shootout') return 'PEN';
  if (status === 'extra_time') return 'ET';
  const label = periodClockRaw.toUpperCase();
  if (['HT', 'FT', 'PEN', 'ET', '1H', '2H', 'PRE'].includes(label)) return label;
  return undefined;
}

/** Parse a whole minute out of a period_clock string ("47'" / "45+2'"). */
function parseMinute(pc: string): number | null {
  const m = pc.match(/(\d+)(?:\+\d+)?'?/);
  return m ? Number(m[1]) : null;
}

/** Map a period token to a football half when no explicit detail.half. */
function halfFromPeriod(period: string | undefined): FootballDetail['half'] | undefined {
  const p = (period ?? '').toUpperCase();
  if (p === '1H') return '1H';
  if (p === '2H') return '2H';
  if (p === 'HT') return 'HT';
  if (p === 'ET') return 'ET';
  if (p === 'PEN') return 'PEN';
  return undefined;
}

/**
 * Compose the moving period_clock string the shell pill renders. Book-end
 * periods (HT / FT / PEN) render the LABEL (preserving the server string). A
 * live half renders the interpolated minute (+stoppage).
 */
function footballPeriodClock(
  period: string | undefined,
  half: FootballDetail['half'] | undefined,
  minute: number,
  stoppage: number,
  serverRaw: string,
): string {
  const p = (period ?? '').toUpperCase();
  if (p === 'HT' || half === 'HT') return 'HT';
  if (p === 'FT') return 'FT';
  if (p === 'PEN' || half === 'PEN') return 'PEN';
  if (p === 'PRE_GAME' || p === 'PRE' || serverRaw === 'PRE') return serverRaw || 'PRE';
  const stop = stoppage > 0 ? `+${stoppage}` : '';
  return `${minute}${stop}'`;
}
