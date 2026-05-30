import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  readonly applied: Array<string | null> = [];
  applyTheme(themeId: string | null): void {
    this.applied.push(themeId);
  }
}

class FixedBarTheme implements BarThemeSource {
  constructor(public theme: ThemeChoiceWire | null = null) {}
  currentBarTheme(): ThemeChoiceWire | null {
    return this.theme;
  }
}

/** A real single-slot pending apply (drains once). */
class FakePendingApply implements PendingThemeApply {
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

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'single_game',
    program_slot_id: 'slot-1',
    dwell_target_ms: 30_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (id: string, primaryGameId: string | null): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
  }) as unknown as ProgramSlotFrame;

const prefsWithTheme = (theme: ThemeChoiceWire): BarPreferencesWire => ({
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

interface Harness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  slots: ProgramSlotResolver;
  store: GameStateStore;
  journal: RecordingJournal;
  styleSheets: RecordingStyleSheets;
  barTheme: FixedBarTheme;
  pendingApply: FakePendingApply;
  player: RecordingPlayer;
}

function makeHarness(): Harness {
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
  const barTheme = new FixedBarTheme();
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
  return { host, dispatcher, slots, store, journal, styleSheets, barTheme, pendingApply, player };
}

const rootCount = (host: HTMLElement): number =>
  host.querySelectorAll('section.crowdaq-single-game').length;

describe('PlannedStateActivator dispatch + happy path (AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('mounts the single_game template when the ProgramSlot is already resolved', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 2 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(1);
    expect(h.host.querySelector(`[data-testid="${TESTID.homeTeam}"]`)?.textContent).toContain('Lions');
  });

  it('ignores a non-single_game PlannedState (other templates own those)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ business_mode: 'recap' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(0);
  });

  it('treats a repeated state_id as a no-op: exactly one mount and one transition', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(1);
    expect(h.player.played).toHaveLength(1);
  });
});

describe('PlannedStateActivator buffering (AC4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('buffers a PlannedState that arrives before its ProgramSlot, then mounts on arrival', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(0); // buffered, not yet mounted

    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(1);
  });

  it('journals template_buffer_timeout + template_render_fallback when the slot never arrives', async () => {
    const h = makeHarness();
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.journal.typesOf('template_buffer_timeout')).toHaveLength(1);
    expect(h.journal.typesOf('template_render_fallback')).toHaveLength(1);
  });
});

describe('PlannedStateActivator null program_slot_id (AC5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the placeholder, journals the fallback reason, and still arms dwell', async () => {
    const h = makeHarness();
    let dwellFired = false;
    await h.dispatcher.dispatch(plannedState({ program_slot_id: null, dwell_target_ms: 1000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.querySelector(`[data-testid="${TESTID.placeholder}"]`)).not.toBeNull();
    const fallback = h.journal.typesOf('template_render_fallback')[0];
    expect(fallback?.['reason']).toBe('single_game_missing_program_slot');

    // Dwell still armed: the boundary journal fires after the target.
    await vi.advanceTimersByTimeAsync(1000);
    dwellFired = h.journal.typesOf('dwell_boundary_reached').length === 1;
    expect(dwellFired).toBe(true);
  });
});

describe('PlannedStateActivator supersede', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('detaches the prior slot and mounts the new one on a new state_id', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Tigers' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlot('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rootCount(h.host)).toBe(1);
    expect(h.host.querySelector(`[data-testid="${TESTID.homeTeam}"]`)?.textContent).toContain('Tigers');
  });
});

describe('PlannedStateActivator theme swap at dwell boundary (AC8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('swaps the theme stylesheet only at the boundary when an apply is pending', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 2000 }));
    await vi.advanceTimersByTimeAsync(0);

    h.pendingApply.queue(prefsWithTheme({ state: 'set', id: 'bar-dark' }));
    expect(h.styleSheets.applied).toEqual([]); // not yet — boundary not reached

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.styleSheets.applied).toEqual(['bar-dark']);
    expect((h.host.querySelector(`[data-testid="${TESTID.root}"]`) as HTMLElement).dataset['theme']).toBe('bar-dark');
  });

  it('does not swap the theme when no apply is pending at the boundary', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 2000 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.styleSheets.applied).toEqual([]);
  });
});
