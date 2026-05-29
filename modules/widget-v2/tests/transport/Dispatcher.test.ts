import { describe, it, expect } from 'vitest';
import { FrameDispatcher, DuplicateHandlerError, type ActiveGames } from '../../src/transport/Dispatcher';
import type { GameStateRequester, ServerFrame } from '../../src/transport/types';

/** Records frames in receipt order — a real handler, not a mock. */
class RecordingHandler<F extends ServerFrame> {
  readonly received: F[] = [];
  readonly handle = (f: F): void => {
    this.received.push(f);
  };
}

/** Records seq-gap recovery requests — real collaborator under DI. */
class RecordingRequester implements GameStateRequester {
  readonly requests: Array<{ gameId: string; sinceSeq: number }> = [];
  requestForGap(gameId: string, sinceSeq: number): void {
    this.requests.push({ gameId, sinceSeq });
  }
}

/** Fake active-game set: every game in the constructed set is "rendering". */
class FakeActiveGames implements ActiveGames {
  constructor(private readonly ids: Set<string>) {}
  isActive(gameId: string): boolean {
    return this.ids.has(gameId);
  }
}

const ge = (gameId: string, seq: number): ServerFrame =>
  ({ message_type: 'GameEvent', game_id: gameId, seq }) as ServerFrame;

describe('Dispatcher.register', () => {
  it('allows exactly one handler per message_type', () => {
    const d = new FrameDispatcher(new RecordingRequester(), new FakeActiveGames(new Set()));
    const h = new RecordingHandler();
    d.register('ConfigPush', h.handle, 'control');
    expect(() => d.register('ConfigPush', h.handle, 'control')).toThrowError(DuplicateHandlerError);
  });
});

describe('Dispatcher.dispatch', () => {
  it('invokes the registered handler with the frame', () => {
    const d = new FrameDispatcher(new RecordingRequester(), new FakeActiveGames(new Set()));
    const h = new RecordingHandler();
    d.register('ConfigPush', h.handle, 'control');
    const frame = { message_type: 'ConfigPush', config_hash: 'x' } as ServerFrame;
    d.dispatch(frame);
    expect(h.received).toEqual([frame]);
  });

  it('delivers frames to handlers synchronously in receipt order', () => {
    const d = new FrameDispatcher(new RecordingRequester(), new FakeActiveGames(new Set(['g'])));
    const cfg = new RecordingHandler();
    const game = new RecordingHandler();
    d.register('ConfigPush', cfg.handle, 'control');
    d.register('GameEvent', game.handle, 'game_data');
    const f1 = { message_type: 'ConfigPush', config_hash: 'a' } as ServerFrame;
    const f2 = ge('g', 1);
    d.dispatch(f1);
    d.dispatch(f2);
    expect(cfg.received).toEqual([f1]);
    expect(game.received).toEqual([f2]);
  });

  it('does not throw when no handler is registered for a type', () => {
    const d = new FrameDispatcher(new RecordingRequester(), new FakeActiveGames(new Set()));
    expect(() => d.dispatch({ message_type: 'SyncRequest' } as ServerFrame)).not.toThrow();
  });
});

describe('Dispatcher seq-gap recovery (D-GRH-63)', () => {
  it('fires exactly one GameStateRequest on a gap for an active game', () => {
    const req = new RecordingRequester();
    const d = new FrameDispatcher(req, new FakeActiveGames(new Set(['G'])));
    d.dispatch(ge('G', 1));
    d.dispatch(ge('G', 2));
    d.dispatch(ge('G', 3));
    d.dispatch(ge('G', 7)); // gap: expected 4, observed 7
    expect(req.requests).toEqual([{ gameId: 'G', sinceSeq: 3 }]);
  });

  it('coalesces a second gap on the same game while a request is outstanding', () => {
    const req = new RecordingRequester();
    const d = new FrameDispatcher(req, new FakeActiveGames(new Set(['G'])));
    d.dispatch(ge('G', 1));
    d.dispatch(ge('G', 5)); // gap 1 -> request since 1
    d.dispatch(ge('G', 9)); // second gap, still outstanding -> coalesced
    expect(req.requests).toEqual([{ gameId: 'G', sinceSeq: 1 }]);
  });

  it('does not track seq for a game that is not in the active ProgramSlot', () => {
    const req = new RecordingRequester();
    const d = new FrameDispatcher(req, new FakeActiveGames(new Set(['G'])));
    d.dispatch(ge('IDLE', 1));
    d.dispatch(ge('IDLE', 8)); // gap, but IDLE is not rendering
    expect(req.requests).toEqual([]);
  });

  it('resets the per-game baseline on a GameStateSnapshot and clears the outstanding marker', () => {
    const req = new RecordingRequester();
    const d = new FrameDispatcher(req, new FakeActiveGames(new Set(['G'])));
    d.dispatch(ge('G', 1));
    d.dispatch(ge('G', 5)); // outstanding request since 1
    d.dispatch({ message_type: 'GameStateSnapshot', game_id: 'G', seq: 20 } as ServerFrame);
    d.dispatch(ge('G', 25)); // gap after snapshot baseline 20 -> new request since 20
    expect(req.requests).toEqual([
      { gameId: 'G', sinceSeq: 1 },
      { gameId: 'G', sinceSeq: 20 },
    ]);
  });

  it('does not fire a request when frames arrive contiguously', () => {
    const req = new RecordingRequester();
    const d = new FrameDispatcher(req, new FakeActiveGames(new Set(['G'])));
    d.dispatch(ge('G', 1));
    d.dispatch(ge('G', 2));
    d.dispatch(ge('G', 3));
    expect(req.requests).toEqual([]);
  });
});
