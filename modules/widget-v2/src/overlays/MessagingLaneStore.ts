/**
 * SPEC-CRWDQ-049 — the MessagingLane entry store (D-GRH-57).
 *
 * Upserts `Envelope<MessagingLanePayload>` frames by `lane_id`: a new frame
 * with the same `lane_id` replaces the prior entry in place. Entries are kept
 * (including ones not yet in their validity window) until their `valid_until`
 * passes, at which point a clock tick evicts them via {@link evictExpired}.
 * `active(now)` is the window-filtered view the overlay renders.
 *
 * Defence-in-depth (AC8): a frame whose `display_form` is outside the closed
 * SPEC-CRWDQ-047 enum `{banner, ticker, toast}` is journalled as a
 * `schema_violation_received` and NOT stored — such a frame should never reach
 * the wire (the endpoint rejects it), but the player still guards.
 */
import type { MessagingLaneFrame } from '../wire/types';
import {
  DISPLAY_FORMS,
  type DisplayForm,
  type MessagingLaneEntry,
  type OverlayJournal,
} from './types';

type StoreListener = (entries: readonly MessagingLaneEntry[]) => void;

const DISPLAY_FORM_SET: ReadonlySet<string> = new Set<string>(DISPLAY_FORMS);

function isDisplayForm(value: string): value is DisplayForm {
  return DISPLAY_FORM_SET.has(value);
}

export class MessagingLaneStore {
  /** Keyed by `lane_id`; insertion order is the cycle/receive order. */
  private readonly entries = new Map<string, MessagingLaneEntry>();
  private readonly listeners = new Set<StoreListener>();

  constructor(private readonly journal: OverlayJournal) {}

  /** Upsert by `lane_id`. Unknown `display_form` is rejected (not stored). */
  upsert(frame: MessagingLaneFrame): void {
    const p = frame.payload;
    if (!isDisplayForm(p.display_form)) {
      this.journal.record({
        type: 'schema_violation_received',
        lane_id: p.lane_id,
        display_form: p.display_form,
        reason: 'unknown_display_form',
      });
      return;
    }

    // Replacing an existing lane_id keeps no stale insertion slot: Map.set on
    // an existing key preserves the original position, so a same-lane replace
    // does not reorder the cycle.
    this.entries.set(p.lane_id, {
      lane_id: p.lane_id,
      text: p.text,
      display_form: p.display_form,
      dwell_ms: p.dwell_ms,
      valid_from: p.valid_from,
      valid_until: p.valid_until,
      receivedAt: new Date(),
    });
    this.notify();
  }

  /** Entries whose validity window contains `now`, in receive order. */
  active(now: Date): readonly MessagingLaneEntry[] {
    const t = now.getTime();
    const result: MessagingLaneEntry[] = [];
    for (const entry of this.entries.values()) {
      if (isWithin(entry, t)) result.push(entry);
    }
    return result;
  }

  /**
   * Remove entries whose `valid_until` is at or before `now` and return them
   * (so the caller can journal the expiry). Called by the overlay's 1 Hz tick.
   */
  evictExpired(now: Date): readonly MessagingLaneEntry[] {
    const t = now.getTime();
    const evicted: MessagingLaneEntry[] = [];
    for (const [laneId, entry] of this.entries) {
      if (Date.parse(entry.valid_until) <= t) {
        evicted.push(entry);
        this.entries.delete(laneId);
      }
    }
    if (evicted.length > 0) this.notify();
    return evicted;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener(snapshot);
  }
}

function isWithin(entry: MessagingLaneEntry, nowMs: number): boolean {
  return Date.parse(entry.valid_from) <= nowMs && nowMs < Date.parse(entry.valid_until);
}
