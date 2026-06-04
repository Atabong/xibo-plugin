/**
 * Re-push happy-path coverage driven by a real on-wire fixture
 * (SPEC-CRWDQ-022 "Test cases": the full re-push fixture).
 *
 * The fixture `fixtures/wire/re-push-happy.jsonl` is fed line-by-line —
 * full envelopes, verbatim — through the REAL {@link WireDeserializer} into
 * the REAL {@link FrameDispatcher}, exercised end-to-end via the
 * {@link CrowdaqWsClient} read loop. Only the WebSocket, the clock, and the
 * journal sink are substituted (INV-FACTORY-17); the deserializer,
 * dispatcher, heartbeat, and the SPEC-CRWDQ-017 wire module are real
 * instances (INV-FACTORY-16). Handlers are `RecordingHandler`s — real
 * collaborators that capture receipt order, not mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrowdaqWsClient, type WebSocketLike } from '../../src/transport/WsClient';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import type {
  JournalEntry,
  JournalSink,
  ServerFrame,
  ServerMessageType,
  WsClientConfig,
} from '../../src/transport/types';
import { FakeWebSocket } from './support/FakeWebSocket';
import { loadWireFixture } from './support/fixtures';

class RecordingJournal implements JournalSink {
  readonly entries: JournalEntry[] = [];
  record(entry: JournalEntry): void {
    this.entries.push(entry);
  }
}

/** Captures frames in receipt order — a real handler, not a mock. */
class RecordingHandler {
  readonly received: ServerFrame[] = [];
  readonly handle = (f: ServerFrame): void => {
    this.received.push(f);
  };
}

const allActive: ActiveGames = { isActive: () => true };

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

function build() {
  const sockets: FakeWebSocket[] = [];
  const journal = new RecordingJournal();
  const dispatcher = new FrameDispatcher(new GameStateRequestSender(() => {}), allActive);
  const client = new CrowdaqWsClient(makeConfig(), {
    webSocketFactory: (url, protocol): WebSocketLike => {
      const ws = new FakeWebSocket(url, protocol);
      sockets.push(ws);
      return ws;
    },
    deserializer: new WireDeserializer(),
    dispatcher,
    journal,
    now: () => Date.now(),
    random: () => 0.5,
  });
  return { client, sockets, journal, dispatcher };
}

describe('re-push happy path from wire fixture (AC1, AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers each frame to its handler in the server-pushed order with no out-of-order receipt', async () => {
    const lines = loadWireFixture('re-push-happy.jsonl');
    const { client, sockets, dispatcher, journal } = build();

    // Register one RecordingHandler per re-push type, on the correct channel.
    const order: ServerMessageType[] = [];
    const tap = (mt: ServerMessageType) => {
      const h = new RecordingHandler();
      const wrapped = (f: ServerFrame): void => {
        order.push(mt);
        h.handle(f);
      };
      return { h, wrapped };
    };
    const configPush = tap('ConfigPush');
    const scheduleWindow = tap('ScheduleWindow');
    const assetManifest = tap('AssetManifest');
    const plannedState = tap('PlannedState');
    const gameState = tap('GameState');

    dispatcher.register('ConfigPush', configPush.wrapped, 'control');
    dispatcher.register('ScheduleWindow', scheduleWindow.wrapped, 'control');
    dispatcher.register('AssetManifest', assetManifest.wrapped, 'control');
    dispatcher.register('PlannedState', plannedState.wrapped, 'control');
    dispatcher.register('GameState', gameState.wrapped, 'game_data');

    const p = client.connect();
    sockets[0]!.simulateOpen();
    // First line (ConfigPush) resolves connect(); the rest stream after.
    for (const line of lines) {
      sockets[0]!.simulateMessage(line);
    }
    await p;

    // Exact canonical re-push order (D-GRH-49 + D-GRH-61), nothing dropped.
    expect(order).toEqual([
      'ConfigPush',
      'ScheduleWindow',
      'AssetManifest',
      'PlannedState',
      'GameState',
    ]);

    // Each handler saw exactly its own frame, full envelope preserved.
    expect(configPush.h.received).toHaveLength(1);
    expect(configPush.h.received[0]).toMatchObject({ message_type: 'ConfigPush', config_hash: 'cfg-9f3a' });
    expect(gameState.h.received[0]).toMatchObject({
      message_type: 'GameState',
      game_id: 'game-001',
      home_score: 0,
      away_score: 0,
    });

    // A clean happy-path transcript journals nothing.
    expect(journal.entries).toHaveLength(0);

    await client.close();
  });

  it('parses every fixture line through the real deserializer without a parse error', () => {
    const lines = loadWireFixture('re-push-happy.jsonl');
    const de = new WireDeserializer();
    for (const line of lines) {
      const result = de.parse(line);
      expect('message_type' in result).toBe(true);
    }
  });
});
