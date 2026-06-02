/**
 * SPEC-CRWDQ-063 #62 (part 2) — OverrideInjection end-to-end render-swap latency.
 *
 * Drives a real on-wire `OverrideInjection` envelope through the FULL player
 * receive pipeline exactly as the runtime does: a {@link FakeWebSocket} (the
 * only substituted system boundary, INV-FACTORY-17) feeds one verbatim JSONL
 * line into the REAL {@link WireDeserializer} → REAL {@link FrameDispatcher} →
 * REAL {@link OverrideInjectionHandler} → REAL {@link OverrideOverlayRenderer},
 * with a REAL {@link WritableOverrideSuppressionState}. No production
 * collaborator is mocked (INV-FACTORY-16); only the WS transport and the clock
 * are substituted.
 *
 * AC2: the in-window render swap from override arrival to the overlay DOM being
 * visible completes within 250 ms. This exercises the dispatch + render path
 * through the wire, which part 1's direct-`dispatch()` latency check did not.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrowdaqWsClient, type WebSocketLike } from '../../src/transport/WsClient';
import { FrameDispatcher } from '../../src/transport/Dispatcher';
import { GameStateRequestSender } from '../../src/transport/GameStateRequest';
import { WireDeserializer } from '../../src/transport/Deserializer';
import type { JournalEntry, JournalSink, WsClientConfig } from '../../src/transport/types';
import { WritableOverrideSuppressionState } from '../../src/overrides/OverrideSuppressionState';
import { OverrideOverlayRenderer } from '../../src/overrides/OverrideOverlayRenderer';
import { OverrideInjectionHandler } from '../../src/overrides/OverrideInjectionHandler';
import type { OverrideClass, OverrideInjectionPayload } from '../../src/wire/types';
import { FakeWebSocket } from '../transport/support/FakeWebSocket';
import { RecordingOverrideJournal } from './support';

const NOW = Date.parse('2026-06-01T00:30:00.000Z'); // inside the default window

/** A transport journal sink (system boundary) — a real recorder, not a mock. */
class RecordingTransportJournal implements JournalSink {
  readonly entries: JournalEntry[] = [];
  record(entry: JournalEntry): void {
    this.entries.push(entry);
  }
}

function makeConfig(): WsClientConfig {
  return {
    url: 'wss://bar.tailnet/delivery',
    barId: 'bar-1',
    displayId: 'disp-1',
    playerVersion: '2.0.0',
    heartbeatIntervalMs: 30_000,
    ackTimeoutMs: 60_000,
    reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000, jitter: 'full' },
  };
}

/** A complete on-wire OverrideInjection envelope, serialized as one JSONL line. */
function overrideLine(over: Partial<OverrideInjectionPayload> & { override_id: string }): string {
  const bar_id = over.bar_id ?? 'bar-1';
  const payload: OverrideInjectionPayload = {
    override_id: over.override_id,
    bar_id,
    override_class: over.override_class ?? 'operator_alert',
    payload_ref: over.payload_ref ?? null,
    valid_from: over.valid_from ?? '2026-06-01T00:00:00.000Z',
    valid_to: over.valid_to === undefined ? '2026-06-01T01:00:00.000Z' : over.valid_to,
    precedence: over.precedence ?? 0,
  };
  return JSON.stringify({ message_type: 'OverrideInjection', bar_id, payload });
}

interface Wiring {
  host: HTMLElement;
  client: CrowdaqWsClient;
  sockets: FakeWebSocket[];
  suppression: WritableOverrideSuppressionState;
  journal: RecordingOverrideJournal;
}

/** Wire the full real pipeline; only the WS factory + clock are substituted. */
function wire(): Wiring {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const sockets: FakeWebSocket[] = [];
  const dispatcher = new FrameDispatcher(new GameStateRequestSender(() => {}), {
    isActive: () => false,
  });
  const suppression = new WritableOverrideSuppressionState();
  const journal = new RecordingOverrideJournal();
  // Registering the handler with the dispatcher is its constructor's job.
  new OverrideInjectionHandler({
    dispatcher,
    suppression,
    renderer: new OverrideOverlayRenderer(),
    journal,
    host,
    now: () => Date.now(),
  });

  const client = new CrowdaqWsClient(makeConfig(), {
    webSocketFactory: (url, protocol): WebSocketLike => {
      const ws = new FakeWebSocket(url, protocol);
      sockets.push(ws);
      return ws;
    },
    deserializer: new WireDeserializer(),
    dispatcher,
    journal: new RecordingTransportJournal(),
    now: () => Date.now(),
    random: () => 0.5,
  });
  return { host, client, sockets, suppression, journal };
}

const overlayEl = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('.cdq-override-overlay');

// Real timers throughout (so the wall-clock latency measurement is meaningful),
// with the wire-window clock pinned to a deterministic instant. `clock` is a
// mutable cursor a test can advance to fire a real auto-clear timer; the
// original `Date.now` is restored after each test.
let realNow: () => number;
let clock = NOW;

beforeEach(() => {
  realNow = Date.now;
  clock = NOW;
  Date.now = () => clock;
});
afterEach(() => {
  Date.now = realNow;
  document.body.innerHTML = '';
});

describe('OverrideInjection end-to-end render-swap (AC2)', () => {
  it('mounts the canned overlay within 250 ms of the frame arriving over the wire', async () => {
    const { host, client, sockets, suppression } = wire();
    const p = client.connect();
    sockets[0]!.simulateOpen();

    const start = performance.now();
    sockets[0]!.simulateMessage(overrideLine({ override_id: 'o1', override_class: 'emergency_safety' }));
    const elapsed = performance.now() - start;

    expect(overlayEl(host)).not.toBeNull();
    expect(overlayEl(host)!.dataset['form']).toBe('fullscreen');
    expect(suppression.isActive).toBe(true);
    expect(elapsed).toBeLessThan(250);

    await p;
    await client.close();
  });

  it('routes every override_class through the real wire to its treatment overlay', async () => {
    const cases: Array<[OverrideClass, string, string | undefined]> = [
      ['emergency_safety', 'fullscreen', undefined],
      ['system_maintenance', 'fullscreen', undefined],
      ['scoreboard_correction', 'top-banner', 'Scoreboard under review'],
      ['operator_alert', 'top-banner', 'Notice'],
    ];
    for (const [cls, form, copy] of cases) {
      const { host, client, sockets, journal } = wire();
      const p = client.connect();
      sockets[0]!.simulateOpen();
      sockets[0]!.simulateMessage(overrideLine({ override_id: `o-${cls}`, override_class: cls }));

      const el = overlayEl(host)!;
      expect(el).not.toBeNull();
      expect(el.dataset['form']).toBe(form);
      if (copy) expect(el.textContent).toBe(copy);
      expect(journal.types()).toContain('override_activated');

      await p;
      await client.close();
      document.body.innerHTML = '';
    }
  });

  it('tolerates a non-null payload_ref over the wire, falling back to canned copy', async () => {
    const { host, client, sockets } = wire();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(
      overrideLine({ override_id: 'o1', override_class: 'scoreboard_correction', payload_ref: 'ref-future' }),
    );
    expect(overlayEl(host)!.textContent).toBe('Scoreboard under review');
    await p;
    await client.close();
  });

  it('auto-clears at valid_to after the override arrives over the wire', async () => {
    const { host, client, sockets, suppression, journal } = wire();
    const p = client.connect();
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(
      overrideLine({ override_id: 'o1', valid_to: '2026-06-01T00:30:00.050Z' }),
    );
    expect(suppression.isActive).toBe(true);
    // The handler armed a real 50 ms setTimeout against the injected clock;
    // advance the clock and wait for the real timer to fire.
    clock += 60;
    await new Promise((r) => setTimeout(r, 60));
    expect(overlayEl(host)).toBeNull();
    expect(suppression.isActive).toBe(false);
    expect(journal.ofType('override_resolved')[0]?.resolved_by).toBe('window');
    await p;
    await client.close();
  });
});
