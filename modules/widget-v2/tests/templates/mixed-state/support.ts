/**
 * SPEC-CRWDQ-066 — shared test doubles for the fixtures_with_live_game template
 * family. Only genuine system boundaries are substituted (INV-FACTORY-17): the
 * card-animation playback seam, the SPEC-CRWDQ-064 `AssetFetcher`, the clock,
 * and the journal sink. The `FixtureListStore`, `GameStateStore`,
 * `AssetManifestStore`, and `ProgramSlotResolver` exercised in tests are the
 * REAL shared instances — re-exported from the fixtures support where they
 * already exist so the mixed-state composite drives the very stores the static
 * cards and the live tile read.
 */
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { GameEvent, GameState } from '../../../src/render/types';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';

export {
  RecordingJournal,
  RecordingCardTransitions,
  type RecordedCardAnimation,
  StubAssetFetcher,
  makeAssetStore,
  applyBadgeManifest,
  fixture,
  fixtureFrame,
  EMPTY_SHA256,
} from '../fixtures/support';

/** A real GameStateStore wired to the supplied recording journal. */
export function makeGameStateStore(journal: RenderJournal): GameStateStore {
  return new GameStateStore(journal);
}

/** Seed a full GameState snapshot for `gameId` (D-GRH-49 in-store before mount). */
export function seedGame(
  store: GameStateStore,
  gameId: string,
  over: Partial<GameState> = {},
): void {
  store.upsertSnapshot({
    game_id: gameId,
    seq: 1,
    home_score: 0,
    away_score: 0,
    sport_context: { period_clock: '' },
    ...over,
  });
}

/** A per-field GameEvent delta with a monotonically supplied `seq`. */
export const gameEvent = (gameId: string, seq: number, over: Partial<GameEvent> = {}): GameEvent => ({
  game_id: gameId,
  seq,
  ...over,
});

/** Narrow a recorded entry stream to one type (parity with the fixtures support). */
export function typesOf(entries: RenderJournalEntry[], type: string): RenderJournalEntry[] {
  return entries.filter((e) => e.type === type);
}
