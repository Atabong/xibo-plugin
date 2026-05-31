/**
 * SPEC-CRWDQ-023 #37 — shared end-to-end harness for the single_game template.
 *
 * Wires the REAL render orchestration together exactly as the player runtime
 * does: a real `FrameDispatcher` with the `PlannedStateActivator` registered as
 * the `PlannedState` + `ProgramSlot` handlers, a real `ProgramSlotResolver`,
 * real `GameStateStore`, real `DwellTimer` (over the system clock, driven by
 * vitest fake timers), real `TransitionExecutor` (over a real
 * `AssetManifestStore`), and the real bare `SingleGameTemplate`.
 *
 * The ONLY substituted surfaces are the system boundaries permitted by
 * INV-FACTORY-17: the WS source (frames pushed straight into the dispatcher),
 * the clock (vitest fake timers), the transition timing (`RecordingPlayer`
 * resolves instantly and records what it played), the `ConfigPushHandler`
 * pending-apply surface (`FakePendingApply`, a real single-slot drain), and the
 * CSS injection seam (`RecordingStyleSheets`). Every render decision —
 * activation, buffering, supersede, dwell, theme resolution, seq ordering,
 * reconcile — is made by the real modules under test.
 */
import { vi } from 'vitest';
import { PlannedStateActivator } from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type { ThemeChoiceWire, BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  MapAssetCache,
  FakeAssetFetcher,
  RecordingJournal as ManifestRecordingJournal,
} from '../../render/asset-manifest/support';

/** In-memory journal sink (system boundary, INV-17) — a real recorder. */
export class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

/** Transition-timing boundary (INV-17): resolves instantly, records each play. */
export class RecordingPlayer implements TransitionPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(definition: TransitionDefinition): Promise<void> {
    this.played.push(definition);
  }
}

/** CSS-injection boundary (INV-17): records the applied theme id, no <link>. */
export class RecordingStyleSheets implements StyleSheetRegistry {
  readonly applied: Array<string | null> = [];
  applyTheme(themeId: string | null): void {
    this.applied.push(themeId);
  }
}

/** A real bar-theme source over a fixed applied bar theme (or none). */
export class FixedBarTheme implements BarThemeSource {
  constructor(public theme: ThemeChoiceWire | null = null) {}
  currentBarTheme(): ThemeChoiceWire | null {
    return this.theme;
  }
}

/**
 * The ConfigPushHandler pending-apply surface (INV-17 substitution): a real
 * single-slot that drains exactly once, mirroring SPEC-CRWDQ-014's
 * take-pending contract.
 */
export class FakePendingApply implements PendingThemeApply {
  private slot: BarPreferencesWire | null = null;
  queue(prefs: BarPreferencesWire): void {
    this.slot = prefs;
  }
  takePending(): BarPreferencesWire | null {
    const p = this.slot;
    this.slot = null;
    return p;
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

/** Build a PlannedState frame with single_game defaults; override any field. */
export const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'single_game',
    program_slot_id: 'slot-1',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

/** Build a ProgramSlot frame. */
export const programSlot = (id: string, primaryGameId: string | null): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
  }) as unknown as ProgramSlotFrame;

/** Build a BarPreferences payload carrying just a theme (the rest is inert). */
export const prefsWithTheme = (theme: ThemeChoiceWire): BarPreferencesWire => ({
  theme,
  sports: [],
  leagues: [],
  region: null,
  state: null,
  city: null,
  timezone: 'UTC',
  business_hours: [],
  local_team_list: [],
  fallback_mode_order: [],
});

export interface E2EHarness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  activator: PlannedStateActivator;
  slots: ProgramSlotResolver;
  store: GameStateStore;
  journal: RecordingJournal;
  styleSheets: RecordingStyleSheets;
  barTheme: FixedBarTheme;
  pendingApply: FakePendingApply;
  player: RecordingPlayer;
}

/**
 * Construct the full real-module pipeline. `barTheme` lets a test seed the
 * bar-wide applied theme (for the theme-fallthrough cases).
 */
export function makeE2E(barTheme: FixedBarTheme = new FixedBarTheme()): E2EHarness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  const player = new RecordingPlayer();
  const transitions = new TransitionExecutor({
    catalog: new Map([
      ['fade_scale_up', {}],
      ['fade_scale_down', {}],
    ]),
    assets: new AssetManifestStore({
      cache: new MapAssetCache(),
      fetcher: new FakeAssetFetcher(),
      journal: new ManifestRecordingJournal(),
    }),
    player,
    journal,
  });
  const styleSheets = new RecordingStyleSheets();
  const pendingApply = new FakePendingApply();

  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template: new SingleGameTemplate(),
    journal,
    styleSheets,
    barTheme,
    pendingApply,
    clock: systemDwellClock,
  });

  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, dispatcher, activator, slots, store, journal, styleSheets, barTheme, pendingApply, player };
}

/** Number of mounted single_game sections in the host. */
export const rootCount = (host: HTMLElement): number =>
  host.querySelectorAll('section.crowdaq-single-game').length;

/** Read the text of a sub-region by its data-testid. */
export const text = (host: HTMLElement, id: string): string =>
  host.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

/** Read the rendered root data-theme attribute. */
export const dataTheme = (host: HTMLElement): string | undefined =>
  (host.querySelector(`[data-testid="${TESTID.root}"]`) as HTMLElement | null)?.dataset['theme'];

/** Flush the microtask/timer hop the activator's async chain needs. */
export const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

export { TESTID };
