/**
 * SPEC-CRWDQ-063 — Widget v2 OverrideInjection handler (phase-1 canned overlay).
 *
 * Registered as the `Dispatcher`'s `OverrideInjection` handler on the control
 * channel. On an in-window frame it sets the shared `overrideSuppressionState`
 * (D-GRH-58 binary suppress — fires SPEC-CRWDQ-049's overlay layer
 * synchronously), mounts a built-in CANNED overlay chosen by `override_class`
 * (no operator content is on the wire in phase-1), and arms a single
 * wall-clock timer to auto-clear at `valid_to`. It is self-contained — NOT
 * routed through `PlannedStateActivator`, and it carries no `PlannedState`
 * render fields (none exist on the wire).
 *
 * Window: an override expired on arrival is dropped (journal only); a future
 * override arms a timer at `valid_from`; an in-window override activates
 * immediately (dwell bypass, D-GRH-24). `valid_to === null` is indefinite —
 * no expiry timer, holds until superseded.
 *
 * Supersede: a single active slot. Higher wire `precedence` supersedes; an
 * equal precedence is last-write-wins; a strictly lower precedence is ignored.
 * Suppression stays `true` across a swap (no flap). The same `override_id` is
 * an idempotent no-op (kept even though the backend never re-pushes).
 *
 * Render failure is a player-runtime safe (D-GRH-76): journalled
 * `override_render_error` with `runtime_reason: 'render_error'`, never rendered
 * on screen.
 */
import type { Dispatcher } from '../transport/types';
import type { OverrideInjectionFrame, OverrideInjectionPayload } from '../wire/types';
import type { OverrideSuppressionState } from '../overlays/types';
import type { OverrideJournal } from './types';
import { OVERRIDE_CLASS_TREATMENT, type OverrideTreatment } from './overrideClassTreatment';

/**
 * The structural surface the handler needs from the overlay renderer (the real
 * {@link OverrideOverlayRenderer} satisfies it). Kept minimal so the handler
 * depends on behaviour, not the concrete class.
 */
export interface OverlayRendererLike {
  mount(treatment: OverrideTreatment, host: HTMLElement): () => void;
}

export interface OverrideInjectionHandlerDeps {
  dispatcher: Dispatcher;
  suppression: OverrideSuppressionState & { setActive(active: boolean): void };
  renderer: OverlayRendererLike;
  journal: OverrideJournal;
  /** The host element the canned overlay mounts into. */
  host: HTMLElement;
  /** Wall clock (system boundary — INV-FACTORY-17). Defaults to `Date.now`. */
  now?: () => number;
}

/** The single active override slot. */
interface ActiveSlot {
  override_id: string;
  precedence: number;
  detach: () => void;
  /** Pending auto-clear / future-arm timer, if any. */
  timer: ReturnType<typeof setTimeout> | null;
}

export class OverrideInjectionHandler {
  private readonly dispatcher: Dispatcher;
  private readonly suppression: OverrideSuppressionState & { setActive(active: boolean): void };
  private readonly renderer: OverlayRendererLike;
  private readonly journal: OverrideJournal;
  private readonly host: HTMLElement;
  private readonly now: () => number;

  /** The single active override, or null when nothing is showing. */
  private active: ActiveSlot | null = null;
  /** A future override armed but not yet activated (its timer pending). */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: OverrideInjectionHandlerDeps) {
    this.dispatcher = deps.dispatcher;
    this.suppression = deps.suppression;
    this.renderer = deps.renderer;
    this.journal = deps.journal;
    this.host = deps.host;
    this.now = deps.now ?? Date.now;
    this.dispatcher.register('OverrideInjection', (frame) => this.handle(frame), 'control');
  }

  handle(frame: OverrideInjectionFrame): void {
    const p = frame.payload;

    // 1. Duplicate check — same override_id as the active slot is a no-op.
    if (this.active && this.active.override_id === p.override_id) return;

    // 2. Precedence gate — an active override governs whether the incoming
    //    one may proceed (window evaluation happens only past this gate).
    if (this.active) {
      if (p.precedence < this.active.precedence) {
        this.journal.record({
          type: 'override_suppressed_lower_precedence',
          override_id: p.override_id,
          override_class: p.override_class,
          precedence: p.precedence,
        });
        return;
      }
      // incoming >= active: supersede (higher wins; equal = last-write-wins).
      this.supersedeActive();
    }

    // 3. Window evaluation (now read once).
    const nowMs = this.now();
    const validFromMs = Date.parse(p.valid_from);
    const validToMs = p.valid_to === null ? null : Date.parse(p.valid_to);

    if (validToMs !== null && nowMs >= validToMs) {
      // Expired on arrival — drop, no render, no suppression.
      this.journal.record({
        type: 'override_expired_on_arrival',
        override_id: p.override_id,
        override_class: p.override_class,
      });
      return;
    }

    if (nowMs < validFromMs) {
      // Future — arm a wall-clock timer; activate at valid_from.
      this.clearPendingTimer();
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.activate(p);
      }, validFromMs - nowMs);
      return;
    }

    // In window (or indefinite) — activate immediately (dwell bypass).
    this.activate(p);
  }

  /** Steps 4–6: set suppression, mount the canned overlay, arm auto-clear. */
  private activate(p: OverrideInjectionPayload): void {
    // 4. Suppression — synchronous; SPEC-CRWDQ-049 flips data-suppressed now.
    this.suppression.setActive(true);

    // 5. Render the canned overlay for override_class. A non-null payload_ref
    //    is forward-compat: fall back to the canned copy (content resolution
    //    deferred — never crash). A render failure is a runtime safe (D-GRH-76).
    const treatment = OVERRIDE_CLASS_TREATMENT[p.override_class];
    let detach: () => void;
    try {
      detach = this.renderer.mount(treatment, this.host);
    } catch {
      this.journal.record({
        type: 'override_render_error',
        override_id: p.override_id,
        override_class: p.override_class,
        runtime_reason: 'render_error',
      });
      return;
    }

    this.journal.record({
      type: 'override_activated',
      override_id: p.override_id,
      override_class: p.override_class,
      precedence: p.precedence,
    });

    // 6. Auto-clear — a single wall-clock timer at valid_to, or indefinite.
    const validToMs = p.valid_to === null ? null : Date.parse(p.valid_to);
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (validToMs === null) {
      this.journal.record({ type: 'override_indefinite', override_id: p.override_id });
    } else {
      timer = setTimeout(() => this.resolveActive('window'), validToMs - this.now());
    }

    this.active = { override_id: p.override_id, precedence: p.precedence, detach, timer };
  }

  /** Tear down the active slot (overlay + timer) and journal a supersede. */
  private supersedeActive(): void {
    const slot = this.active;
    if (!slot) return;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.detach();
    this.active = null;
    // Suppression intentionally stays true across the swap — no flap.
    this.journal.record({
      type: 'override_resolved',
      override_id: slot.override_id,
      resolved_by: 'supersede',
    });
  }

  /** Window-expiry clear: detach, drop suppression, journal resolved_by window. */
  private resolveActive(resolvedBy: 'window'): void {
    const slot = this.active;
    if (!slot) return;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.detach();
    this.active = null;
    this.suppression.setActive(false);
    this.journal.record({
      type: 'override_resolved',
      override_id: slot.override_id,
      resolved_by: resolvedBy,
    });
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
