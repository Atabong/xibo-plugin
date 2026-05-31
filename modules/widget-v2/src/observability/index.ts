/**
 * SPEC-CRWDQ-061 — the observability barrel + the shared `emit` adapter (AC3).
 *
 * Every template / runtime path that wants to journal an event calls
 * {@link Observer.emit} rather than touching the {@link JournalStore} directly.
 * The adapter:
 *  - maps the fine-grained internal event name onto one of the six closed-set
 *    buckets via the fixed {@link bucketFor} table,
 *  - preserves the fine name under `payload.event` so backend aggregation keeps
 *    full fidelity (D-GRH-29),
 *  - appends through the real store with an ISO `ts` from the injected clock,
 *  - NEVER throws: journaling is best-effort and must not break a render path.
 *    A store/persistence failure is swallowed (a `console.error` breadcrumb is
 *    the only surfacing — the journal cannot reliably journal its own write
 *    fault when the write path is the thing that failed).
 */
import { bucketFor } from './bucketTable';
import type { JournalStore } from './JournalStore';

export { JournalStore } from './JournalStore';
export { JournalSyncClient } from './JournalSyncClient';
export type { JournalSyncClientDeps } from './JournalSyncClient';
export { bucketFor, FINE_TO_BUCKET, DEFAULT_BUCKET } from './bucketTable';
export {
  PLAYER_JOURNAL_EVENT_TYPES,
  isPlayerJournalEventType,
} from './types';
export type {
  PlayerJournalEventType,
  JournalEntry,
  JournalAppend,
  JournalIdentity,
  JournalSyncConfig,
  JournalSyncWsClient,
  SyncOutcome,
} from './types';

/**
 * Optional post-append hook so a full batch reached via the shared emit path
 * drains immediately (AC8) instead of waiting for the periodic interval. The
 * {@link JournalSyncClient}'s `onAppended` satisfies this; it is injected (not
 * imported) so {@link Observer} keeps no hard dependency on the sync client and
 * can be used without one (e.g. in store-only tests).
 */
export interface AppendHook {
  onAppended(): Promise<unknown> | void;
}

export class Observer {
  constructor(
    private readonly store: JournalStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly onAppended?: AppendHook,
  ) {}

  /**
   * Journal a fine-grained internal event. Best-effort: returns once the row
   * is durably appended, or silently after swallowing a store failure. The
   * fine name is bucketed for `event_type` and echoed into `payload.event`.
   * After a successful append it pokes the optional backlog hook so a burst
   * that fills a batch via this path drains at `maxBatchSize` (AC8).
   */
  async emit(internalEvent: string, payload: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.store.append({
        ts: this.now(),
        event_type: bucketFor(internalEvent),
        payload: { ...payload, event: internalEvent },
      });
    } catch (err) {
      // AC3 — never propagate. The render path that emitted this must not see
      // a journaling fault.
      console.error('[observability] journal append failed', internalEvent, err);
      return;
    }
    // Fire-and-forget the backlog trigger: a sync fault must not surface on the
    // render path either, and onAppended itself never throws synchronously.
    void this.onAppended?.onAppended();
  }
}
