/**
 * SPEC-CRWDQ-034 / D-GRH-73 (S83) — the live bar-timezone broadcast.
 *
 * A small registry of reformat sinks the composition root fires on a `replaced`
 * ConfigPush that EDITS the bar's zone, so an already-mounted fixtures board
 * reformats in place. Verifies fan-out, the unsubscribe returned for detach, and
 * that a torn-down sink no longer receives reformats (no leak).
 */
import { describe, it, expect } from 'vitest';
import { FixturesTimezoneBroadcast } from '../../src/render/FixturesTimezoneBroadcast';

describe('FixturesTimezoneBroadcast', () => {
  it('fans a broadcast out to every subscribed sink', () => {
    const b = new FixturesTimezoneBroadcast();
    const a: string[] = [];
    const c: string[] = [];
    b.subscribe((tz) => a.push(tz));
    b.subscribe((tz) => c.push(tz));

    b.broadcast('America/Denver');

    expect(a).toEqual(['America/Denver']);
    expect(c).toEqual(['America/Denver']);
    expect(b.size).toBe(2);
  });

  it('stops delivering to a sink after its unsubscribe is called (detach)', () => {
    const b = new FixturesTimezoneBroadcast();
    const seen: string[] = [];
    const unsubscribe = b.subscribe((tz) => seen.push(tz));

    b.broadcast('America/Denver');
    unsubscribe();
    b.broadcast('America/Los_Angeles');

    expect(seen).toEqual(['America/Denver']);
    expect(b.size).toBe(0);
  });

  it('is a no-op broadcast when no sink is subscribed', () => {
    const b = new FixturesTimezoneBroadcast();
    expect(() => b.broadcast('UTC')).not.toThrow();
    expect(b.size).toBe(0);
  });
});
