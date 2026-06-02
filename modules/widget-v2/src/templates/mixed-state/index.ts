/**
 * SPEC-CRWDQ-066 — mixed-state template barrel.
 *
 * The `fixtures_with_live_game` composite (D-GRH-30 #7), its `LiveFixtureTile`
 * primitive, and the activator adapter. The composite COMPOSES the SPEC-CRWDQ-034
 * `FixtureCardSet` (static tiles) and a `LiveFixtureTile` (the promoted tile)
 * unmodified — it does not fork them (INV-FACTORY-19).
 */
export { FixturesWithLiveGameTemplate, FIXTURES_WITH_LIVE_GAME_TESTID } from './FixturesWithLiveGameTemplate';
export type {
  FixturesWithLiveGameContext,
  FixturesWithLiveGameInstance,
} from './FixturesWithLiveGameTemplate';
export { LiveFixtureTile, LIVE_TILE_TESTID } from './LiveFixtureTile';
export type { LiveFixtureTileContext, LiveFixtureTileInstance } from './LiveFixtureTile';
export { makeFixturesWithLiveGameAdapter } from './FixturesWithLiveGameAdapter';
export type {
  FixturesWithLiveGameAdapterDeps,
  PendingTimezoneApply,
} from './FixturesWithLiveGameAdapter';
