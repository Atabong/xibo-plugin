/**
 * Per-message-type frame dispatcher (SPEC-CRWDQ-022 step 4 + 8).
 *
 * Routes parsed {@link ServerFrame}s to exactly one registered handler per
 * `message_type`, synchronously in receipt order. On the game-data channel
 * it additionally tracks per-`game_id` `seq` — but ONLY for games the
 * active `ProgramSlot` is currently rendering (D-GRH-63) — and fires a
 * coalesced {@link GameStateRequester.requestForGap} on a detected gap.
 */
import type {
  Dispatcher,
  FrameHandler,
  GameStateRequester,
  LogicalChannel,
  ServerFrame,
  ServerMessageType,
} from './types';

/** Thrown when a second handler is registered for a `message_type`. */
export class DuplicateHandlerError extends Error {
  constructor(messageType: string) {
    super(`a handler is already registered for message_type "${messageType}"`);
    this.name = 'DuplicateHandlerError';
  }
}

/**
 * Tells the dispatcher whether a `game_id` is currently being rendered.
 * Production binds this to the active `ProgramSlot`; tests bind a fake.
 * A small seam so the dispatcher need not own ProgramSlot parsing.
 */
export interface ActiveGames {
  isActive(gameId: string): boolean;
}

interface GapTracker {
  lastSeq: number;
  outstanding: boolean;
}

export class FrameDispatcher implements Dispatcher {
  private readonly handlers = new Map<ServerMessageType, FrameHandler>();
  private readonly trackers = new Map<string, GapTracker>();

  constructor(
    private readonly requester: GameStateRequester,
    private readonly activeGames: ActiveGames,
  ) {}

  register<MT extends ServerMessageType>(
    messageType: MT,
    handler: FrameHandler<Extract<ServerFrame, { message_type: MT }>>,
    _channel: LogicalChannel,
  ): void {
    if (this.handlers.has(messageType)) {
      throw new DuplicateHandlerError(messageType);
    }
    this.handlers.set(messageType, handler as FrameHandler);
  }

  dispatch(frame: ServerFrame): void {
    this.trackSeq(frame);

    const handler = this.handlers.get(frame.message_type as ServerMessageType);
    if (handler) {
      handler(frame);
    }
  }

  /**
   * Maintain per-game seq baselines for rendering games and fire coalesced
   * gap-recovery requests. A `GameStateSnapshot` re-baselines the game and
   * clears any outstanding request (the snapshot IS the recovery response).
   */
  private trackSeq(frame: ServerFrame): void {
    if (frame.message_type === 'GameStateSnapshot') {
      const snap = frame as Extract<ServerFrame, { message_type: 'GameStateSnapshot' }>;
      // The snapshot IS the recovery response: re-baseline the local detector
      // AND clear the requester's coalescing gate so the next gap re-requests.
      this.trackers.set(snap.game_id, { lastSeq: snap.seq, outstanding: false });
      this.requester.resolve(snap.game_id);
      return;
    }

    if (frame.message_type !== 'GameEvent' && frame.message_type !== 'GameState') {
      return;
    }

    const f = frame as Extract<ServerFrame, { message_type: 'GameEvent' | 'GameState' }>;
    if (!this.activeGames.isActive(f.game_id)) {
      return;
    }

    const tracker = this.trackers.get(f.game_id);
    if (!tracker) {
      // First frame for this game — establish the baseline, no gap yet.
      this.trackers.set(f.game_id, { lastSeq: f.seq, outstanding: false });
      return;
    }

    if (f.seq > tracker.lastSeq + 1 && !tracker.outstanding) {
      tracker.outstanding = true;
      this.requester.requestForGap(f.game_id, tracker.lastSeq);
    }

    if (f.seq > tracker.lastSeq) {
      tracker.lastSeq = f.seq;
    }
  }
}
