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

  it('recovers from a pre-open connect error that never fires close (CSP/DNS/TLS refusal)', async () => {
    // Live Chromium on the Xibo player: a WS whose connect is REFUSED before
    // it ever opens (CSP connect-src block, DNS, TLS) fires ONLY `error` and
    // NEVER a follow-up `close`. The close-driven recovery (emit 'close' so the
    // SafeStateController control_channel_lost safe_info fallback arms, plus a
    // reconnect schedule) must still run, or the host stays blank.
    const ctx = build(makeConfig(), () => 0.5);
    ctx.client.connect();
    // No simulateOpen — connect refused. Only an error, no close.
    ctx.sockets[0]!.simulateError('connection refused: CSP connect-src');

    // 'close' was synthesized so the safe_info fallback can mount.
    const closeEvt = ctx.lifecycle.find((e) => e.event === 'close');
    expect(closeEvt).toBeDefined();

    // A reconnect was scheduled exactly once.
    const recons = ctx.lifecycle.filter((e) => e.event === 'reconnect');
    expect(recons).toHaveLength(1);
    expect(recons[0]!.info.attempt).toBe(1);

    vi.advanceTimersByTime(recons[0]!.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2); // reconnected
  });

  it('recovers only ONCE if a pre-open error is later followed by a real close', async () => {
    // Defensive: some browsers may deliver both. The failureHandled guard must
    // dedupe so we do not emit two closes or schedule two reconnects.
    const ctx = build(makeConfig(), () => 0.5);
    ctx.client.connect();
    ctx.sockets[0]!.simulateError('refused');
    ctx.sockets[0]!.simulateClose(1006); // real close arrives afterwards

    expect(ctx.lifecycle.filter((e) => e.event === 'close')).toHaveLength(1);
    expect(ctx.lifecycle.filter((e) => e.event === 'reconnect')).toHaveLength(1);
  });

  it('does NOT synthesize a close from an error on an already-OPEN socket', async () => {
    // An open socket that errors is left to its own real `close` event (the
    // pre-open guard must not fire for an established connection).
    const ctx = build();
    await connect(ctx);
    const closesBefore = ctx.lifecycle.filter((e) => e.event === 'close').length;
    ctx.sockets[0]!.simulateError('mid-stream blip');
    expect(ctx.lifecycle.filter((e) => e.event === 'close').length).toBe(closesBefore);
    expect(ctx.lifecycle.filter((e) => e.event === 'reconnect')).toHaveLength(0);
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

describe('WsClient S41 indefinite + reliable recovery (SPEC-CRWDQ-S41)', () => {
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

  const regCount = (sock: FakeWebSocket): number =>
    sock.sent.filter((s) => JSON.parse(s).message_type === 'DeviceRegistration').length;

  it('re-establishes after an established-then-dropped transport close (proxy/pod roll, 1006)', async () => {
    // The live bug: an OPEN socket drops on a proxy/pod roll (1006) and must
    // re-establish on its own — no manual proxy restart, no F5.
    const ctx = build();
    await connect(ctx);
    expect(ctx.sockets).toHaveLength(1);

    ctx.sockets[0]!.simulateClose(1006); // the roll drops the established conn
    const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
    expect(recon).toBeDefined();

    vi.advanceTimersByTime(recon.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2); // self-healed: a new socket was minted

    // The reconnected socket re-runs the full handshake (re-subscribe to
    // crowdaq.v1 + re-request current state via the seq-bearing registration).
    ctx.sockets[1]!.simulateOpen();
    expect(regCount(ctx.sockets[1]!)).toBe(1);

    // And a real PlannedState arriving on the new socket resets the attempt
    // counter (link proven healthy again).
    ctx.sockets[1]!.simulateMessage(configPush);
    await ctx.client.close();
  });

  it('recovers from REPEATED drops, re-subscribing each time', async () => {
    const ctx = build(makeConfig(), () => 1); // top of jitter window => deterministic
    await connect(ctx);

    for (let i = 0; i < 5; i++) {
      const live = ctx.sockets[ctx.sockets.length - 1]!;
      live.simulateClose(1006);
      const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
      vi.advanceTimersByTime(recon.info.delayMs!);
      const fresh = ctx.sockets[ctx.sockets.length - 1]!;
      fresh.simulateOpen();
      fresh.simulateMessage(configPush); // healthy frame resets backoff each time
      expect(regCount(fresh)).toBe(1); // re-subscribed on every reconnect
    }
    // 1 original + 5 reconnects.
    expect(ctx.sockets).toHaveLength(6);
    await ctx.client.close();
  });

  it('retries FOREVER (never gives up) across many consecutive failed reconnects', async () => {
    // Every reconnect attempt itself fails (pre-open error, no open). The client
    // must keep scheduling — a bar recovers whenever the backend returns.
    const ctx = build(makeConfig({ reconnect: { initialDelayMs: 1_000, maxDelayMs: 4_000, jitter: 'none' } }));
    await connect(ctx);

    ctx.sockets[0]!.simulateClose(1006);
    for (let i = 0; i < 50; i++) {
      const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
      expect(recon.info.attempt).toBe(i + 1); // monotonic, never resets without a live frame
      vi.advanceTimersByTime(recon.info.delayMs!);
      // the freshly-minted socket also fails to open (pre-open error, no close)
      ctx.sockets[ctx.sockets.length - 1]!.simulateError('still down');
    }
    // 50 reconnect attempts scheduled — proof it does not give up.
    expect(ctx.lifecycle.filter((e) => e.event === 'reconnect').length).toBeGreaterThanOrEqual(50);
    await ctx.client.close();
  });

  it('liveness watchdog: a silently-dead (half-open) socket forces a reconnect with no error/close', async () => {
    // The proxy/pod-roll half-open case: the socket stays OPEN, no error and no
    // close ever arrive, frames just stop. The S41 inbound-frame watchdog must
    // detect the silence and reconnect on its own.
    const ctx = build(makeConfig({ livenessTimeoutMs: 70_000 }));
    await connect(ctx); // configPush armed the watchdog

    // No further frames. Advance just past the watchdog window.
    vi.advanceTimersByTime(70_000);

    // The watchdog fired: it force-closed and scheduled a reconnect.
    expect(ctx.sockets[0]!.closedWith?.reason).toBe('ws_liveness_lost');
    const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop();
    expect(recon).toBeDefined();
    vi.advanceTimersByTime(recon!.info.delayMs!);
    expect(ctx.sockets).toHaveLength(2); // self-healed
    await ctx.client.close();
  });

  it('liveness watchdog is RESET by inbound frames (a healthy link never flaps)', async () => {
    const ctx = build(makeConfig({ livenessTimeoutMs: 70_000 }));
    await connect(ctx);

    // A frame every 60s keeps resetting the 70s watchdog — it must never fire.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000);
      ctx.sockets[0]!.simulateMessage(JSON.stringify({ message_type: 'HeartbeatAck', seq: i + 1 }));
    }
    expect(ctx.sockets).toHaveLength(1); // never reconnected
    expect(ctx.lifecycle.filter((e) => e.event === 'reconnect')).toHaveLength(0);
    await ctx.client.close();
  });

  it('re-resolves the WS URL on every reconnect (endpoint may move during a roll)', async () => {
    const urls = ['wss://proxy-a.tailnet/ws', 'wss://proxy-b.tailnet/ws'];
    let i = 0;
    const ctx = build(makeConfig({ url: urls[0]!, resolveUrl: () => urls[Math.min(i, urls.length - 1)] ?? null }));
    await connect(ctx);
    expect(ctx.sockets[0]!.url).toBe('wss://proxy-a.tailnet/ws');

    i = 1; // the proxy moved
    ctx.sockets[0]!.simulateClose(1006);
    const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
    vi.advanceTimersByTime(recon.info.delayMs!);
    expect(ctx.sockets[1]!.url).toBe('wss://proxy-b.tailnet/ws'); // rejoined the new endpoint
    await ctx.client.close();
  });

  it('a clean close() after recovery still suppresses any further reconnect', async () => {
    const ctx = build(makeConfig({ livenessTimeoutMs: 70_000 }));
    await connect(ctx);
    ctx.sockets[0]!.simulateClose(1006);
    const recon = ctx.lifecycle.filter((e) => e.event === 'reconnect').pop()!;
    vi.advanceTimersByTime(recon.info.delayMs!);
    ctx.sockets[1]!.simulateOpen();
    ctx.sockets[1]!.simulateMessage(configPush);

    await ctx.client.close(); // intentional
    const socketsAfter = ctx.sockets.length;
    vi.advanceTimersByTime(300_000); // no watchdog, no reconnect after a clean close
    expect(ctx.sockets).toHaveLength(socketsAfter);
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
