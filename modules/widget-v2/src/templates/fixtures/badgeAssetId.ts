/**
 * SPEC-CRWDQ-034 — sport-badge `asset_id` convention.
 *
 * `badge:<sport>:<leagueName-slug>` (e.g. `badge:football:premier-league`),
 * `leagueName` lower-cased and slugified. A naming contract with the
 * `AssetManifest` publisher (OPEN QUESTION, low risk): a divergent convention
 * degrades gracefully to the league-name text fallback rather than crashing.
 */

/** Lower-case + slugify a league name to its `asset_id` segment. */
export function slugLeague(leagueName: string): string {
  return leagueName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The badge `asset_id` for a fixture's sport + league. */
export function badgeAssetId(sport: string, leagueName: string): string {
  return `badge:${sport.toLowerCase()}:${slugLeague(leagueName)}`;
}
