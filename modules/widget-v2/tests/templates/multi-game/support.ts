/**
 * Shared test doubles for the multi-game template family. Only the genuine
 * system boundaries are substituted (INV-FACTORY-17): the card-level animation
 * playback seam (`CardTransitions`) records what it was asked to play and
 * resolves immediately, exactly as the SPEC-CRWDQ-023 `RecordingPlayer` does
 * for the PlannedState-level executor. The GameStateStore / ProgramSlotResolver
 * / journal used alongside it in tests are the REAL shared instances.
 */
import type { CardTransitions } from '../../../src/templates/multi-game/CardSet';

/** A recorded card animation: which card (game id) ran which named animation. */
export interface RecordedCardAnimation {
  gameId: string;
  animationId: string;
  phase: 'enter' | 'exit';
}

/** Records every card enter/exit animation; resolves immediately. */
export class RecordingCardTransitions implements CardTransitions {
  readonly played: RecordedCardAnimation[] = [];

  async enter(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ gameId: card.dataset['gameId'] ?? '', animationId, phase: 'enter' });
  }

  async exit(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ gameId: card.dataset['gameId'] ?? '', animationId, phase: 'exit' });
  }

  phasesFor(gameId: string): Array<'enter' | 'exit'> {
    return this.played.filter((p) => p.gameId === gameId).map((p) => p.phase);
  }
}
