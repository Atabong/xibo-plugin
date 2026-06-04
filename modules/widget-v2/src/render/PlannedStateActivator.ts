/**
 * SPEC-CRWDQ-023 — PlannedState activation orchestration (AC2, AC4, AC5).
 *
 * The deep module that turns an incoming `PlannedState` frame into rendered
 * DOM. Registered as the dispatcher's `PlannedState` handler (and, so it can
 * un-buffer, the `ProgramSlot` handler). For a `single_game` PlannedState it:
 *
 *   1. resolves the referenced ProgramSlot (D-GRH-21);
 *   2. if the slot is absent, BUFFERS the PlannedState up to 5 s, proceeding
 *      the moment the slot arrives, else journaling `template_buffer_timeout`
 *      + emitting `template_render_fallback` (AC4);
 *   3. if `program_slot_id` is null, does NOT buffer — renders the no-live-game
 *      placeholder, journals `template_render_fallback`
 *      (`single_game_missing_program_slot`), and still arms the dwell (AC5);
 *   4. runs the named transition (AC9), mounts the template (AC1), and arms the
 *      dwell timer (AC10);
 *   5. on the dwell boundary, journals `dwell_boundary_reached` and — only if a
 *      preference apply is pending — swaps the theme stylesheet, consuming the
 *      pending slot (AC8).
 *
 * Idempotent on a repeated `state_id` (re-push artifact): exactly one
 * transition + one mount (AC2). A new `state_id` supersedes: cancel dwell, run
 * the outgoing transition, detach, then activate the newcomer.
 */
import type { PlannedStateFrame, ProgramSlotFrame, ThemeChoiceWire, BarPreferencesWire, BusinessMode } from '../wire';
import type { Dispatcher } from '../transport/types';
import type { GameStateStore } from './GameStateStore';
import type { CrestResolver } from './CrestResolver';
import type { ProgramSlotResolver } from './ProgramSlotResolver';
import type { TransitionExecutor } from './TransitionExecutor';
import type { DwellTimer, DwellClock } from './DwellTimer';
import type { RenderJournal } from './RenderJournal';
import type { StyleSheetRegistry } from './StyleSheetRegistry';
import { resolveTheme, themeAttr, type BarThemeSource, type ResolvedTheme } from './ThemeResolver';
import type { PlannedStatePayload, ProgramSlotPayload } from './types';
import {
  TESTID,
  type SingleGameContext,
  type SingleGameInstance,
} from '../templates/single-game/SingleGameTemplate';
import type { TemplateInstance, TemplateReconcileEvent } from './TemplateInstance';
import {
  mountOverlayComposite,
  type AdSlotResolver,
  type SingleGameOverlayAd,
} from '../templates/single-game/SingleGameOverlay';

/** Drains the pending preference apply at a dwell boundary (SPEC-014 slot). */
export interface PendingThemeApply {
  takePending(): BarPreferencesWire | null;
}

/**
 * The arguments a per-`business_mode` template adapter needs to mount one
 * PlannedState's render (SPEC-CRWDQ-052/-053 multi-mode seam, INV-FACTORY-19).
 * The activator owns the shared lifecycle (buffer, transition, dwell, supersede,
 * reconcile dispatch) and delegates ONLY the mode-specific mount to the adapter.
 */
export interface TemplateMountArgs {
  host: HTMLElement;
  payload: PlannedStatePayload;
  slot: ProgramSlotPayload;
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
}

/** A mounted render: the instance + the games whose revisions it consumes. */
export interface TemplateMount {
  instance: TemplateInstance;
  /** The `game_id`s this render subscribes to — the reconcile gate (AC4). */
  subscribedGameIds: ReadonlySet<string>;
}

/**
 * A per-`business_mode` template seam (INV-FACTORY-19). `single_game` is the
 * activator's built-in adapter; safe_info (SPEC-CRWDQ-052) and ambient
 * (SPEC-CRWDQ-053) register themselves via {@link PlannedStateActivator.registerTemplate}
 * so they activate through the SAME orchestration — never a forked path.
 * Returning `null` declines the mount (the adapter has journaled why); the
 * activator then renders nothing for that state.
 */
export interface TemplateAdapter {
  mount(args: TemplateMountArgs): TemplateMount | null;
}

/**
 * The template seam the activator mounts (INV-FACTORY-19). The bare
 * `SingleGameTemplate` is one adapter; SPEC-CRWDQ-065's reconcile-capable
 * composite is the second. The activator depends on the `mount` shape, not the
 * concrete class, so a reconcile-capable variant slots in without a fork.
 */
export interface SingleGameTemplateLike {
  mount(host: HTMLElement, context: SingleGameContext): SingleGameInstance;
}

/** Default ProgramSlot buffer window before falling through (AC4). */
export const BUFFER_TIMEOUT_MS = 5000;

export interface PlannedStateActivatorDeps {
  host: HTMLElement;
  slots: ProgramSlotResolver;
  gameStateStore: GameStateStore;
  transitions: TransitionExecutor;
  dwell: DwellTimer;
  template: SingleGameTemplateLike;
  journal: RenderJournal;
  styleSheets: StyleSheetRegistry;
  barTheme: BarThemeSource;
  pendingApply: PendingThemeApply;
  clock: DwellClock;
  /**
   * Overlay-ad seam (AC6–AC9). Both optional: a bare single_game deployment
   * needs neither. When `ad_slot_id` is non-null the activator resolves the
   * AdSlot via `adSlots` and either delegates to `overlayAd` (payload present,
   * AC8) or mounts the empty overlay (payload absent, AC7).
   */
  adSlots?: AdSlotResolver;
  overlayAd?: SingleGameOverlayAd;
  /**
   * Optional post-activation observer (SPEC-CRWDQ-052). Fired with the
   * business_mode immediately after a state is successfully rendered, so the
   * SafeStateController can cancel its no_recent_state probe and arm/clear the
   * data_stale probe per the activated mode — a narrow seam that keeps the
   * controller off the dispatcher's single-handler-per-type path.
   */
  onActivated?: (mode: BusinessMode) => void;
  /**
   * SPEC-CRWDQ-S11 — resolve a real club crest from the AssetManifest by team.
   * Forwarded into the built-in single_game context so the score-bug renders
   * the real badge image (falling back to its colour block on a miss). Optional
   * so a deployment without crest assets keeps the colour-block behaviour.
   */
  crestResolver?: CrestResolver;
}

/** A PlannedState whose ProgramSlot has not yet arrived (AC4 buffer). */
interface BufferedActivation {
  payload: PlannedStatePayload;
  timeoutHandle: unknown;
}

export class PlannedStateActivator {
  private readonly deps: PlannedStateActivatorDeps;

  /** The `state_id` currently rendered — drives idempotency + supersede. */
  private activeStateId: string | null = null;
  private activeInstance: TemplateInstance | null = null;
  /**
   * The active state's reconcile gate (AC4): the slot/ad ids the dispatched
   * event must match, and the set of `game_id`s the active render subscribes to.
   * Null between renders. Rebuilt on every successful `render`.
   */
  private activeGate: {
    programSlotId: string | null;
    adSlotId: string | null;
    subscribedGameIds: ReadonlySet<string>;
  } | null = null;
  /**
   * Serializes reconcile dispatch (AC5): each `reconcile` chains behind the
   * prior one's settle promise so two in-place revisions never animate the
   * same host concurrently.
   */
  private reconcileChain: Promise<void> = Promise.resolve();
  /** PlannedStates buffered awaiting their ProgramSlot, keyed by slot id. */
  private readonly buffered = new Map<string, BufferedActivation>();
  /** Per-`business_mode` template adapters (single_game built in). */
  private readonly adapters = new Map<BusinessMode, TemplateAdapter>();

  constructor(deps: PlannedStateActivatorDeps) {
    this.deps = deps;
    // single_game is the built-in adapter; other modes register themselves.
    // It preserves the established overlay-ad branch via mountForState.
    this.adapters.set('single_game', {
      mount: (args) => ({
        instance: this.mountForState(args.payload, {
          programSlot: args.slot,
          theme: args.theme,
          gameStateStore: this.deps.gameStateStore,
          ...(this.deps.crestResolver ? { crestResolver: this.deps.crestResolver } : {}),
        }),
        subscribedGameIds:
          args.slot.primary_game_id === null ? new Set() : new Set([args.slot.primary_game_id]),
      }),
    });
  }

  /**
   * Register a template adapter for a `business_mode` (INV-FACTORY-19). safe_info
   * (SPEC-CRWDQ-052) and ambient (SPEC-CRWDQ-053) register here so they activate
   * through the SAME orchestration — buffer, transition, dwell, supersede,
   * reconcile dispatch — that single_game uses, never a forked activator.
   */
  registerTemplate(mode: BusinessMode, adapter: TemplateAdapter): void {
    this.adapters.set(mode, adapter);
  }

  /**
   * The `program_slot_id` of the currently-rendered state, or null between
   * renders. A narrow read the composition root's dispatcher uses to gate
   * seq-tracking to the active slot's game (D-GRH-63) without reaching into the
   * activator's internals.
   */
  activeProgramSlotId(): string | null {
    return this.activeGate?.programSlotId ?? null;
  }

  /** Register the activator as the PlannedState + ProgramSlot dispatch handlers. */
  registerWith(dispatcher: Dispatcher): void {
    dispatcher.register('PlannedState', (frame) => this.activate(frame as PlannedStateFrame), 'control');
    dispatcher.register('ProgramSlot', (frame) => this.onProgramSlot(frame as ProgramSlotFrame), 'control');
  }

  /** Handle an incoming PlannedState frame. */
  async activate(frame: PlannedStateFrame): Promise<void> {
    const payload = this.readPayload(frame);
    if (payload === null || !this.adapters.has(payload.business_mode)) {
      // A mode with no registered adapter is owned by some other handler.
      return;
    }

    // AC2 idempotency: a re-pushed identical state_id is a no-op.
    if (payload.state_id === this.activeStateId) {
      return;
    }

    // AC5: a null program_slot_id is an authoring error — never buffered.
    if (payload.program_slot_id === null) {
      await this.render(payload, { program_slot_id: '', primary_game_id: null, game_ids: [], fixture_ids: [] }, 'missing_slot');
      return;
    }

    // Slot present -> activate now; absent -> buffer up to 5 s (AC4).
    const slot = this.deps.slots.resolve(payload.program_slot_id);
    if (slot !== null) {
      await this.render(payload, slot, 'normal');
      return;
    }
    this.buffer(payload);
  }

  /**
   * Dispatch an in-place reconcile event to the active instance's `reconcile?`
   * hook (AC4/AC5). The path is gated three ways and journaled four ways:
   *
   *   - no active instance  -> `template_reconcile_dropped` (no_active_instance);
   *   - active gate MISS     -> silent no-op (the event is for some other state);
   *   - gate match, no hook  -> `template_reconcile_skipped` (hook_not_implemented);
   *   - gate match, hook     -> `template_reconcile_dispatched`, then the hook runs.
   *
   * Dispatches serialize behind {@link reconcileChain} so two revisions never
   * animate the same host at once (AC5); the returned Promise resolves when this
   * event's hook (and everything queued before it) has settled.
   */
  reconcile(event: TemplateReconcileEvent): Promise<void> {
    const run = this.reconcileChain.then(() => this.dispatchReconcile(event));
    // Keep the chain alive even if a hook rejects — a failed reconcile must not
    // wedge the queue for every subsequent revision.
    this.reconcileChain = run.catch(() => {});
    return run;
  }

  /** The gated body of one reconcile dispatch (runs serialized via the chain). */
  private async dispatchReconcile(event: TemplateReconcileEvent): Promise<void> {
    const instance = this.activeInstance;
    const gate = this.activeGate;
    if (instance === null || gate === null) {
      this.deps.journal.record({
        type: 'template_reconcile_dropped',
        reason: 'no_active_instance',
        kind: event.kind,
      });
      return;
    }

    // AC4 gate: a miss is a silent no-op (the event targets another state).
    if (!this.gateMatches(event, gate)) {
      return;
    }

    // Gate matched but the bare instance has no hook -> skip (AC4).
    if (typeof instance.reconcile !== 'function') {
      this.deps.journal.record({
        type: 'template_reconcile_skipped',
        reason: 'hook_not_implemented',
        kind: event.kind,
        state_id: this.activeStateId,
      });
      return;
    }

    this.deps.journal.record({
      type: 'template_reconcile_dispatched',
      kind: event.kind,
      state_id: this.activeStateId,
    });
    await instance.reconcile(event);
  }

  /** AC4 active-state gate: does this event target the active render? */
  private gateMatches(
    event: TemplateReconcileEvent,
    gate: NonNullable<PlannedStateActivator['activeGate']>,
  ): boolean {
    switch (event.kind) {
      case 'program_slot':
        return gate.programSlotId !== null && event.slot.program_slot_id === gate.programSlotId;
      case 'ad_slot':
        return gate.adSlotId !== null && event.adSlot.ad_slot_id === gate.adSlotId;
      case 'game_state_revision':
        return gate.subscribedGameIds.has(event.gameState.game_id);
    }
  }

  /** ProgramSlot handler: upsert, then release any PlannedState waiting on it. */
  private onProgramSlot(frame: ProgramSlotFrame): void {
    this.deps.slots.upsert(frame);
    const programSlotId = frame['program_slot_id'];
    if (typeof programSlotId !== 'string') return;
    const waiting = this.buffered.get(programSlotId);
    if (!waiting) return;
    this.deps.clock.clearTimer(waiting.timeoutHandle);
    this.buffered.delete(programSlotId);
    const slot = this.deps.slots.resolve(programSlotId);
    if (slot !== null) {
      void this.render(waiting.payload, slot, 'normal');
    }
  }

  /** Buffer a PlannedState awaiting its ProgramSlot, arming the 5 s timeout. */
  private buffer(payload: PlannedStatePayload): void {
    const programSlotId = payload.program_slot_id as string;
    // A newer buffered state for the same slot replaces the prior wait.
    const prior = this.buffered.get(programSlotId);
    if (prior) this.deps.clock.clearTimer(prior.timeoutHandle);

    const timeoutHandle = this.deps.clock.setTimer(() => {
      this.buffered.delete(programSlotId);
      this.onBufferTimeout(payload);
    }, BUFFER_TIMEOUT_MS);
    this.buffered.set(programSlotId, { payload, timeoutHandle });
  }

  /** AC4 timeout: journal the timeout + a render fallback, render the placeholder. */
  private async onBufferTimeout(payload: PlannedStatePayload): Promise<void> {
    this.deps.journal.record({
      type: 'template_buffer_timeout',
      state_id: payload.state_id,
      program_slot_id: payload.program_slot_id,
    });
    await this.render(payload, { program_slot_id: '', primary_game_id: null, game_ids: [], fixture_ids: [] }, 'buffer_timeout');
  }

  /**
   * Run the supersede + activation flow for a resolved slot. `fallback`
   * distinguishes the journal reason for the two no-live-game paths (AC4/AC5);
   * 'normal' journals nothing extra.
   */
  private async render(
    payload: PlannedStatePayload,
    slot: ProgramSlotPayload,
    fallback: 'normal' | 'missing_slot' | 'buffer_timeout',
  ): Promise<void> {
    // Supersede the prior slot (AC supersede): cancel dwell, transition out, detach.
    if (this.activeInstance !== null) {
      this.deps.dwell.cancel();
      const outgoing = this.activeInstance.detach();
      await this.deps.transitions.run({ animation_id: 'fade_scale_down', duration_ms: 0 }, outgoing);
      this.activeInstance = null;
      this.activeGate = null;
    }

    if (fallback !== 'normal') {
      this.deps.journal.record({
        type: 'template_render_fallback',
        state_id: payload.state_id,
        reason:
          fallback === 'missing_slot'
            ? 'single_game_missing_program_slot'
            : 'program_slot_buffer_timeout',
      });
    }

    const theme = resolveTheme(payload.theme_id, this.deps.barTheme);

    // Run the incoming transition (AC9), then mount via the mode's adapter (AC1).
    await this.deps.transitions.run(payload.transition, this.deps.host);
    const adapter = this.adapters.get(payload.business_mode);
    const mounted =
      adapter?.mount({
        host: this.deps.host,
        payload,
        slot,
        theme,
        gameStateStore: this.deps.gameStateStore,
      }) ?? null;
    if (mounted === null) {
      // The adapter declined (e.g. an empty manifest with no fallback): nothing
      // is rendered, no dwell is armed, and the active-state pointer stays clear.
      this.activeStateId = null;
      return;
    }
    this.activeInstance = mounted.instance;
    this.activeStateId = payload.state_id;
    // Rebuild the reconcile gate (AC4): the slot id, the ad id, and the set of
    // games the adapter subscribed to (one for single_game, none for safe/ambient).
    this.activeGate = {
      programSlotId: slot.program_slot_id.length > 0 ? slot.program_slot_id : payload.program_slot_id,
      adSlotId: payload.ad_slot_id,
      subscribedGameIds: mounted.subscribedGameIds,
    };

    // Arm the dwell (AC10); even the placeholder paths arm it (AC5).
    this.deps.dwell.arm(payload.dwell_target_ms, (actualDwellMs) =>
      this.onDwellBoundary(actualDwellMs, payload, theme),
    );

    // Notify the post-activation observer (SPEC-CRWDQ-052 data_stale/no_recent
    // probes). A throw in the observer must never wedge a successful render.
    try {
      this.deps.onActivated?.(payload.business_mode);
    } catch {
      /* observer faults are non-fatal to the render path */
    }
  }

  /**
   * Mount the instance for the state: the bare single_game template when
   * `ad_slot_id` is null (AC6), else the overlay composite (content + overlay
   * above it, AC6–AC9). The composite needs both overlay deps; absent either,
   * the activator is a bare deployment and the null branch is the only path.
   */
  private mountForState(payload: PlannedStatePayload, context: SingleGameContext): TemplateInstance {
    if (payload.ad_slot_id === null || this.deps.adSlots === undefined || this.deps.overlayAd === undefined) {
      return this.deps.template.mount(this.deps.host, context);
    }
    return mountOverlayComposite(
      {
        host: this.deps.host,
        template: this.deps.template,
        overlayAd: this.deps.overlayAd,
        adSlots: this.deps.adSlots,
        journal: this.deps.journal,
        stateId: payload.state_id,
        adSlotId: payload.ad_slot_id,
      },
      context,
    );
  }

  /**
   * Dwell boundary (AC8 + D-GRH-29): journal `dwell_boundary_reached`, then — if
   * a preference apply is pending — swap the theme stylesheet and update the
   * rendered `data-theme`, consuming the pending slot.
   */
  private onDwellBoundary(
    actualDwellMs: number,
    payload: PlannedStatePayload,
    currentTheme: ResolvedTheme,
  ): void {
    this.deps.journal.record({
      type: 'dwell_boundary_reached',
      state_id: payload.state_id,
      actualDwellMs,
    });

    const pending = this.deps.pendingApply.takePending();
    if (pending === null) return;

    // Re-resolve against the freshly-applied bar theme: a per-state theme_id
    // still wins, else the new bar-wide theme takes effect.
    const next = resolveTheme(payload.theme_id, fixedBarTheme(pending.theme));
    this.applyThemeSwap(next);
  }

  /** Apply a resolved theme to both the stylesheet seam and the rendered DOM. */
  private applyThemeSwap(theme: ResolvedTheme): void {
    this.deps.styleSheets.applyTheme(theme.state === 'set' ? theme.id : null);
    // The single_game root carries the canonical testid; other mode roots
    // (safe_info, ambient) carry `data-theme` but a different testid, so fall
    // back to the first themed element so the boundary swap is mode-agnostic.
    const root =
      this.deps.host.querySelector<HTMLElement>(`[data-testid="${TESTID.root}"]`) ??
      this.deps.host.querySelector<HTMLElement>('[data-theme]');
    if (root) root.dataset['theme'] = themeAttr(theme);
  }

  /** Read + narrow a PlannedState frame to its payload; null when unreadable. */
  private readPayload(frame: PlannedStateFrame): PlannedStatePayload | null {
    const stateId = frame['state_id'];
    const businessMode = frame['business_mode'];
    if (typeof stateId !== 'string' || typeof businessMode !== 'string') {
      return null;
    }
    const rawSlot = frame['program_slot_id'];
    const rawAdSlot = frame['ad_slot_id'];
    const transition = frame['transition'];
    return {
      state_id: stateId,
      business_mode: businessMode as PlannedStatePayload['business_mode'],
      program_slot_id: typeof rawSlot === 'string' && rawSlot.length > 0 ? rawSlot : null,
      ad_slot_id: typeof rawAdSlot === 'string' && rawAdSlot.length > 0 ? rawAdSlot : null,
      dwell_target_ms: typeof frame['dwell_target_ms'] === 'number' ? frame['dwell_target_ms'] : 0,
      transition:
        isTransitionSpec(transition) ? transition : { animation_id: 'fade_scale_up', duration_ms: 0 },
      theme_id: typeof frame['theme_id'] === 'string' && frame['theme_id'].length > 0 ? frame['theme_id'] : null,
    };
  }
}

/** A one-shot BarThemeSource over an already-applied bar theme. */
function fixedBarTheme(theme: ThemeChoiceWire): BarThemeSource {
  return { currentBarTheme: () => theme };
}

function isTransitionSpec(value: unknown): value is PlannedStatePayload['transition'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['animation_id'] === 'string' &&
    typeof (value as Record<string, unknown>)['duration_ms'] === 'number'
  );
}
