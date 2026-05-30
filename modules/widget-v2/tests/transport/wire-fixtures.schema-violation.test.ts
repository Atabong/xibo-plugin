/**
 * Schema-violation, binary, and oversized-frame journaling driven by a real
 * on-wire fixture (SPEC-CRWDQ-022 "Test cases": parse-error frame, unknown
 * message_type, binary frame, frame > 1 MB).
 *
 * `fixtures/wire/schema-violations.jsonl` interleaves valid frames with the
 * full set of malformed lines a runaway server might emit — unknown type,
 * absent / non-string message_type, truncated JSON, and non-object frames.
 * Every line is fed verbatim through the REAL {@link WireDeserializer} into
 * the REAL {@link FrameDispatcher} via the {@link CrowdaqWsClient} read loop.
 * Binary and oversized frames — which cannot be represented as a text line
 * in a JSONL fixture — are driven through the {@link FakeWebSocket} system
 * boundary. Only WebSocket, clock, and journal are substituted
 * (INV-FACTORY-16/-17); nothing is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrowdaqWsClient, type WebSocketLike } from '../../src/transport/WsClient';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import { MAX_FRAME_BYTES } from '../../src/wire';
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

describe('schema-violation journaling from wire fixture (AC1, AC2, AC8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('journals each malformed line and dispatches only the valid frames', async () => {
    const lines = loadWireFixture('schema-violations.jsonl');
    const { client, sockets, dispatcher, journal } = build();

    const configPush = new RecordingHandler();
    const scheduleWindow = new RecordingHandler();
    const gameEvent = new RecordingHandler();
    dispatcher.register('ConfigPush', configPush.handle, 'control');
    dispatcher.register('ScheduleWindow', scheduleWindow.handle, 'control');
    dispatcher.register('GameEvent', gameEvent.handle, 'game_data');

    const p = client.connect();
    sockets[0]!.simulateOpen();
    for (const line of lines) {
      sockets[0]!.simulateMessage(line);
    }
    await p;

    // Only the two well-formed frames reached handlers; nothing malformed did.
    expect(configPush.received).toHaveLength(1);
    expect(scheduleWindow.received).toHaveLength(1);
    expect(gameEvent.received).toHaveLength(0); // the GameEvent line was truncated JSON

    // Every malformation produced a schema_violation_received entry, each
    // carrying the WireError reason and a raw snippet for visibility (AC8).
    const reasons = journal.entries
      .filter((e) => e.type === 'schema_violation_received')
      .map((e) => e.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        'unknown_message_type',
        'missing_message_type',
        'invalid_json',
        'not_an_object',
      ]),
    );
    // Six malformed lines in the fixture (lines 2-7), all journaled.
    expect(reasons).toHaveLength(6);
    for (const entry of journal.entries) {
      if (entry.type === 'schema_violation_received') {
        expect(typeof entry.raw).toBe('string');
        expect((entry.raw as string).length).toBeGreaterThan(0);
      }
    }

    await client.close();
  });

  it('drops and journals a binary frame without crashing (AC9)', async () => {
    const lines = loadWireFixture('schema-violations.jsonl');
    const { client, sockets, journal } = build();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(lines[0]!); // valid ConfigPush resolves connect()
    await p;

    expect(() => sockets[0]!.simulateBinary()).not.toThrow();
    expect(journal.entries.some((e) => e.type === 'binary_frame_dropped')).toBe(true);
    await client.close();
  });

  it('drops and journals a frame larger than 1 MB (AC9)', async () => {
    const lines = loadWireFixture('schema-violations.jsonl');
    const { client, sockets, journal } = build();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(lines[0]!);
    await p;

    const huge = JSON.stringify({
      message_type: 'ConfigPush',
      config_hash: 'x',
      pad: 'a'.repeat(MAX_FRAME_BYTES + 1_000),
    });
    sockets[0]!.simulateMessage(huge);
    expect(journal.entries.some((e) => e.type === 'frame_too_large_dropped')).toBe(true);
    await client.close();
  });
});

describe('schema-violation fixture parsed directly through the deserializer (AC1)', () => {
  it('maps each fixture line to the expected parse-error reason or a typed frame', () => {
    const lines = loadWireFixture('schema-violations.jsonl');
    const de = new WireDeserializer();
    const outcome = lines.map((line) => {
      const r = de.parse(line);
      return 'kind' in r && r.kind === 'parse_error' ? r.reason : (r as { message_type: ServerMessageType }).message_type;
    });
    expect(outcome).toEqual([
      'ConfigPush',
      'unknown_message_type',
      'missing_message_type',
      'missing_message_type', // numeric message_type is not a string
      'invalid_json',
      'not_an_object',
      'not_an_object',
      'ScheduleWindow',
    ]);
  });
});
