import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatLoop } from '../../src/transport/Heartbeat';
import type { PlayerToServerFrame } from '../../src/transport/types';

/** Captures outbound frames — a real send sink under DI, not a mock. */
class RecordingSend {
  readonly frames: PlayerToServerFrame[] = [];
  readonly send = (frame: PlayerToServerFrame): void => {
    this.frames.push(frame);
  };
}

const HB_INTERVAL = 30_000;
const ACK_TIMEOUT = 60_000;

const make = (overrides: Partial<ConstructorParameters<typeof HeartbeatLoop>[0]> = {}) => {
  const sink = new RecordingSend();
  const onLivenessLost = vi.fn();
  const loop = new HeartbeatLoop({
    send: sink.send,
    intervalMs: HB_INTERVAL,
    ackTimeoutMs: ACK_TIMEOUT,
    configHash: () => 'cfg-1',
    now: () => Date.now(),
    onLivenessLost,
    ...overrides,
  });
  return { sink, onLivenessLost, loop };
};

describe('Heartbeat cadence (AC6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits exactly one no-seq Heartbeat envelope per interval', () => {
    const { sink, loop } = make();
    loop.start();
    expect(sink.frames).toHaveLength(0);

    vi.advanceTimersByTime(HB_INTERVAL);
    expect(sink.frames).toHaveLength(1);
    const hb = sink.frames[0]!;
    expect(hb.message_type).toBe('Heartbeat');
    expect('seq' in hb).toBe(false);

    vi.advanceTimersByTime(HB_INTERVAL);
    expect(sink.frames).toHaveLength(2);

    loop.stop();
  });

  it('emits a FLAT Heartbeat frame with player_local_ts + config_hash (WsClient wraps it)', () => {
    // S87 — the loop emits the FLAT player frame; the SINGLE envelope wrap is
    // WsClient.send's job. The loop must NOT pre-wrap (that double-nested the
    // heartbeat on the wire so the server read a null config_hash).
    vi.setSystemTime(123_456);
    const { sink, loop } = make({ now: () => Date.now() });
    loop.start();
    vi.advanceTimersByTime(HB_INTERVAL);
    expect(sink.frames[0]).toMatchObject({
      message_type: 'Heartbeat',
      player_local_ts: 123_456 + HB_INTERVAL,
      config_hash: 'cfg-1',
    });
    // Not pre-wrapped: no envelope fields, no nested payload.
    expect('payload' in (sink.frames[0] as object)).toBe(false);
    expect('schema_version' in (sink.frames[0] as object)).toBe(false);
    expect('channel' in (sink.frames[0] as object)).toBe(false);
    loop.stop();
  });

  it('stop() halts the cadence', () => {
    const { sink, loop } = make();
    loop.start();
    vi.advanceTimersByTime(HB_INTERVAL);
    loop.stop();
    vi.advanceTimersByTime(HB_INTERVAL * 3);
    expect(sink.frames).toHaveLength(1);
  });
});

describe('Heartbeat liveness / ack (AC6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a heartbeat outstanding after emit and clears it on ack', () => {
    const { loop } = make();
    loop.start();
    expect(loop.outstanding()).toBeNull();

    vi.advanceTimersByTime(HB_INTERVAL);
    expect(loop.outstanding()).toBe(HB_INTERVAL);

    loop.onAck();
    expect(loop.outstanding()).toBeNull();
    loop.stop();
  });

  it('invokes onLivenessLost when an outstanding heartbeat exceeds ackTimeoutMs', () => {
    const { onLivenessLost, loop } = make();
    loop.start();
    vi.advanceTimersByTime(HB_INTERVAL); // emit @ 30s, outstanding
    expect(onLivenessLost).not.toHaveBeenCalled();

    // No ack arrives; at 30s + ackTimeout the liveness check fires.
    vi.advanceTimersByTime(ACK_TIMEOUT);
    expect(onLivenessLost).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('does not lose liveness when acks keep arriving', () => {
    const { onLivenessLost, loop } = make();
    loop.start();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(HB_INTERVAL);
      loop.onAck();
    }
    vi.advanceTimersByTime(ACK_TIMEOUT);
    expect(onLivenessLost).not.toHaveBeenCalled();
    loop.stop();
  });

  it('ignores a stray ack with no outstanding heartbeat (no crash)', () => {
    const { loop } = make();
    loop.start();
    expect(() => loop.onAck()).not.toThrow();
    expect(loop.outstanding()).toBeNull();
    loop.stop();
  });
});
