/**
 * SPEC-CRWDQ-034 — the player-side cache of the most recent `FixtureList`
 * (D-GRH-18). A new list REPLACES the cached set (D-GRH-18) — it is never
 * merged. The fixtures template resolves each `ProgramSlot.fixture_ids[]`
 * `eventId` against this store at mount and subscribes per card so a re-push
 * that flips `feedStatus` or edits `kickoffUtc` reaches the card as an in-place
 * mutation (no re-mount, no transition — AC10).
 *
 * Subscribers fire only when their fixture's entry actually CHANGED across the
 * replace (a byte-identical re-push is a no-op; a dropped entry does not fire),
 * so the template re-renders a card only when something it displays moved.
 *
 * Modelled on the SPEC-CRWDQ-023 `GameStateStore`: in-process, real in tests
 * (INV-FACTORY-16/-17 — no mock), driven via a frame-injection driver.
 */
import type {
  Fixture,
  FixtureListFrameTyped,
  FixtureListPayload,
} from '../templates/fixtures/types';

type Listener = (fixture: Fixture) => void;

export class FixtureListStore {
  /** eventId -> current cached fixture (the most recent applied list). */
  private fixtures = new Map<string, Fixture>();
  /** eventId -> live per-fixture mutation listeners. */
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Apply a `FixtureList` frame; the new list REPLACES the cached set
   *  (D-GRH-18). Fires per-fixture listeners only for entries that changed. */
  applyList(frame: FixtureListFrameTyped): void {
    const next = new Map<string, Fixture>();
    for (const fixture of readFixtures(frame.payload)) {
      next.set(fixture.eventId, fixture);
    }

    const prior = this.fixtures;
    this.fixtures = next;

    // Notify a subscribed eventId only when its entry is present in the new
    // list AND differs from what was cached. A dropped entry does not fire.
    for (const [eventId, set] of this.listeners) {
      const updated = next.get(eventId);
      if (updated === undefined) continue;
      const before = prior.get(eventId);
      if (before !== undefined && sameFixture(before, updated)) continue;
      for (const listener of set) listener(updated);
    }
  }

  /** Resolve a fixture by `eventId`, or null if absent from the cached set. */
  resolve(eventId: string): Fixture | null {
    return this.fixtures.get(eventId) ?? null;
  }

  /** Subscribe to per-fixture mutations for `eventId`. Returns unsubscribe. */
  subscribe(eventId: string, listener: Listener): () => void {
    let set = this.listeners.get(eventId);
    if (!set) {
      set = new Set();
      this.listeners.set(eventId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(eventId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(eventId);
    };
  }
}

/** Read the fixtures array off a (permissive) wire payload, ignoring junk. */
function readFixtures(payload: FixtureListPayload | undefined): readonly Fixture[] {
  const raw = payload?.fixtures;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is Fixture => typeof f === 'object' && f !== null && typeof f.eventId === 'string',
  );
}

/** Shallow structural equality across the displayed fixture fields. */
function sameFixture(a: Fixture, b: Fixture): boolean {
  return (
    a.eventId === b.eventId &&
    a.sport === b.sport &&
    a.leagueId === b.leagueId &&
    a.leagueName === b.leagueName &&
    a.homeTeam === b.homeTeam &&
    a.awayTeam === b.awayTeam &&
    a.kickoffUtc === b.kickoffUtc &&
    a.feedStatus === b.feedStatus
  );
}
