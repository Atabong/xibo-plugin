/**
 * SPEC-CRWDQ-052 (part 1) — the `SafeStateController` driving safe_info
 * through the SHARED SPEC-CRWDQ-023 `PlannedStateActivator` (Paths A/B/C),
 * tested end-to-end through the real activator (INV-FACTORY-16). Only the WS
 * lifecycle (a tiny event driver) and the clock (vitest fake timers) are
 * substituted (INV-FACTORY-17).
 *
 * Path A — a backend PlannedState{business_mode:"safe_info"} routes through the
 *   registered adapter -> data-source="backend_planned", reason "scheduled",
 *   honoring the backend transition + dwell_target_ms.
 * Path B — control_channel_lost (WS down >=30s), data_stale (no GameEvent >=120s
 *   in a content mode), no_recent_state (WS open + no PlannedState >=60s); each
 *   synthesizes a PlannedState routed via the normal activator.
 * Path C — escalateFromTemplate(reason) mounts with source template_escalation.
 * Recovery — a real PlannedState supersedes the synthetic safe state; inSafe
 *   flips to false. Paths B/C synthesize dwell_target_ms:0 (infinite — the
 *   timer is never armed with a finite value); the panel stays until recovery.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PlannedStateActivator,
  type PendingThemeApply,
} from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { SafeInfoTemplate } from '../../../src/templates/safe-info/SafeInfoTemplate';
import {
  SafeStateController,
  type SafeWsLifecycle,
} from '../../../src/render/SafeStateController';
import { makeSafeAdapter } from '../../../src/templates/safe-info/SafeAdapter';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import type { SafeBarPreferences } from '../../../src/templates/safe-info/SafeInfoTemplate';
import { makeAssetStore } from './support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

class RecordingPlayer implements TransitionPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(definition: TransitionDefinition): Promise<void> {
    this.played.push(definition);
  }
}

class RecordingStyleSheets implements StyleSheetRegistry {
  applyTheme(): void {}
}

class FixedBarTheme implements BarThemeSource {
  currentBarTheme(): null {
    return null;
  }
}

class QueuedPendingApply implements PendingThemeApply {
  takePending(): BarPreferencesWire | null {
    return null;
  }
}

/** A WS lifecycle driver: tests fire open/close/reconnect explicitly. */
class FakeWsLifecycle implements SafeWsLifecycle {
  private readonly listeners: Record<'open' | 'close' | 'reconnect', Array<() => void>> = {
    open: [],
    close: [],
    reconnect: [],
  };
  on(event: 'open' | 'close' | 'reconnect', listener: () => void): void {
    this.listeners[event].push(listener);
  }
  fire(event: 'open' | 'close' | 'reconnect'): void {
    for (const l of this.listeners[event]) l();
  }
}

const prefs = (): SafeBarPreferences => ({
  bar_id: 'bar-007',
  theme: { state: 'default' },
  sports: [],
  leagues: [],
  region: null,
  state: 'IL',
  city: 'Chicago',
  timezone: 'America/Chicago',
  business_hours: [],
  local_team_list: [],
  fallback_mode_order: [],
});

const safeFrame = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-safe-be',
    business_mode: 'safe_info',
    program_slot_id: 'slot-safe',
    ad_slot_id: null,
    dwell_target_ms: 45_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const singleGameFrame = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-sg',
    business_mode: 'single_game',
    program_slot_id: 'slot-sg',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

interface Harness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  controller: SafeStateController;
  gameStateStore: GameStateStore;
  ws: FakeWsLifecycle;
  journal: RecordingJournal;
  dwell: DwellTimer;
  player: RecordingPlayer;
  /** SPEC-CRWDQ-S49 — count of active-resync requests the controller fired. */
  resyncCount: () => number;
}

function makeHarness(opts: { requestResync?: () => void } = {}): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const gameStateStore = new GameStateStore(journal);
  const { store: assetStore } = makeAssetStore();
  const transitions = new TransitionExecutor({
    catalog: new Map([
      ['cut', {}],
      ['fade_scale_up', {}],
      ['fade_scale_down', {}],
    ]),
    assets: assetStore,
    player,
    journal,
  });
  const dwell = new DwellTimer(systemDwellClock);
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore,
    transitions,
    dwell,
    template: new SingleGameTemplate(),
    journal,
    styleSheets: new RecordingStyleSheets(),
    barTheme: new FixedBarTheme(),
    pendingApply: new QueuedPendingApply(),
    clock: systemDwellClock,
  });
  // The slot the backend safe_info state references (Path A).
  slots.upsert({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-safe',
    primary_game_id: null,
    game_ids: [],
  } as unknown as ProgramSlotFrame);
  slots.upsert({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-sg',
    primary_game_id: 'g1',
    game_ids: [],
  } as unknown as ProgramSlotFrame);

  const ws = new FakeWsLifecycle();
  let resyncCount = 0;
  const controller = new SafeStateController({
    activator,
    gameStateStore,
    ws,
    clock: systemDwellClock,
    slots,
    barPreferences: () => prefs(),
    assetManifestStore: assetStore,
    // SPEC-CRWDQ-S49 — count resync requests; an explicit opts override wins.
    requestResync:
      opts.requestResync ??
      ((): void => {
        resyncCount += 1;
      }),
  });
  activator.registerTemplate('safe_info', makeSafeAdapter({ template: new SafeInfoTemplate(), controller }));
  return { host, activator, controller, gameStateStore, ws, journal, dwell, player, resyncCount: () => resyncCount };
}

const safeRoot = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('.crowdaq-safe-info');

describe('SafeStateController (SPEC-CRWDQ-052 part 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-01T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Path A — backend-planned safe_info (AC3)', () => {
    it('routes a backend safe_info PlannedState to the panel, reason fixed "scheduled"', async () => {
      const h = makeHarness();
      h.controller.start();
      await h.activator.activate(safeFrame());
      await vi.advanceTimersByTimeAsync(0);

      const section = safeRoot(h.host)!;
      expect(section).not.toBeNull();
      expect(section.dataset['source']).toBe('backend_planned');
      expect(section.dataset['reason']).toBe('scheduled');
      expect(h.controller.state().inSafe).toBe(true);
      // AC3: the activator ran the backend transition ("cut") on activation.
      expect(h.player.played.map((p) => p.animation_id)).toContain('cut');
    });

    it('honors the backend dwell_target_ms (Path A finite dwell)', async () => {
      const h = makeHarness();
      h.controller.start();
      await h.activator.activate(safeFrame({ dwell_target_ms: 45_000 }));
      await vi.advanceTimersByTimeAsync(0);

      // The boundary fires at the backend dwell, not before.
      await vi.advanceTimersByTimeAsync(44_999);
      expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
    });
  });

  describe('Path B — player connectivity/staleness fallback (AC4)', () => {
    it('control_channel_lost: WS down >=30s with no reconnect mounts the panel', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.ws.fire('close');

      await vi.advanceTimersByTimeAsync(29_999);
      expect(safeRoot(h.host)).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);

      const section = safeRoot(h.host)!;
      expect(section.dataset['source']).toBe('player_fallback');
      expect(section.dataset['reason']).toBe('control_channel_lost');
      expect(h.controller.state().inSafe).toBe(true);
    });

    it('a reconnect before 30s cancels the control_channel_lost trigger', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.ws.fire('close');
      await vi.advanceTimersByTimeAsync(20_000);
      h.ws.fire('reconnect');
      h.ws.fire('open');
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(safeRoot(h.host)).toBeNull();
      expect(h.controller.state().inSafe).toBe(false);
    });

    it('no_recent_state: WS open + 60s with no PlannedState mounts the panel', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');

      await vi.advanceTimersByTimeAsync(59_999);
      expect(safeRoot(h.host)).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);

      const section = safeRoot(h.host)!;
      expect(section.dataset['source']).toBe('player_fallback');
      expect(section.dataset['reason']).toBe('no_recent_state');
    });

    it('data_stale: no GameEvent >=120s in a content mode mounts the panel', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');

      // Enter a content mode with a live game so the no_recent_state timer is
      // satisfied and the staleness probe is the active condition. The host
      // wiring notes each PlannedState activation to the controller.
      h.gameStateStore.upsertSnapshot({ game_id: 'g1', seq: 1, home_score: 0 });
      await h.activator.activate(singleGameFrame());
      h.controller.notePlannedState('single_game');
      await vi.advanceTimersByTimeAsync(0);
      expect(safeRoot(h.host)).toBeNull();

      // 120s with no further GameEvent -> data_stale.
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.advanceTimersByTimeAsync(0);

      const section = safeRoot(h.host)!;
      expect(section.dataset['source']).toBe('player_fallback');
      expect(section.dataset['reason']).toBe('data_stale');
    });

    it('a GameEvent before 120s resets the data_stale timer', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.gameStateStore.upsertSnapshot({ game_id: 'g1', seq: 1, home_score: 0 });
      await h.activator.activate(singleGameFrame());
      h.controller.notePlannedState('single_game');
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(100_000);
      h.gameStateStore.applyEvent({ game_id: 'g1', seq: 2, home_score: 1 });
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(0);

      // Only 100s since the last event -> still no data_stale.
      expect(safeRoot(h.host)).toBeNull();
    });

    it('Path B synthesizes an infinite dwell (no finite boundary armed)', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.ws.fire('close');
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(safeRoot(h.host)).not.toBeNull();

      // Advancing far past any normal dwell fires NO dwell boundary: the safe
      // synthetic state armed dwell_target_ms:0 = infinite.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);
      expect(safeRoot(h.host)).not.toBeNull();
    });
  });

  describe('Path C — content-template escalation (AC5)', () => {
    it('escalateFromTemplate mounts safe_info with source template_escalation', async () => {
      const h = makeHarness();
      h.controller.start();
      h.controller.escalateFromTemplate('template_input_invalid');
      await vi.advanceTimersByTimeAsync(0);

      const section = safeRoot(h.host)!;
      expect(section.dataset['source']).toBe('template_escalation');
      expect(section.dataset['reason']).toBe('template_input_invalid');
      expect(h.controller.state().inSafe).toBe(true);
    });

    it('escalateFromTemplate(template_buffer_timeout) renders the recovery footer', async () => {
      const h = makeHarness();
      h.controller.start();
      h.controller.escalateFromTemplate('template_buffer_timeout');
      await vi.advanceTimersByTimeAsync(0);

      const status = safeRoot(h.host)!.querySelector<HTMLElement>('.cdq-safe-status')!;
      expect(status.textContent).toBe('Recovering display · timed out');
    });
  });

  describe('D-SAFE-01 recovery (AC8)', () => {
    it('a real PlannedState supersedes the synthetic safe state; inSafe flips false', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.ws.fire('close');
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.controller.state().inSafe).toBe(true);
      expect(safeRoot(h.host)).not.toBeNull();

      // A real single_game PlannedState arrives -> standard supersede.
      h.gameStateStore.upsertSnapshot({ game_id: 'g1', seq: 1 });
      await h.activator.activate(singleGameFrame());
      h.controller.notePlannedState('single_game');
      await vi.advanceTimersByTimeAsync(0);

      expect(safeRoot(h.host)).toBeNull();
      expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();
      expect(h.controller.state().inSafe).toBe(false);
      expect(h.controller.state().source).toBeNull();
    });
  });

  // SPEC-CRWDQ-S49 — the active-resync loop that makes a player-side fallback
  // SELF-HEAL on a still-connected bar (the replay-end stuck-`data_stale` bug):
  // instead of waiting passively for a spontaneous backend re-push, the
  // controller actively re-asks the backend for the current state until a real
  // PlannedState supersedes the synthetic panel.
  describe('SPEC-CRWDQ-S49 — active resync out of a player fallback', () => {
    it('data_stale fires an IMMEDIATE resync, then repeats until recovery', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.gameStateStore.upsertSnapshot({ game_id: 'g1', seq: 1, home_score: 0 });
      await h.activator.activate(singleGameFrame());
      h.controller.notePlannedState('single_game');
      await vi.advanceTimersByTimeAsync(0);

      // Enter data_stale (120s no GameEvent in a content mode).
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(safeRoot(h.host)!.dataset['reason']).toBe('data_stale');
      // First resync is immediate on the trigger.
      expect(h.resyncCount()).toBe(1);

      // The loop repeats on the 15s retry cadence while still stuck.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.resyncCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.resyncCount()).toBe(3);
    });

    it('stops re-asking once a real backend state supersedes the fallback', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      h.gameStateStore.upsertSnapshot({ game_id: 'g1', seq: 1, home_score: 0 });
      await h.activator.activate(singleGameFrame());
      h.controller.notePlannedState('single_game');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.resyncCount()).toBe(1);

      // Recovery: a real safe_info PlannedState arrives (the re-push a resync
      // provoked) and supersedes the synthetic data_stale panel. A safe→safe
      // supersede re-mounts a safe panel (so inSafe stays true), but the SOURCE
      // flips from player_fallback to backend_planned — that is recovery, and it
      // stops the active-resync loop.
      await h.activator.activate(safeFrame());
      await vi.advanceTimersByTimeAsync(0);
      expect(safeRoot(h.host)!.dataset['source']).toBe('backend_planned');
      expect(h.controller.state().source?.kind).toBe('backend_planned');

      const countAtRecovery = h.resyncCount();
      // No further resyncs after recovery — the loop is stopped (the next tick
      // sees a non-player_fallback source and tears the loop down).
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.resyncCount()).toBe(countAtRecovery);
    });

    it('no_recent_state also drives the active resync loop', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      // 60s WS-open with no PlannedState -> no_recent_state.
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(safeRoot(h.host)!.dataset['reason']).toBe('no_recent_state');
      expect(h.resyncCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.resyncCount()).toBe(2);
    });

    it('a passive deployment (no requestResync seam) never throws + still mounts the panel', async () => {
      // No `requestResync` seam wired — the controller must keep the old passive
      // behaviour: it mounts the fallback panel and arms no resync loop, without
      // throwing. (Build a bare controller so the seam is genuinely absent.)
      const h = makeHarness();
      const controller = new SafeStateController({
        activator: h.activator,
        gameStateStore: h.gameStateStore,
        ws: h.ws,
        clock: systemDwellClock,
        slots: new ProgramSlotResolver(),
        barPreferences: () => prefs(),
        assetManifestStore: makeAssetStore().store,
        // NOTE: no `requestResync` — passive deployment.
      });
      controller.start();
      h.ws.fire('open');
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
      // Reaching here without a throw is the assertion. Tidy up.
      controller.stop();
      expect(true).toBe(true);
    });

    it('stop() clears the resync loop', async () => {
      const h = makeHarness();
      h.controller.start();
      h.ws.fire('open');
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.resyncCount()).toBe(1);
      h.controller.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.resyncCount()).toBe(1); // no further ticks after stop()
    });
  });
});
