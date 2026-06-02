/**
 * Shared test doubles for the SPEC-CRWDQ-049 overlay suite.
 *
 * Only the override-suppression source and the journal sink are substituted
 * (system boundaries — INV-FACTORY-17). The store, overlay layer, and
 * dispatcher are always REAL (INV-FACTORY-16).
 */
import type {
  MessagingLanePayload,
  MessagingLaneFrame,
} from '../../src/wire/types';
import type {
  OverlayJournal,
  OverlayJournalEntry,
  OverrideSuppressionState,
} from '../../src/overlays/types';

/** In-memory journal recorder — a real sink, not a mock. */
export class RecordingJournal implements OverlayJournal {
  readonly entries: OverlayJournalEntry[] = [];
  record(entry: OverlayJournalEntry): void {
    this.entries.push(entry);
  }
  /** Convenience: entry types in receipt order. */
  types(): string[] {
    return this.entries.map((e) => e.type);
  }
}

/**
 * The writable suppression source SPEC-CRWDQ-063 would own. The overlay sees
 * only the read-only {@link OverrideSuppressionState} view; the test drives it
 * via `setActive`.
 */
export class FakeSuppressionState implements OverrideSuppressionState {
  private active = false;
  private readonly listeners = new Set<(active: boolean) => void>();

  constructor(initial = false) {
    this.active = initial;
  }

  get isActive(): boolean {
    return this.active;
  }

  subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    for (const l of this.listeners) l(active);
  }
}

/** Build a MessagingLane envelope with sensible defaults. */
export function laneFrame(
  payload: Partial<MessagingLanePayload> & Pick<MessagingLanePayload, 'lane_id'>,
): MessagingLaneFrame {
  const validFrom = payload.valid_from ?? '2026-06-01T00:00:00.000Z';
  const validUntil = payload.valid_until ?? '2026-06-01T01:00:00.000Z';
  return {
    message_type: 'MessagingLane',
    payload: {
      bar_id: payload.bar_id ?? 'bar-1',
      lane_id: payload.lane_id,
      text: payload.text ?? 'hello',
      display_form: payload.display_form ?? 'banner',
      dwell_ms: payload.dwell_ms ?? 8000,
      valid_from: validFrom,
      valid_until: validUntil,
    },
  };
}
