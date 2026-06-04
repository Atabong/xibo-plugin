/**
 * SPEC-CRWDQ-034 — bar-local fixture-time formatting (D-GRH-73).
 *
 * A fixture's `kickoffUtc` (ISO 8601 UTC) is rendered in the bar's `timezone`
 * with a relative-day prefix computed against bar-local "now":
 *
 *   | bar-local date vs bar-local now | display              |
 *   |---------------------------------|----------------------|
 *   | same calendar day               | "Today 7:30 PM"      |
 *   | next calendar day               | "Tomorrow 7:30 PM"   |
 *   | 2..6 days ahead                 | "Sat 7:30 PM"        |
 *   | >= 7 days ahead                 | "May 21 7:30 PM"     |
 *
 * The day boundary is bar-local midnight in `timezone` (NOT UTC) — the calendar
 * day is derived from the timezone-projected y/m/d, not the UTC date. Locale is
 * the `Intl.DateTimeFormat` browser default (bar `language` is out of D-GRH-73
 * scope), so only `timeZone` is pinned.
 *
 * `Intl.DateTimeFormat` is exercised for real (jsdom supports IANA TZ); the
 * clock is the only substituted boundary (INV-FACTORY-17) — callers pass `now`.
 */

/** Bar-local calendar-day delta from `now` to `kickoff`, both projected into
 *  `timeZone`. 0 = same day, 1 = tomorrow, negative = past. */
function localDayDelta(kickoffMs: number, nowMs: number, timeZone: string): number {
  const kickoffDay = localMidnightUtc(kickoffMs, timeZone);
  const nowDay = localMidnightUtc(nowMs, timeZone);
  return Math.round((kickoffDay - nowDay) / 86_400_000);
}

/**
 * The UTC-instant of bar-local midnight for the calendar day `ms` falls on in
 * `timeZone`. Projects the instant to the zone's y/m/d, then re-reads it as a
 * UTC midnight — a stable per-day key for whole-day differencing that is immune
 * to DST offset shifts (each day's key is a pure date, not an offset instant).
 */
function localMidnightUtc(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/** The bar-local clock time, e.g. "7:30 PM". */
function localTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

/** The bar-local short weekday, e.g. "Sat". */
function localWeekday(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(ms));
}

/** The bar-local "MMM DD" date, e.g. "Jun 10". */
function localMonthDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(
    new Date(ms),
  );
}

/**
 * Format a fixture kickoff as "<relative-day> <bar-local time>" for display.
 * `nowMs` is the pinned clock (defaults to `Date.now()`); pass it in tests.
 */
export function formatKickoff(kickoffUtc: string, timeZone: string, nowMs: number = Date.now()): string {
  const kickoffMs = Date.parse(kickoffUtc);
  if (Number.isNaN(kickoffMs)) return '';

  const time = localTime(kickoffMs, timeZone);
  const delta = localDayDelta(kickoffMs, nowMs, timeZone);

  let prefix: string;
  if (delta === 0) prefix = 'Today';
  else if (delta === 1) prefix = 'Tomorrow';
  else if (delta >= 2 && delta <= 6) prefix = localWeekday(kickoffMs, timeZone);
  else prefix = localMonthDay(kickoffMs, timeZone);

  return `${prefix} ${time}`;
}
