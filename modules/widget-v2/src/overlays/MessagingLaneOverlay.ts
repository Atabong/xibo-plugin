/**
 * SPEC-CRWDQ-049 — the MessagingLane overlay controller (D-GRH-57 / -58).
 *
 * `mount(rootHost, ctx)` builds the persistent {@link OverlayLayer}, registers
 * the `MessagingLane` dispatch handler (frames flow into the real
 * {@link MessagingLaneStore}), and drives rendering off three inputs: store
 * updates, override-suppression flips, and a single 1 Hz wall-clock tick. The
 * controller is the deep module here — the store, layer, dispatcher, and
 * suppression view are all real collaborators; only time (fake timers) and the
 * suppression source are substituted in tests.
 *
 * Render rules (D-GRH-58 priority stack: OverrideInjection > PlannedState >
 * MessagingLane):
 *  - While `overrideSuppressionState.isActive`, the layer carries
 *    `data-suppressed="true"` and every form hides (binary suppression).
 *  - Otherwise, per `display_form`, the active entries (within
 *    `[valid_from, valid_until)`) cycle — each shown for its own `dwell_ms`,
 *    looping after the last; a single active entry pins (a cycle of one).
 *  - The 1 Hz tick evicts entries past `valid_until` (journalling
 *    `messaging_lane_expired`, or `messaging_lane_expired_during_suppression`
 *    when suppressed) so they never reappear on resume.
 *  - On suppression release, each form resumes from its FRESHEST active entry
 *    (the most recently upserted) and journals `messaging_lane_resumed`.
 */
import type { Dispatcher } from '../transport/types';
import { OverlayLayer } from './OverlayLayer';
import type { MessagingLaneStore } from './MessagingLaneStore';
import {
  DISPLAY_FORMS,
  type DisplayForm,
  type MessagingLaneEntry,
  type OverlayJournal,
  type OverrideSuppressionState,
} from './types';

const TICK_MS = 1000;

export interface MessagingLaneOverlayContext {
  store: MessagingLaneStore;
  overrideSuppressionState: OverrideSuppressionState;
  journal: OverlayJournal;
  dispatcher: Dispatcher;
}

/** Per-form cycle position: which lane is on screen and since when (ms epoch). */
interface FormCursor {
  laneId: string;
  shownAtMs: number;
}

export class MessagingLaneOverlay {
  /**
   * Mount the overlay layer and wire it to the store, dispatcher, suppression
   * source, and a 1 Hz clock. Returns an unmount handle that tears all of it
   * down (clears the tick, unsubscribes, removes the layer DOM).
   */
  mount(rootHost: HTMLElement, ctx: MessagingLaneOverlayContext): () => void {
    const layer = new OverlayLayer();
    rootHost.appendChild(layer.element());

    const cursors = new Map<DisplayForm, FormCursor>();

    const evaluate = (resumingForms?: ReadonlySet<DisplayForm>): void => {
      const now = new Date();

      if (ctx.overrideSuppressionState.isActive) {
        layer.setSuppressed(true);
        for (const form of DISPLAY_FORMS) layer.render(null, form);
        return;
      }

      layer.setSuppressed(false);
      const active = ctx.store.active(now);
      const nowMs = now.getTime();

      for (const form of DISPLAY_FORMS) {
        const entries = active.filter((e) => e.display_form === form);
        const resuming = resumingForms?.has(form) ?? false;
        const entry = pickForForm(entries, cursors, form, nowMs, resuming);
        if (entry === null) {
          cursors.delete(form);
          layer.render(null, form);
        } else {
          layer.render(entry, form);
          if (resuming && entries.length > 0) {
            ctx.journal.record({ type: 'messaging_lane_resumed', display_form: form, lane_id: entry.lane_id });
          }
        }
      }
    };

    // 1 Hz tick: evict expired entries first (journalling per suppression
    // state), then re-evaluate the cycle.
    const onTick = (): void => {
      const now = new Date();
      const suppressed = ctx.overrideSuppressionState.isActive;
      for (const expired of ctx.store.evictExpired(now)) {
        ctx.journal.record({
          type: suppressed ? 'messaging_lane_expired_during_suppression' : 'messaging_lane_expired',
          lane_id: expired.lane_id,
          display_form: expired.display_form,
        });
      }
      evaluate();
    };
    const interval = setInterval(onTick, TICK_MS);

    // MessagingLane frames upsert into the store (D-GRH-57). The store change
    // notification re-evaluates the cycle so a new/replaced entry shows at once.
    ctx.dispatcher.register(
      'MessagingLane',
      (frame) => ctx.store.upsert(frame),
      'control',
    );
    const unsubStore = ctx.store.subscribe(() => evaluate());

    // Suppression release resumes each form from its freshest active entry.
    const unsubSuppress = ctx.overrideSuppressionState.subscribe((active) => {
      evaluate(active ? undefined : new Set(DISPLAY_FORMS));
    });

    // Initial paint (covers an already-active suppression at mount).
    evaluate();

    return () => {
      clearInterval(interval);
      unsubStore();
      unsubSuppress();
      layer.element().remove();
    };
  }
}

/**
 * Choose the entry to show for `form`, advancing the cursor by `dwell_ms`.
 *  - no active entries → null (form hides).
 *  - resuming → the freshest (last-received) active entry; reset the cursor.
 *  - cursor's lane still active and dwell not elapsed → keep it.
 *  - otherwise advance to the next active entry in receive order (loop).
 */
function pickForForm(
  entries: readonly MessagingLaneEntry[],
  cursors: Map<DisplayForm, FormCursor>,
  form: DisplayForm,
  nowMs: number,
  resuming: boolean,
): MessagingLaneEntry | null {
  if (entries.length === 0) return null;

  if (resuming) {
    const freshest = entries[entries.length - 1]!;
    cursors.set(form, { laneId: freshest.lane_id, shownAtMs: nowMs });
    return freshest;
  }

  const cursor = cursors.get(form);
  const currentIndex = cursor ? entries.findIndex((e) => e.lane_id === cursor.laneId) : -1;

  // No live cursor (first paint, or the shown lane expired/was removed): start
  // at the first active entry.
  if (!cursor || currentIndex === -1) {
    const first = entries[0]!;
    cursors.set(form, { laneId: first.lane_id, shownAtMs: nowMs });
    return first;
  }

  const current = entries[currentIndex]!;
  if (nowMs - cursor.shownAtMs < current.dwell_ms) {
    return current; // still within its dwell — keep showing
  }

  // Dwell elapsed — advance to the next active entry, looping after the last.
  const next = entries[(currentIndex + 1) % entries.length]!;
  cursors.set(form, { laneId: next.lane_id, shownAtMs: nowMs });
  return next;
}
