/**
 * Seq-gap recovery request sender (SPEC-CRWDQ-022 step 8, D-GRH-63).
 *
 * Translates a detected gap into a `GameStateRequest` player→server frame
 * and pushes it through the injected send sink. Coalesces concurrent
 * requests per `game_id` — only one outstanding request per game — until
 * the corresponding `GameStateSnapshot` resolves it. This guards against a
 * burst of gaps producing a request storm even if the dispatcher's own
 * coalescing is bypassed.
 */
import type { GameStateRequestFrame, PlayerToServerFrame } from '../wire';
import type { GameStateRequester } from './types';

export type SendFn = (frame: PlayerToServerFrame) => void;

export class GameStateRequestSender implements GameStateRequester {
  private readonly outstanding = new Set<string>();

  constructor(private readonly send: SendFn) {}

  requestForGap(gameId: string, sinceSeq: number): void {
    if (this.outstanding.has(gameId)) {
      return;
    }
    this.outstanding.add(gameId);
    // Send the FLAT player frame; `WsClient.send` is the single point that
    // wraps it in the server envelope. Pre-wrapping here too double-nested the
    // frame (`payload.payload.*`), the same bug fixed for Heartbeat (S87).
    const frame: GameStateRequestFrame = {
      message_type: 'GameStateRequest',
      game_id: gameId,
      since_seq: sinceSeq,
    };
    this.send(frame);
  }

  /** Called when the matching `GameStateSnapshot` arrives; clears the gate. */
  resolve(gameId: string): void {
    this.outstanding.delete(gameId);
  }
}
