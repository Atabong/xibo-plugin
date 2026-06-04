/**
 * Test double for the browser `WebSocket` surface the {@link WsClient}
 * depends on (the system boundary substituted per INV-FACTORY-17). It is a
 * real object implementing the structural `WebSocketLike` contract plus
 * driver methods the test uses to simulate the server side. No production
 * code is mocked — only the network transport.
 */
import type { WebSocketLike } from '../../../src/transport/WsClient';

export type FakeListener = (ev: unknown) => void;

export class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocol: string;
  readyState = FakeWebSocket.CONNECTING;

  /** Every line passed to `send`, decoded in order. */
  readonly sent: string[] = [];
  /** Close code/reason the client requested via `close()`. */
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;

  private readonly listeners = new Map<string, Set<FakeListener>>();

  constructor(url: string, protocol: string) {
    this.url = url;
    this.protocol = protocol;
  }

  addEventListener(type: string, listener: FakeListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedWith = { code, reason };
  }

  // --- test driver -----------------------------------------------------------

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.fire('open', {});
  }

  /** Push one server line (a complete JSONL frame). */
  simulateMessage(line: string): void {
    this.fire('message', { data: line });
  }

  /** Push a binary payload (ArrayBuffer-shaped). */
  simulateBinary(): void {
    this.fire('message', { data: new ArrayBuffer(8) });
  }

  simulateClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.fire('close', { code, reason });
  }

  simulateError(message = 'transport error'): void {
    this.fire('error', { message });
  }

  private fire(type: string, ev: Record<string, unknown>): void {
    for (const l of this.listeners.get(type) ?? []) {
      l(ev);
    }
  }
}
