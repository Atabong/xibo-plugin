import { describe, it, expect } from 'vitest';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import type { PlayerToServerFrame } from '../../src/wire';

/** Records frames the sender pushes — a real send sink, not a mock. */
class RecordingSend {
  readonly sent: PlayerToServerFrame[] = [];
  readonly send = (f: PlayerToServerFrame): void => {
    this.sent.push(f);
  };
}

describe('GameStateRequestSender', () => {
  it('emits a GameStateRequest frame with game_id and since_seq', () => {
    const sink = new RecordingSend();
    const sender = new GameStateRequestSender(sink.send);
    sender.requestForGap('G', 3);
    expect(sink.sent).toEqual([
      { message_type: 'GameStateRequest', game_id: 'G', since_seq: 3 },
    ]);
  });

  it('coalesces a second request for the same game while one is outstanding', () => {
    const sink = new RecordingSend();
    const sender = new GameStateRequestSender(sink.send);
    sender.requestForGap('G', 3);
    sender.requestForGap('G', 5);
    expect(sink.sent).toHaveLength(1);
  });

  it('allows a new request for the same game after the snapshot resolves it', () => {
    const sink = new RecordingSend();
    const sender = new GameStateRequestSender(sink.send);
    sender.requestForGap('G', 3);
    sender.resolve('G');
    sender.requestForGap('G', 9);
    expect(sink.sent).toEqual([
      { message_type: 'GameStateRequest', game_id: 'G', since_seq: 3 },
      { message_type: 'GameStateRequest', game_id: 'G', since_seq: 9 },
    ]);
  });

  it('tracks outstanding requests per game independently', () => {
    const sink = new RecordingSend();
    const sender = new GameStateRequestSender(sink.send);
    sender.requestForGap('A', 1);
    sender.requestForGap('B', 2);
    expect(sink.sent).toHaveLength(2);
  });
});
