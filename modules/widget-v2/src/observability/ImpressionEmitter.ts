/**
 * SPEC-CRWDQ-S105 — widget ad-impression emit.
 *
 * Closes the loop: when an `AdPanel` actually renders an ad creative it records
 * an `ad_slot_rendered` render-journal event (D-GRH-29, on the image `load`).
 * This adapter is a {@link RenderJournal} DECORATOR that forwards EVERY event to
 * the inner sink (the always-on console breadcrumb) AND, for an
 * `ad_slot_rendered` event, emits it through the SPEC-CRWDQ-061 {@link Observer}
 * so it lands in the durable {@link JournalStore} and drains to the backend over
 * the existing `JournalSync` WS path.
 *
 * Why the journal path (not a new frame): the bar identity on that channel is
 * already verified at WS DeviceRegistration, and the backend delivery server's
 * JournalSync handler already persists the entries — so the impression rides the
 * authenticated player→backend channel with no new auth surface. The Observer
 * buckets `ad_slot_rendered` onto the closed-set `event_type`
 * `planned_state_render` and preserves the fine name under `payload.event`
 * (AC3); the backend meters an impression for any entry whose
 * `payload.event === 'ad_slot_rendered'`.
 *
 * Attribution/cost is the backend's job (creative `ad_ref` → campaign →
 * cost_per_impression_cents). The widget only emits {ad_ref, ad_slot_id,
 * state_id, shown_at}. Fire-once per genuine render: the AdPanel wires
 * `ad_slot_rendered` to the image `load` with `{ once: true }`, so this fires
 * exactly once per creative paint (not per frame). Best-effort: Observer.emit
 * never throws, so a store/sync fault never blocks the render.
 */
import type { RenderJournal, RenderJournalEntry } from '../render/RenderJournal';
import type { Observer } from './index';

export interface ImpressionEmitterDeps {
  /** The always-on inner sink (console breadcrumb) — every event forwards here. */
  inner: RenderJournal;
  /** The SPEC-CRWDQ-061 emit adapter (durable store + WS drain). */
  observer: Observer;
  /** Wall-clock for the `shown_at` stamp; injected for deterministic tests. */
  now?: () => Date;
}

export class ImpressionEmitter implements RenderJournal {
  private readonly inner: RenderJournal;
  private readonly observer: Observer;
  private readonly now: () => Date;

  constructor(deps: ImpressionEmitterDeps) {
    this.inner = deps.inner;
    this.observer = deps.observer;
    this.now = deps.now ?? ((): Date => new Date());
  }

  record(entry: RenderJournalEntry): void {
    // Always forward to the inner sink first (the local breadcrumb is never lost).
    this.inner.record(entry);
    if (entry.type !== 'ad_slot_rendered') return;

    const shownAt = this.now().toISOString();
    // Observer buckets this to `planned_state_render` + echoes
    // `payload.event = 'ad_slot_rendered'`; the backend meters on that.
    void this.observer.emit('ad_slot_rendered', {
      ad_ref: typeof entry['ad_ref'] === 'string' ? (entry['ad_ref'] as string) : '',
      ad_slot_id: typeof entry['ad_slot_id'] === 'string' ? (entry['ad_slot_id'] as string) : '',
      state_id: typeof entry['state_id'] === 'string' ? (entry['state_id'] as string) : '',
      shown_at: shownAt,
    });
  }
}
