/**
 * SPEC-CRWDQ-052 — the player-side D-SAFE-01 fallback controller.
 *
 * `safe_info` is reached three ways, ALL converging on the one
 * {@link SafeInfoTemplate} through the SHARED SPEC-CRWDQ-023
 * `PlannedStateActivator` — never a forked render path:
 *
 *   Path A — the backend authors a `PlannedState{business_mode:"safe_info"}`
 *     (SPEC-CRWDQ-051). It routes through the registered safe adapter like any
 *     other mode; the backend carries no reason field, so the player uses the
 *     fixed calm `'scheduled'` reason. This controller is NOT involved in
 *     synthesizing it — it only provides the per-mount source the adapter reads
 *     (defaulting to backend_planned/scheduled when no synthetic source is set).
 *
 *   Path B — the controller watches three player-side D-SAFE-01 thresholds and,
 *     when one holds, SYNTHESIZES a `PlannedState{business_mode:"safe_info"}`
 *     and routes it via `activator.activate(...)` (the normal path):
 *       - control_channel_lost: WS down >= 30 s with no reconnect;
 *       - data_stale: no `GameEvent` for >= 120 s while in a content mode;
 *       - no_recent_state: WS open + no `PlannedState` for >= 60 s.
 *     These thresholds are player-owned (not on the wire, not backend-tunable).
 *
 *   Path C — a content template detects an unrecoverable input
 *     (`template_input_invalid` / `template_buffer_timeout`) and calls
 *     `escalateFromTemplate(reason)`; the controller routes the same synthetic
 *     state with a `template_escalation` source.
 *
 * The synthetic state carries `dwell_target_ms: 0` (infinite — the panel stays
 * until recovery; {@link DwellTimer} never arms a finite boundary). On recovery
 * a real `PlannedState` arrives and the activator supersedes the synthetic safe
 * instance via the standard flow; the safe instance's `detach()` flips
 * `inSafe` back to false.
 *
 * Time + the WS lifecycle are the only substituted boundaries (INV-FACTORY-17):
 * the {@link DwellClock} drives the threshold timers and {@link SafeWsLifecycle}
 * is the WS open/close/reconnect event source. The activator, the
 * `GameStateStore`, and the `AssetManifestStore` are real instances
 * (INV-FACTORY-16).
 */
import type { BusinessMode } from '../wire';
import type { DwellClock } from './DwellTimer';
import type { GameStateStore } from './GameStateStore';
import type { PlannedStateActivator } from './PlannedStateActivator';
import type { ProgramSlotResolver } from './ProgramSlotResolver';
import type { AssetManifestStore } from './AssetManifestStore';
import type { PlannedStateFrame, ProgramSlotFrame } from '../wire';
import type {
  SafeBarPreferences,
  SafeInfoContext,
  SafeSource,
} from '../templates/safe-info/SafeInfoTemplate';

/** Player-side D-SAFE-01 thresholds (ms). Player-owned, not on the wire. */
export const SAFE_THRESHOLDS = {
  /** WS down with no reconnect before this -> control_channel_lost. */
  controlChannelLostMs: 30_000,
  /** No GameEvent in a content mode before this -> data_stale. */
  dataStaleMs: 120_000,
  /** WS open with no PlannedState before this -> no_recent_state. */
  noRecentStateMs: 60_000,
} as const;

/** The program_slot_id of the client-synthesized safe state (Path B/C). */
const SYNTHETIC_SLOT_ID = 'safe-synthetic-slot';

/**
 * The narrow WS-lifecycle seam (INV-FACTORY-19) the controller watches. The
 * real {@link import('../transport/types').WsClient} satisfies it via its
 * `on(event, listener)` — the controller subscribes only to the three
 * connectivity events and ignores the {@link import('../transport/types').LifecycleInfo}
 * payload. A {@link FakeWsLifecycle} drives it under test.
 */
export interface SafeWsLifecycle {
  on(event: 'open' | 'close' | 'reconnect', listener: () => void): void;
}

export interface SafeStateControllerDeps {
  activator: PlannedStateActivator;
  gameStateStore: GameStateStore;
  ws: SafeWsLifecycle;
  /** Player-local clock + timer scheduling (INV-FACTORY-17). */
  clock: DwellClock;
  /** Resolver for the synthetic safe slot (registered once at construction). */
  slots: ProgramSlotResolver;
  /** Current active bar preferences (D-GRH-73), or null on a cold boot. */
  barPreferences: () => SafeBarPreferences | null;
  /** Synchronous venue-brand asset source (SPEC-CRWDQ-064). */
  assetManifestStore: AssetManifestStore;
  /**
   * Last-known theme id to stamp on the synthetic state (or null) — the
   * activator resolves it against its own bar-wide theme exactly as it does
   * for a backend state, so the synthetic safe panel renders in the live theme.
   */
  lastThemeId?: () => string | null;
}

/** Content modes whose staleness the data_stale probe watches (D-GRH-26). */
const CONTENT_MODES: ReadonlySet<BusinessMode> = new Set<BusinessMode>([
  'single_game',
  'multiple_games',
  'multiple_games_with_ads',
  'fixtures_with_live_game',
]);

export class SafeStateController {
  private readonly deps: SafeStateControllerDeps;

  /** The source the safe adapter should render on its NEXT mount (Path B/C). */
  private pendingSource: SafeSource | null = null;
  /** Diagnostic state surfaced by {@link state}. */
  private inSafe = false;
  private currentSource: SafeSource | null = null;

  private started = false;
  private synthCounter = 0;

  // Threshold timers (handles from the injected clock).
  private controlLostTimer: unknown = null;
  private noStateTimer: unknown = null;
  private dataStaleTimer: unknown = null;
  /** True while a content mode is active (drives the data_stale probe). */
  private inContentMode = false;
  private gameUnsub: (() => void) | null = null;

  constructor(deps: SafeStateControllerDeps) {
    this.deps = deps;
    // The synthetic safe state references a real (empty) slot so the activator
    // mounts it immediately rather than buffering for an absent ProgramSlot.
    this.deps.slots.upsert({
      message_type: 'ProgramSlot',
      program_slot_id: SYNTHETIC_SLOT_ID,
      primary_game_id: null,
      game_ids: [],
    } as unknown as ProgramSlotFrame);
  }

  /** Subscribe to the WS lifecycle + game staleness; arm the boot timers. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.deps.ws.on('close', () => this.onWsClose());
    this.deps.ws.on('open', () => this.onWsOpen());
    this.deps.ws.on('reconnect', () => this.onWsReconnect());

    // Any applied GameState mutation (snapshot or accepted event) is liveness:
    // it resets the data_stale probe while in a content mode.
    this.gameUnsub = this.deps.gameStateStore.subscribeAll(() => this.onGameLiveness());
  }

  /** Unsubscribe + clear every armed timer. */
  stop(): void {
    this.started = false;
    this.clear(this.controlLostTimer);
    this.clear(this.noStateTimer);
    this.clear(this.dataStaleTimer);
    this.controlLostTimer = null;
    this.noStateTimer = null;
    this.dataStaleTimer = null;
    this.gameUnsub?.();
    this.gameUnsub = null;
  }

  /**
   * Host-wiring hook: a `PlannedState` of `mode` just activated. Cancels the
   * no_recent_state timer (a state arrived) and (re)arms or clears the
   * data_stale probe depending on whether `mode` is a content mode.
   */
  notePlannedState(mode: BusinessMode): void {
    this.clear(this.noStateTimer);
    this.noStateTimer = null;

    this.inContentMode = CONTENT_MODES.has(mode);
    if (this.inContentMode) {
      this.armDataStale();
    } else {
      this.clear(this.dataStaleTimer);
      this.dataStaleTimer = null;
    }
  }

  /**
   * Path C — a content template escalates an unrecoverable input. Routes the
   * synthetic safe state with a `template_escalation` source.
   */
  escalateFromTemplate(reason: 'template_input_invalid' | 'template_buffer_timeout'): void {
    void this.trigger({ kind: 'template_escalation', reason });
  }

  /** Build the {@link SafeInfoContext} the adapter mounts with on this render. */
  buildContext(theme: SafeInfoContext['theme'], programSlot: SafeInfoContext['programSlot']): SafeInfoContext {
    // A pending synthetic source (Path B/C) wins for this mount; absent it,
    // the render is a backend-planned state -> the fixed calm 'scheduled'.
    const source: SafeSource = this.pendingSource ?? { kind: 'backend_planned', reason: 'scheduled' };
    this.pendingSource = null;
    return {
      programSlot,
      theme,
      barPreferences: this.deps.barPreferences(),
      assetManifestStore: this.deps.assetManifestStore,
      source,
    };
  }

  /** Adapter callback: the safe panel mounted with `source`. */
  noteMounted(source: SafeSource): void {
    this.inSafe = true;
    this.currentSource = source;
  }

  /** Adapter callback: the safe panel detached (superseded on recovery). */
  noteDetached(): void {
    this.inSafe = false;
    this.currentSource = null;
  }

  /** Current diagnostic state. */
  state(): { inSafe: boolean; source: SafeSource | null } {
    return { inSafe: this.inSafe, source: this.currentSource };
  }

  // --- WS lifecycle ----------------------------------------------------------

  private onWsClose(): void {
    // Arm the control_channel_lost threshold; a reconnect/open before it fires
    // cancels it. The no_recent_state timer is a WS-open concern — clear it.
    this.clear(this.noStateTimer);
    this.noStateTimer = null;
    if (this.controlLostTimer !== null) return;
    this.controlLostTimer = this.deps.clock.setTimer(() => {
      this.controlLostTimer = null;
      void this.trigger({ kind: 'player_fallback', reason: 'control_channel_lost' });
    }, SAFE_THRESHOLDS.controlChannelLostMs);
  }

  private onWsOpen(): void {
    this.cancelControlLost();
    // WS open with no PlannedState arriving within the window -> no_recent_state.
    this.clear(this.noStateTimer);
    this.noStateTimer = this.deps.clock.setTimer(() => {
      this.noStateTimer = null;
      void this.trigger({ kind: 'player_fallback', reason: 'no_recent_state' });
    }, SAFE_THRESHOLDS.noRecentStateMs);
  }

  private onWsReconnect(): void {
    this.cancelControlLost();
  }

  private cancelControlLost(): void {
    this.clear(this.controlLostTimer);
    this.controlLostTimer = null;
  }

  // --- data_stale probe ------------------------------------------------------

  private onGameLiveness(): void {
    if (this.inContentMode) this.armDataStale();
  }

  private armDataStale(): void {
    this.clear(this.dataStaleTimer);
    this.dataStaleTimer = this.deps.clock.setTimer(() => {
      this.dataStaleTimer = null;
      void this.trigger({ kind: 'player_fallback', reason: 'data_stale' });
    }, SAFE_THRESHOLDS.dataStaleMs);
  }

  // --- synthetic activation --------------------------------------------------

  /**
   * Route a synthetic safe_info PlannedState via the normal activator with the
   * given source. Idempotent against re-entry while already in that exact safe
   * state (a second close-timeout while already control_channel_lost is a no-op).
   */
  private async trigger(source: SafeSource): Promise<void> {
    if (this.inSafe && sameSource(this.currentSource, source)) return;
    this.pendingSource = source;
    this.synthCounter += 1;
    await this.deps.activator.activate(this.syntheticFrame());
  }

  /**
   * A client-built `PlannedState` filling the SPEC-CRWDQ-017 required fields
   * with sentinels: a generated state_id, the synthetic (empty) slot,
   * `transition: cut` (no animation — the D-SAFE-01 calm intent), and
   * `dwell_target_ms: 0` (infinite — the panel stays until recovery).
   */
  private syntheticFrame(): PlannedStateFrame {
    const themeId = this.deps.lastThemeId?.() ?? null;
    return {
      message_type: 'PlannedState',
      state_id: `safe-synth-${this.synthCounter}`,
      business_mode: 'safe_info',
      program_slot_id: SYNTHETIC_SLOT_ID,
      ad_slot_id: null,
      dwell_target_ms: 0,
      transition: { animation_id: 'cut', duration_ms: 0 },
      theme_id: themeId,
    } as unknown as PlannedStateFrame;
  }

  private clear(handle: unknown): void {
    if (handle !== null) this.deps.clock.clearTimer(handle);
  }
}

/** Two sources are the same iff both kind and reason match. */
function sameSource(a: SafeSource | null, b: SafeSource): boolean {
  return a !== null && a.kind === b.kind && a.reason === b.reason;
}
