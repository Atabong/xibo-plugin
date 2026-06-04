/**
 * SPEC-CRWDQ-023 — in-memory GameState map (D-GRH-12 multiplexed stream, AC6).
 *
 * Two write paths:
 *  - `upsertSnapshot`: a FULL state, always applied, replacing whatever was
 *    held for the game and RESETTING the seq baseline (a snapshot is the
 *    recovery response — it cannot be "out of order"). D-GRH-49 guarantees the
 *    snapshot is in-store before the referencing PlannedState arrives.
 *  - `applyEvent`: a per-field DELTA, seq-ordered. An event whose `seq` is not
 *    strictly greater than the last applied seq for that game is dropped and
 *    journaled `game_event_seq_regression` (AC6). Applied fields overwrite;
 *    absent fields are preserved.
 *
 * Subscribers registered per `game_id` fire on EVERY applied change (snapshot
 * or accepted event). `lastEvent` exposes the most recent applied event so the
 * template can render moment/score deltas the snapshot alone wouldn't carry.
 */
import type { RenderJournal } from './RenderJournal';
import type { GameEvent, GameState, GameStateSnapshot } from './types';

type Listener = (state: GameState) => void;

/** Per-game record: current state, the last applied event seq, last event. */
interface GameRecord {
  state: GameState;
  lastSeq: number;
  lastEvent: GameEvent | null;
  listeners: Set<Listener>;
}

export class GameStateStore {
  private readonly games = new Map<string, GameRecord>();
  /** Cross-game liveness listeners (SPEC-CRWDQ-052 data_stale probe). */
  private readonly allListeners = new Set<(state: GameState) => void>();

  constructor(private readonly journal: RenderJournal) {}

  /**
   * Apply a full snapshot: replace the held state and reset the seq baseline.
   * Always applied (a snapshot is authoritative); fires subscribers.
   */
  upsertSnapshot(snapshot: GameStateSnapshot): void {
    const record = this.ensure(snapshot.game_id);
    record.state = { ...snapshot };
    record.lastSeq = snapshot.seq;
    this.notify(record);
  }

  /**
   * Apply a per-field delta. Dropped (with journal) if `seq` does not advance
   * past the last applied seq for the game. Applied fields overwrite; the rest
   * of the prior state is preserved. Fires subscribers on apply only.
   */
  applyEvent(event: GameEvent): void {
    const record = this.ensure(event.game_id);
    if (event.seq <= record.lastSeq) {
      this.journal.record({
        type: 'game_event_seq_regression',
        game_id: event.game_id,
        seq: event.seq,
        last_applied_seq: record.lastSeq,
      });
      return;
    }
    record.state = this.merge(record.state, event);
    record.lastSeq = event.seq;
    record.lastEvent = event;
    this.notify(record);
  }

  /** Current state for a game, or null if nothing applied yet. */
  get(gameId: string): GameState | null {
    return this.games.get(gameId)?.state ?? null;
  }

  /** Most recent applied event for a game, or null if none applied. */
  lastEvent(gameId: string): GameEvent | null {
    return this.games.get(gameId)?.lastEvent ?? null;
  }

  /** Subscribe to applied mutations for one game. Returns an unsubscribe fn. */
  subscribe(gameId: string, listener: Listener): () => void {
    const record = this.ensure(gameId);
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  /**
   * Subscribe to applied mutations across ALL games — every snapshot or
   * accepted event fires it. The SPEC-CRWDQ-052 SafeStateController uses this
   * as its data_stale liveness signal (any game progress resets the probe),
   * without binding to a specific game id. Returns an unsubscribe fn.
   */
  subscribeAll(listener: (state: GameState) => void): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  private ensure(gameId: string): GameRecord {
    let record = this.games.get(gameId);
    if (!record) {
      record = {
        state: { game_id: gameId, seq: 0 },
        lastSeq: 0,
        lastEvent: null,
        listeners: new Set(),
      };
      this.games.set(gameId, record);
    }
    return record;
  }

  /**
   * Merge a delta onto the prior state: every present field on the event
   * overwrites; `sport_context` merges field-by-field so a clock-only event
   * does not erase the sport/league. The event's `seq` becomes the state seq.
   */
  private merge(prior: GameState, event: GameEvent): GameState {
    const next: GameState = { ...prior, game_id: event.game_id, seq: event.seq };
    if (event.home_team !== undefined) next.home_team = event.home_team;
    if (event.away_team !== undefined) next.away_team = event.away_team;
    if (event.home_score !== undefined) next.home_score = event.home_score;
    if (event.away_score !== undefined) next.away_score = event.away_score;
    if (event.last_moment !== undefined) next.last_moment = event.last_moment;
    if (event.sport_context !== undefined) {
      next.sport_context = { ...prior.sport_context, ...event.sport_context };
    }
    return next;
  }

  private notify(record: GameRecord): void {
    for (const listener of record.listeners) {
      listener(record.state);
    }
    for (const listener of this.allListeners) {
      listener(record.state);
    }
  }
}
