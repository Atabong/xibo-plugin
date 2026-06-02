/**
 * Shared test doubles for the SPEC-CRWDQ-063 override suite.
 *
 * Only the journal sink (system boundary — INV-FACTORY-17) is substituted with
 * an in-memory recorder (a real sink, not a mock). The `Dispatcher`,
 * `OverrideSuppressionState`, `OverrideOverlayRenderer`, and (in the integration
 * test) `MessagingLaneOverlay` are always REAL (INV-FACTORY-16). The wall clock
 * and timers are driven by vitest fake timers, not stubbed collaborators.
 */
import type { GameStateRequester } from '../../src/transport/types';
import type { ActiveGames } from '../../src/transport/Dispatcher';
import type { OverrideInjectionFrame, OverrideInjectionPayload } from '../../src/wire/types';
import type { OverrideJournal, OverrideJournalEntry } from '../../src/overrides/types';

/** A no-op active-game set / requester — overrides never drive game seq. */
export const inertGames: ActiveGames = { isActive: () => false };
export const inertRequester: GameStateRequester = {
  requestForGap: () => {},
  resolve: () => {},
};

/** In-memory journal recorder — a real sink, not a mock. */
export class RecordingOverrideJournal implements OverrideJournal {
  readonly entries: OverrideJournalEntry[] = [];
  record(entry: OverrideJournalEntry): void {
    this.entries.push(entry);
  }
  types(): string[] {
    return this.entries.map((e) => e.type);
  }
  ofType(type: string): OverrideJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

/** Build an OverrideInjection envelope with sensible phase-1 defaults. */
export function overrideFrame(
  payload: Partial<OverrideInjectionPayload> & Pick<OverrideInjectionPayload, 'override_id'>,
): OverrideInjectionFrame {
  const bar_id = payload.bar_id ?? 'bar-1';
  return {
    message_type: 'OverrideInjection',
    bar_id,
    payload: {
      override_id: payload.override_id,
      bar_id,
      override_class: payload.override_class ?? 'operator_alert',
      payload_ref: payload.payload_ref ?? null,
      valid_from: payload.valid_from ?? '2026-06-01T00:00:00.000Z',
      valid_to: payload.valid_to === undefined ? '2026-06-01T01:00:00.000Z' : payload.valid_to,
      precedence: payload.precedence ?? 0,
    },
  };
}
