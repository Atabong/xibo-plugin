/**
 * SPEC-CRWDQ-052 (part 2) — Path-A theme-apply-at-dwell-boundary for safe_info,
 * the case part 1 deferred (its controller harness queued a null pending apply
 * and a null bar theme, so no boundary swap ever occurred).
 *
 * AC: "theme apply at boundary (Path A only)". The safe_info root carries the
 * mode-agnostic `data-theme` the shared activator re-stamps on the dwell
 * boundary when a preference apply is pending (SPEC-CRWDQ-023 AC8 / D-GRH-29).
 * This proves the SAME boundary contract holds for the safe panel: at the
 * Path-A dwell boundary the safe root's `data-theme` swaps to the freshly
 * applied bar theme, honoring the three-state resolution AND the per-state
 * `theme_id` precedence. Path B/C never arm a finite dwell (dwell_target_ms:0),
 * so there is no boundary to swap at — proven in the part-1 suite.
 *
 * Real shared activator + GameStateStore + AssetManifestStore + adapter
 * (INV-FACTORY-16); only the WS lifecycle and the clock (vitest fake timers)
 * are substituted (INV-FACTORY-17). The PendingThemeApply + BarThemeSource are
 * the SPEC-CRWDQ-023 preference seams, configured per test (not mode-internal).
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
import {
  THEME_ATTR_DEFAULT,
  THEME_ATTR_UNSET,
  type BarThemeSource,
} from '../../../src/render/ThemeResolver';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type {
  BarPreferencesWire,
  PlannedStateFrame,
  ProgramSlotFrame,
  ThemeChoiceWire,
} from '../../../src/wire';
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

/** Records each applyTheme call so the stylesheet swap is observable too. */
class RecordingStyleSheets implements StyleSheetRegistry {
  readonly applied: Array<string | null> = [];
  applyTheme(themeId: string | null): void {
    this.applied.push(themeId);
  }
}

/** A bar theme source returning a fixed choice (the pre-apply bar theme). */
class FixedBarTheme implements BarThemeSource {
  constructor(private readonly choice: ThemeChoiceWire | null) {}
  currentBarTheme(): ThemeChoiceWire | null {
    return this.choice;
  }
}

/** Drains a single queued preference apply once, then null (SPEC-014 slot). */
class OneShotPendingApply implements PendingThemeApply {
  private pending: BarPreferencesWire | null;
  constructor(pending: BarPreferencesWire | null) {
    this.pending = pending;
  }
  takePending(): BarPreferencesWire | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }
}

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

/** A full BarPreferencesWire carrying the post-apply bar theme choice. */
const barPrefsWithTheme = (theme: ThemeChoiceWire): BarPreferencesWire => ({
  theme,
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

interface Harness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  controller: SafeStateController;
  journal: RecordingJournal;
  styleSheets: RecordingStyleSheets;
}

function makeHarness(opts: {
  pendingApply: PendingThemeApply;
  barTheme: BarThemeSource;
}): Harness {
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
  const styleSheets = new RecordingStyleSheets();
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore,
    transitions,
    dwell,
    template: new SingleGameTemplate(),
    journal,
    styleSheets,
    barTheme: opts.barTheme,
    pendingApply: opts.pendingApply,
    clock: systemDwellClock,
  });
  slots.upsert({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-safe',
    primary_game_id: null,
    game_ids: [],
  } as unknown as ProgramSlotFrame);

  const ws = new FakeWsLifecycle();
  const controller = new SafeStateController({
    activator,
    gameStateStore,
    ws,
    clock: systemDwellClock,
    slots,
    barPreferences: () => prefs(),
    assetManifestStore: assetStore,
  });
  activator.registerTemplate('safe_info', makeSafeAdapter({ template: new SafeInfoTemplate(), controller }));
  return { host, activator, controller, journal, styleSheets };
}

const safeRoot = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.crowdaq-safe-info')!;

describe('SafeStateController Path-A theme-at-dwell-boundary (SPEC-CRWDQ-052 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-01T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('swaps the safe root data-theme to a freshly-applied set bar theme at the boundary', async () => {
    const h = makeHarness({
      pendingApply: new OneShotPendingApply(barPrefsWithTheme({ state: 'set', id: 'midnight' })),
      barTheme: new FixedBarTheme(null),
    });
    h.controller.start();
    // theme_id null -> resolves against the (pre-apply null) bar theme -> default.
    await h.activator.activate(safeFrame({ theme_id: null, dwell_target_ms: 45_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(safeRoot(h.host).dataset['theme']).toBe(THEME_ATTR_DEFAULT);

    // At the dwell boundary the pending apply drains: the safe root re-stamps
    // to the newly applied bar theme, and the stylesheet seam is told too.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(safeRoot(h.host).dataset['theme']).toBe('midnight');
    expect(h.styleSheets.applied).toContain('midnight');
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });

  it('re-stamps to the unset sentinel when the applied bar theme is unset', async () => {
    const h = makeHarness({
      pendingApply: new OneShotPendingApply(barPrefsWithTheme({ state: 'unset' })),
      barTheme: new FixedBarTheme(null),
    });
    h.controller.start();
    await h.activator.activate(safeFrame({ theme_id: null, dwell_target_ms: 30_000 }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30_000);
    // unset must NOT collapse to default — the distinction survives the swap.
    expect(safeRoot(h.host).dataset['theme']).toBe(THEME_ATTR_UNSET);
    expect(safeRoot(h.host).dataset['theme']).not.toBe(THEME_ATTR_DEFAULT);
    expect(h.styleSheets.applied).toContain(null);
  });

  it('a per-state theme_id still wins over the applied bar theme at the boundary', async () => {
    const h = makeHarness({
      pendingApply: new OneShotPendingApply(barPrefsWithTheme({ state: 'set', id: 'bar-wide' })),
      barTheme: new FixedBarTheme(null),
    });
    h.controller.start();
    // The backend state pins its own theme_id -> resolution short-circuits to it.
    await h.activator.activate(safeFrame({ theme_id: 'state-pinned', dwell_target_ms: 20_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(safeRoot(h.host).dataset['theme']).toBe('state-pinned');

    await vi.advanceTimersByTimeAsync(20_000);
    // The per-state id wins both before and after the boundary apply.
    expect(safeRoot(h.host).dataset['theme']).toBe('state-pinned');
    expect(h.styleSheets.applied).toContain('state-pinned');
  });

  it('leaves the safe root data-theme unchanged at the boundary when no apply is pending', async () => {
    const h = makeHarness({
      pendingApply: new OneShotPendingApply(null),
      barTheme: new FixedBarTheme({ state: 'set', id: 'baseline' }),
    });
    h.controller.start();
    await h.activator.activate(safeFrame({ theme_id: null, dwell_target_ms: 15_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(safeRoot(h.host).dataset['theme']).toBe('baseline');

    await vi.advanceTimersByTimeAsync(15_000);
    // No pending apply -> the boundary journals but performs no swap.
    expect(safeRoot(h.host).dataset['theme']).toBe('baseline');
    expect(h.styleSheets.applied).toHaveLength(0);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });
});

describe('SafeStateController Path-C no-finite-dwell (SPEC-CRWDQ-052 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-01T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an escalation-mounted safe panel arms no finite dwell boundary (stays until recovery)', async () => {
    // The part-1 suite proves Path B synthesizes dwell_target_ms:0; Path C
    // routes the SAME synthetic frame, so it must share the infinite dwell —
    // the consolidated matrix proves the escalation path too, never a fork.
    const h = makeHarness({
      pendingApply: new OneShotPendingApply(null),
      barTheme: new FixedBarTheme(null),
    });
    h.controller.start();
    h.controller.escalateFromTemplate('template_buffer_timeout');
    await vi.advanceTimersByTimeAsync(0);
    expect(safeRoot(h.host)).not.toBeNull();
    expect(h.controller.state().inSafe).toBe(true);

    // Far past any normal dwell: no boundary fires, the panel stays mounted.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);
    expect(safeRoot(h.host)).not.toBeNull();
  });
});
