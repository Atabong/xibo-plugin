import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrowdaqWsClient, type WebSocketLike } from '../../src/transport/WsClient';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import type {
  JournalEntry,
  JournalSink,
  LifecycleInfo,
  WsClientConfig,
} from '../../src/transport/types';
import { FakeWebSocket } from './support/FakeWebSocket';

/** In-memory journal sink — a real collaborator, asserted on directly. */
class RecordingJournal implements JournalSink {
  readonly entries: JournalEntry[] = [];
  record(entry: JournalEntry): void {
    this.entries.push(entry);
  }
}

/** Every game is active — keeps the dispatcher's gap tracker engaged. */
const allActive: ActiveGames = { isActive: () => true };

const SUBPROTOCOL = 'crowdaq.v1';

function makeConfig(overrides: Partial<WsClientConfig> = {}): WsClientConfig {
  return {
    url: 'wss://bar.tailnet/delivery',
    barId: 'bar-7',
    displayId: 'disp-42',
    playerVersion: '2.0.0',
    heartbeatIntervalMs: 30_000,
    ackTimeoutMs: 60_000,
    reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000, jitter: 'full' },
    ...overrides,
  };
}

/**
 * Builds a client with real Deserializer/Dispatcher/Heartbeat/Requester and
 * a controllable WebSocket factory. Returns the sockets the factory minted
 * so the test can drive the server side.
 */
function build(config = makeConfig(), random = () => 0.5) {
  const sockets: FakeWebSocket[] = [];
  const journal = new RecordingJournal();
  const requester = new GameStateRequestSender(() => {});
  const dispatcher = new FrameDispatcher(requester, allActive);
  const lifecycle: Array<{ event: string; info: LifecycleInfo }> = [];

  const client = new CrowdaqWsClient(config, {
    webSocketFactory: (url, protocol): WebSocketLike => {
      const ws = new FakeWebSocket(url, protocol);
      sockets.push(ws);
      return ws;
    },
    deserializer: new WireDeserializer(),
    dispatcher,
    journal,
    now: () => Date.now(),
    random,
  });
  client.on('open', (info) => lifecycle.push({ event: 'open', info }));
  client.on('close', (info) => lifecycle.push({ event: 'close', info }));
  client.on('error', (info) => lifecycle.push({ event: 'error', info }));
  client.on('reconnect', (info) => lifecycle.push({ event: 'reconnect', info }));

  return { client, sockets, journal, dispatcher, lifecycle };
}

const configPush = JSON.stringify({ message_type: 'ConfigPush', config_hash: 'h1' });

describe('WsClient.connect (AC1, AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('opens the WS with the crowdaq.v1 subprotocol', async () => {
    const { client, sockets } = build();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(configPush);
    await p;
    expect(sockets[0]!.protocol).toBe(SUBPROTOCOL);
    await client.close();
  });

  it('resolves connect() only on the first server-pushed frame', async () => {
    const { client, sockets } = build();
    let resolved = false;
    const p = client.connect().then(() => {
      resolved = true;
    });
    sockets[0]!.simulateOpen();
    await Promise.resolve();
    expect(resolved).toBe(false); // open alone does not resolve (D-GRH-61)
    sockets[0]!.simulateMessage(configPush);
    await p;
    expect(resolved).toBe(true);
    await client.close();
  });

  it('emits exactly one DeviceRegistration as the first outbound frame on open', async () => {
    const { client, sockets } = build();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(configPush);
    await p;
    const first = JSON.parse(sockets[0]!.sent[0]!);
    // buildEnvelope wraps the flat frame into the server's validated envelope:
    // {schema_version, channel:'control', message_type, ts, payload:{…fields}}.
    expect(first).toMatchObject({
      schema_version: 1,
      channel: 'control',
      message_type: 'DeviceRegistration',
      payload: {
        bar_id: 'bar-7',
        display_id: 'disp-42',
        player_sw_version: '2.0.0',
      },
    });
    expect(typeof first.ts).toBe('string');
    expect(first.ts.length).toBeGreaterThan(0);
    expect('last_seq' in first.payload).toBe(true);
    expect('last_config_hash' in first.payload).toBe(true);
    // Only one registration frame across all outbound.
    const regs = sockets[0]!.sent.filter((s) => JSON.parse(s).message_type === 'DeviceRegistration');
    expect(regs).toHaveLength(1);
    await client.close();
  });
});

describe('WsClient read loop journaling (AC8, AC9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  async function connected() {
    const ctx = build();
    const p = ctx.client.connect();
    ctx.sockets[0]!.simulateOpen();
    ctx.sockets[0]!.simulateMessage(configPush);
    await p;
    return ctx;
  }

  it('journals schema_violation_received for an unknown message_type and never dispatches it', async () => {
    const ctx = await connected();
    const handler = vi.fn();
    ctx.dispatcher.register('ConfigPush', handler, 'control');
    ctx.sockets[0]!.simulateMessage(JSON.stringify({ message_type: 'Bogus' }));
    expect(handler).not.toHaveBeenCalled();
    expect(ctx.journal.entries).toContainEqual(
      expect.objectContaining({ type: 'schema_violation_received', reason: 'unknown_message_type' }),
    );
    await ctx.client.close();
  });

  it('journals schema_violation_received for invalid JSON', async () => {
    const ctx = await connected();
    ctx.sockets[0]!.simulateMessage('{not json');
    expect(ctx.journal.entries.some((e) => e.type === 'schema_violation_received' && e.reason === 'invalid_json')).toBe(true);
    await ctx.client.close();
  });

  it('ignores empty lines without journaling', async () => {
    const ctx = await connected();
    const before = ctx.journal.entries.length;
    ctx.sockets[0]!.simulateMessage('   ');
    expect(ctx.journal.entries.length).toBe(before);
    await ctx.client.close();
  });

  it('drops and journals a binary frame without crashing', async () => {
    const ctx = await connected();
    expect(() => ctx.sockets[0]!.simulateBinary()).not.toThrow();
    expect(ctx.journal.entries.some((e) => e.type === 'binary_frame_dropped')).toBe(true);
    await ctx.client.close();
  });

  it('drops and journals a frame larger than 1 MB', async () => {
    const ctx = await connected();
    const huge = JSON.stringify({ message_type: 'ConfigPush', config_hash: 'x', pad: 'a'.repeat(1_100_000) });
    ctx.sockets[0]!.simulateMessage(huge);
    expect(ctx.journal.entries.some((e) => e.type === 'frame_too_large_dropped' || e.reason === 'frame_too_large')).toBe(true);
    await ctx.client.close();
  });

  it('routes HeartbeatAck to the heartbeat (no schema violation)', async () => {
    const ctx = await connected();
    const before = ctx.journal.entries.length;
    ctx.sockets[0]!.simulateMessage(JSON.stringify({ message_type: 'HeartbeatAck', seq: 1 }));
    expect(ctx.journal.entries.length).toBe(before);
    await ctx.client.close();
  });
});

describe('WsClient reconnect (AC7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  async function connect(ctx: ReturnType<typeof build>, idx = 0) {
    const p = ctx.client.connect();
    ctx.sockets[idx]!.simulateOpen();
    ctx.sockets[idx]!.simulateMessage(configPush);
    await p;
  }

  it('does NOT reconnect on a clean client close (1000)', async () => {
    const ctx = build();
    await connect(ctx);
    await ctx.client.close();
    expect(ctx.sockets[0]!.closedWith?.code).toBe(1000);
    vi.advanceTimersByTime(120_000);
    expect(ctx.sockets).toHaveLength(1); // no new socket minted
  });

  it('fires a reconnect lifecycle event with attempt + delayMs before reconnecting on transport error', async () => {
    const ctx = build(makeConfig(), () => 0.5);
    await connect(ctx);
    ctx.sockets[0]!.simulateError();
    ctx.sockets[0]!.simulateClose(1006);

    const recon = ctx.lifecycle.find((e) => e.event === 'reconnect');
    expect(recon).toBeDefined();
    expect(recon!.info.attempt).toBe(1);
    // full jitter with random()=0.5 over [0, initialDelay=1000] => 500ms
    expect(recon!.info.delayMs).toBe(500);

    vi.advanceTimersByTime(recon!.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2); // a new socket was minted
  });

  it('reconnects on a SPEC-020 server-initiated close code (4002)', async () => {
    const ctx = build();
    await connect(ctx);
    ctx.sockets[0]!.simulateClose(4002);
    const recon = ctx.lifecycle.find((e) => e.event === 'reconnect');
    expect(recon).toBeDefined();
    vi.advanceTimersByTime(recon!.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2);
  });

  it('re-emits DeviceRegistration exactly once on the reconnected socket', async () => {
    const ctx = build();
    await connect(ctx);
    ctx.sockets[0]!.simulateClose(1001);
    const recon = ctx.lifecycle.find((e) => e.event === 'reconnect')!;
    vi.advanceTimersByTime(recon.info.delayMs!);
    ctx.sockets[1]!.simulateOpen();
    const regs = ctx.sockets[1]!.sent.filter((s) => JSON.parse(s).message_type === 'DeviceRegistration');
    expect(regs).toHaveLength(1);
    await ctx.client.close();
  });

  it('grows the backoff delay across attempts, bounded by maxDelayMs', async () => {
    // random()=1 selects the top of each jitter window: delay == window cap.
    const ctx = build(makeConfig({ reconnect: { initialDelayMs: 1_000, maxDelayMs: 4_000, jitter: 'full' } }), () => 1);
    await connect(ctx);

    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const sock = ctx.sockets[ctx.sockets.length - 1]!;
      sock.simulateClose(1006);
      const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
      delays.push(recon.info.delayMs!);
      vi.advanceTimersByTime(recon.info.delayMs!);
    }
    // 1000, 2000, 4000, then capped at 4000.
    expect(delays).toEqual([1_000, 2_000, 4_000, 4_000]);
  });
});

describe('WsClient heartbeat liveness close (AC6 integration)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('closes the socket with 1000 and reconnects when heartbeats go unacked past ackTimeoutMs', async () => {
    const ctx = build();
    const p = ctx.client.connect();
    ctx.sockets[0]!.simulateOpen();
    ctx.sockets[0]!.simulateMessage(configPush);
    await p;

    vi.advanceTimersByTime(30_000); // heartbeat emitted, outstanding
    vi.advanceTimersByTime(60_000); // ackTimeout elapses with no ack
    expect(ctx.sockets[0]!.closedWith?.code).toBe(1000);

    const recon = ctx.lifecycle.find((e) => e.event === 'reconnect');
    expect(recon).toBeDefined();
    vi.advanceTimersByTime(recon!.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2);
    await ctx.client.close();
  });
});
