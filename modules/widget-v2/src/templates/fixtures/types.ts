/**
 * SPEC-CRWDQ-034 — fixtures-mode domain shapes consumed by the template.
 *
 * The `Fixture` shape is OWNED by the authoritative backend spec
 * SPEC-CRWDQ-032 (`FixtureListEntry`); this template consumes it VERBATIM and
 * redefines nothing semantically. The backend-generated TS twin is not yet a
 * file in this repo (same situation as `render/types.ts` for ProgramSlotPayload
 * and `wire/types.ts` for the wire envelopes), so the consumed shape is declared
 * here in ONE place per the consumer-first contract. When SPEC-CRWDQ-032 ships
 * its generated barrel this module is the swap point. Drift between this twin
 * and SPEC-CRWDQ-032's `FixtureListEntry` is a SPEC-CRWDQ-032 concern.
 *
 * The wire `FixtureList` frame is a permissive envelope in the SPEC-CRWDQ-017
 * barrel (`wire/types.ts`); its per-fixture payload schema is owned by the
 * consuming handler — here, the `FixtureListStore`.
 */
import type { FixtureListFrame } from '../../wire';

/** The closed player-facing `feedStatus` range (SPEC-CRWDQ-032 post-publish:
 *  `postponed`/`cancelled` are filtered out before a `FixtureList` reaches the
 *  player). A recent (`< 12h`) `final` can legitimately appear (SPEC-CRWDQ-033
 *  stale-final filter). */
export type FeedStatus = 'scheduled' | 'live' | 'final';

/**
 * One fixture entry — SPEC-CRWDQ-032's `FixtureListEntry`, consumed verbatim.
 * `homeTeam` / `awayTeam` are display-name strings; the wire carries no
 * `team_id`, so a fixtures card renders team NAMES and a sport/league badge
 * only — no per-team logo (D-GRH-17 / Team identity note).
 */
export interface Fixture {
  /** Player-facing fixture id (SPEC-CRWDQ-032 `event_id`). */
  eventId: string;
  sport: string;
  leagueId: number;
  leagueName: string;
  /** Home team display name (the wire carries the name, not a `team_id`). */
  homeTeam: string;
  /** Away team display name. */
  awayTeam: string;
  /** ISO 8601 UTC kickoff instant. */
  kickoffUtc: string;
  feedStatus: FeedStatus;
}

/**
 * The `FixtureList` frame body the store consumes (D-GRH-18). Per D-GRH-18 a
 * new list REPLACES the cached set. The wire frame is the permissive
 * SPEC-CRWDQ-017 envelope; this is the payload schema the store reads off it.
 */
export interface FixtureListPayload {
  fixtures: readonly Fixture[];
}

/** The `FixtureList` frame: the SPEC-CRWDQ-017 envelope carrying a payload. */
export type FixtureListFrameTyped = FixtureListFrame & {
  payload: FixtureListPayload;
};
