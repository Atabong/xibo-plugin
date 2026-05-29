/**
 * Bidirectional liveness heartbeat (SPEC-CRWDQ-022 step 6, D-GRH-59).
 *
 * Every `intervalMs` (default 30s) the loop emits a no-`seq` `Heartbeat`
 * envelope carrying the player's local clock and current config hash. The
 * server replies with `HeartbeatAck`; `onAck()` clears the outstanding
 * marker. Liveness is purely ack-driven (D-GRH-59 / AC6 — the heartbeat
 * itself carries no `seq`): if an emitted heartbeat is still unacked
 * `ackTimeoutMs` later, the loop invokes `onLivenessLost`, which the
 * {@link WsClient} binds to its close-and-reconnect path.
 *
 * The clock is injected (`now` + the ambient timer functions driven by
 * vitest fake timers under test) so cadence and timeout are deterministic
 * without real wall-clock waits — system boundary per INV-FACTORY-17.
 */
import { buildEnvelope, type HeartbeatFrame, type PlayerToServerFrame } from '../wire';
import type { Heartbeat } from './types';

export interface HeartbeatConfig {
  /** Outbound sink — the same `send` the {@link WsClient} exposes. */
  send: (frame: PlayerToServerFrame) => void;
  /** Cadence between outbound heartbeats (default 30 000ms, D-GRH-59). */
  intervalMs: number;
  /** Max time an emitted heartbeat may stay unacked before liveness is lost. */
  ackTimeoutMs: number;
  /** Current config hash to stamp on the payload (null until first ConfigPush). */
  configHash: () => string | null;
  /** Player-local clock; injected so tests can pin it. */
  now: () => number;
  /** Fired when an outstanding heartbeat exceeds `ackTimeoutMs`. */
  onLivenessLost: () => void;
}

export class HeartbeatLoop implements Heartbeat {
  /** `player_local_ts` of the last emitted heartbeat awaiting an ack, or null. */
  private outstandingTs: number | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private livenessLost = false;

  constructor(private readonly config: HeartbeatConfig) {}

  start(): void {
    this.stop();
    this.livenessLost = false;
    this.intervalHandle = setInterval(() => this.emit(), this.config.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.clearTimeout();
    this.outstandingTs = null;
  }

  onAck(_seq?: number): void {
    this.outstandingTs = null;
    this.clearTimeout();
  }

  outstanding(): number | null {
    return this.outstandingTs;
  }

  private emit(): void {
    const ts = this.config.now();

    // Liveness is measured against the OLDEST unacked heartbeat. If one is
    // still outstanding when the next is due, the deadline already running
    // owns the timeout — do not reset it (resetting on every emit would
    // make a 2x-interval ack window unreachable). A fresh emit only arms a
    // deadline when there is no unacked heartbeat in flight.
    const armDeadline = this.outstandingTs === null;
    this.outstandingTs = ts;

    const frame: HeartbeatFrame = {
      message_type: 'Heartbeat',
      player_local_ts: ts,
      config_hash: this.config.configHash(),
    };
    this.config.send(buildEnvelope(frame));

    if (armDeadline) {
      this.timeoutHandle = setTimeout(() => {
        if (this.outstandingTs !== null && !this.livenessLost) {
          this.livenessLost = true;
          this.config.onLivenessLost();
        }
      }, this.config.ackTimeoutMs);
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
