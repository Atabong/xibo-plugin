import { describe, it, expect } from 'vitest';
import { formatKickoff } from '../../../src/templates/fixtures/formatKickoff';

// Bar-local "now" anchor: 2026-06-01T18:00:00Z. In America/Chicago (UTC-5 in
// June, CDT) that is 2026-06-01 13:00 local — a Monday.
const NOW = Date.parse('2026-06-01T18:00:00Z');
const CHICAGO = 'America/Chicago';

describe('formatKickoff relative-day prefix table (America/Chicago)', () => {
  it('prefixes "Today" for a kickoff on the same bar-local calendar day', () => {
    // 2026-06-01 19:30 CDT == 2026-06-02T00:30Z.
    const out = formatKickoff('2026-06-02T00:30:00Z', CHICAGO, NOW);
    expect(out).toMatch(/^Today /);
    expect(out).toMatch(/7:30/);
  });

  it('prefixes "Tomorrow" for the next bar-local calendar day', () => {
    // 2026-06-02 19:30 CDT == 2026-06-03T00:30Z.
    const out = formatKickoff('2026-06-03T00:30:00Z', CHICAGO, NOW);
    expect(out).toMatch(/^Tomorrow /);
    expect(out).toMatch(/7:30/);
  });

  it('prefixes the weekday name for 2..6 days ahead', () => {
    // 2026-06-06 is a Saturday (4 days after Mon 2026-06-01). 19:30 CDT.
    const out = formatKickoff('2026-06-07T00:30:00Z', CHICAGO, NOW);
    expect(out).toMatch(/^Sat /);
  });

  it('prefixes "MMM DD" for 7+ days ahead', () => {
    // 2026-06-10 19:30 CDT == 2026-06-11T00:30Z (9 days ahead).
    const out = formatKickoff('2026-06-11T00:30:00Z', CHICAGO, NOW);
    expect(out).toMatch(/^Jun 10 /);
  });

  it('uses the bar timezone for the day boundary, not UTC', () => {
    // 2026-06-02T03:00Z is still 2026-06-01 22:00 CDT (same bar-local day),
    // so it is "Today" even though it is the next UTC calendar day.
    const out = formatKickoff('2026-06-02T03:00:00Z', CHICAGO, NOW);
    expect(out).toMatch(/^Today /);
  });

  it('formats the same instant differently in a different timezone', () => {
    // 2026-06-02T00:30Z is 2026-06-01 20:30 in New York (EDT, UTC-4) — Today.
    const out = formatKickoff('2026-06-02T00:30:00Z', 'America/New_York', NOW);
    expect(out).toMatch(/^Today /);
    expect(out).toMatch(/8:30/);
  });
});

describe('formatKickoff GUARANTEED tz label (D-GRH-73, S83)', () => {
  it('appends the short timezone name for a bar zone (MDT in America/Denver)', () => {
    // 2026-06-02T20:10Z == 14:10 MDT (the spec worked example).
    const out = formatKickoff('2026-06-02T20:10:00Z', 'America/Denver', NOW);
    expect(out).toMatch(/2:10 PM MDT/);
  });

  it('appends a different short name for a different zone (PDT)', () => {
    const out = formatKickoff('2026-06-02T20:10:00Z', 'America/Los_Angeles', NOW);
    expect(out).toMatch(/1:10 PM PDT/);
  });

  it('explicitly labels the UTC fallback (never silently implies local)', () => {
    const out = formatKickoff('2026-06-02T20:10:00Z', 'UTC', NOW);
    expect(out).toMatch(/8:10 PM UTC/);
  });
});
