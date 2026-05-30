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
import type { PlannedStateFrame, ProgramSlotFrame, ThemeChoiceWire, BarPreferencesWire } from '../wire';
import type { Dispatcher } from '../transport/types';
import type { GameStateStore } from './GameStateStore';
import type { ProgramSlotResolver } from './ProgramSlotResolver';
import type { TransitionExecutor } from './TransitionExecutor';
import type { DwellTimer, DwellClock } from './DwellTimer';
import type { RenderJournal } from './RenderJournal';
import type { StyleSheetRegistry } from './StyleSheetRegistry';
import { resolveTheme, themeAttr, type BarThemeSource, type ResolvedTheme } from './ThemeResolver';
import type { PlannedStatePayload, ProgramSlotPayload } from './types';
import {
  SingleGameTemplate,
  TESTID,
  type SingleGameInstance,
} from '../templates/single-game/SingleGameTemplate';

/** Drains the pending preference apply at a dwell boundary (SPEC-014 slot). */
export interface PendingThemeApply {
  takePending(): BarPreferencesWire | null;
}

/** Default ProgramSlot buffer window before falling through (AC4). */
export const BUFFER_TIMEOUT_MS = 5000;

export interface PlannedStateActivatorDeps {
  host: HTMLElement;
  slots: ProgramSlotResolver;
  gameStateStore: GameStateStore;
  transitions: TransitionExecutor;
  dwell: DwellTimer;
  template: SingleGameTemplate;
  journal: RenderJournal;
  styleSheets: StyleSheetRegistry;
  barTheme: BarThemeSource;
  pendingApply: PendingThemeApply;
  clock: DwellClock;
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
  private activeInstance: SingleGameInstance | null = null;
  /** PlannedStates buffered awaiting their ProgramSlot, keyed by slot id. */
  private readonly buffered = new Map<string, BufferedActivation>();

  constructor(deps: PlannedStateActivatorDeps) {
    this.deps = deps;
  }

  /** Register the activator as the PlannedState + ProgramSlot dispatch handlers. */
  registerWith(dispatcher: Dispatcher): void {
    dispatcher.register('PlannedState', (frame) => this.activate(frame as PlannedStateFrame), 'control');
    dispatcher.register('ProgramSlot', (frame) => this.onProgramSlot(frame as ProgramSlotFrame), 'control');
  }

  /** Handle an incoming PlannedState frame. */
  async activate(frame: PlannedStateFrame): Promise<void> {
    const payload = this.readPayload(frame);
    if (payload === null || payload.business_mode !== 'single_game') {
      // Only single_game is owned here; other modes are other templates.
      return;
    }

    // AC2 idempotency: a re-pushed identical state_id is a no-op.
    if (payload.state_id === this.activeStateId) {
      return;
    }

    // AC5: a null program_slot_id is an authoring error — never buffered.
    if (payload.program_slot_id === null) {
      await this.render(payload, { program_slot_id: '', primary_game_id: null }, 'missing_slot');
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
    await this.render(payload, { program_slot_id: '', primary_game_id: null }, 'buffer_timeout');
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

    // Run the incoming transition (AC9), then mount (AC1).
    await this.deps.transitions.run(payload.transition, this.deps.host);
    this.activeInstance = this.deps.template.mount(this.deps.host, {
      programSlot: slot,
      theme,
      gameStateStore: this.deps.gameStateStore,
    });
    this.activeStateId = payload.state_id;

    // Arm the dwell (AC10); even the placeholder paths arm it (AC5).
    this.deps.dwell.arm(payload.dwell_target_ms, (actualDwellMs) =>
      this.onDwellBoundary(actualDwellMs, payload, theme),
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
    const root = this.deps.host.querySelector<HTMLElement>(`[data-testid="${TESTID.root}"]`);
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
