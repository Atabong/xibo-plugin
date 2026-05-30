/**
 * Seq-gap recovery driven by real on-wire fixtures (SPEC-CRWDQ-022 "Test
 * cases": seq-gap recovery + coalescing, snapshot re-baseline, and the
 * not-in-active-ProgramSlot suppression case, D-GRH-63).
 *
 * `fixtures/wire/seq-gap-recovery.jsonl` is a full-envelope game-data
 * transcript for an actively-rendered game; `seq-gap-idle-game.jsonl` is the
 * same shape for a benched game. Each line is parsed by the REAL
 * {@link WireDeserializer} and routed through the REAL {@link FrameDispatcher}
 * into the REAL {@link GameStateRequestSender}; only the outbound send sink
 * is captured (a real collaborator under DI, not a mock — INV-FACTORY-16/-17).
 */
import { describe, it, expect } from 'vitest';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import type { PlayerToServerFrame, ServerFrame } from '../../src/transport/types';
import { loadWireFixture } from './support/fixtures';

/** Real active-game seam: the named ids are the ones currently rendering. */
class FakeActiveGames implements ActiveGames {
  constructor(private readonly ids: Set<string>) {}
  isActive(gameId: string): boolean {
    return this.ids.has(gameId);
  }
}

/**
 * Parse a fixture through the real deserializer and dispatch every resulting
 * frame through the real dispatcher — exactly the path the read loop takes.
 */
function replay(fixture: string, active: Set<string>): PlayerToServerFrame[] {
  const sent: PlayerToServerFrame[] = [];
  const sender = new GameStateRequestSender((f) => sent.push(f));
  const dispatcher = new FrameDispatcher(sender, new FakeActiveGames(active));
  const de = new WireDeserializer();
  for (const line of loadWireFixture(fixture)) {
    const result = de.parse(line);
    if ('message_type' in result) {
      dispatcher.dispatch(result as ServerFrame);
    }
  }
  return sent;
}

describe('seq-gap recovery from wire fixture (AC1, AC2, AC5)', () => {
  it('issues coalesced GameStateRequests and re-baselines on the snapshot', () => {
    // game-001 is the actively rendered game in the fixture.
    const sent = replay('seq-gap-recovery.jsonl', new Set(['game-001']));

    // seq 1,2,3 contiguous; gap at 7 -> request since 3. seq 9 still
    // outstanding -> coalesced. Snapshot @20 re-baselines + clears the gate.
    // seq 25 after baseline 20 -> a second request since 20.
    expect(sent).toEqual([
      { message_type: 'GameStateRequest', game_id: 'game-001', since_seq: 3 },
      { message_type: 'GameStateRequest', game_id: 'game-001', since_seq: 20 },
    ]);
  });

  it('issues no request for a game absent from the active ProgramSlot', () => {
    // The benched game gaps from seq 1 -> 8, but it is not rendering, so the
    // dispatcher never tracks it (D-GRH-63 "only games currently rendered").
    const sent = replay('seq-gap-idle-game.jsonl', new Set(['game-001']));
    expect(sent).toEqual([]);
  });

  it('parses every seq-gap fixture line as a typed game-data frame', () => {
    const de = new WireDeserializer();
    for (const fixture of ['seq-gap-recovery.jsonl', 'seq-gap-idle-game.jsonl']) {
      for (const line of loadWireFixture(fixture)) {
        const r = de.parse(line);
        expect('message_type' in r).toBe(true);
      }
    }
  });
});
