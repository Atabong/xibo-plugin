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
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { makeMultiGameAdapter } from '../../../src/templates/multi-game/MultiGameAdapter';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { ThemeChoiceWire, BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  MapAssetCache,
  FakeAssetFetcher,
  RecordingJournal as ManifestRecordingJournal,
} from '../../render/asset-manifest/support';
import { RecordingCardTransitions } from './support';

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

class QueuedPendingApply implements PendingThemeApply {
  private slot: BarPreferencesWire | null = null;
  queue(prefs: BarPreferencesWire): void {
    this.slot = prefs;
  }
  takePending(): BarPreferencesWire | null {
    const s = this.slot;
    this.slot = null;
    return s;
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'multiple_games',
    program_slot_id: 'slot-1',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (over: Partial<Record<string, unknown>> = {}): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-1',
    primary_game_id: 'g1',
    game_ids: ['g1', 'g2'],
    ...over,
  }) as unknown as ProgramSlotFrame;

interface Harness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  store: GameStateStore;
  journal: RecordingJournal;
  player: RecordingPlayer;
  cardTransitions: RecordingCardTransitions;
  styleSheets: RecordingStyleSheets;
  pending: QueuedPendingApply;
}

function makeHarness(barTheme: ThemeChoiceWire | null = null): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  const player = new RecordingPlayer();
  const cardTransitions = new RecordingCardTransitions();
  const styleSheets = new RecordingStyleSheets();
  const pending = new QueuedPendingApply();
  const transitions = new TransitionExecutor({
    catalog: new Map([
      ['cut', {}],
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
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template: new SingleGameTemplate(),
    journal,
    styleSheets,
    barTheme: new FixedBarTheme(barTheme),
    pendingApply: pending,
    clock: systemDwellClock,
  });
  activator.registerTemplate(
    'multiple_games',
    makeMultiGameAdapter({ template: new MultiGameTemplate(), journal, cardTransitions }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, activator, dispatcher, store, journal, player, cardTransitions, styleSheets, pending };
}

const cardIds = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-card')).map((c) => c.dataset['gameId'] ?? '');

describe('multiple_games activation through the shared activator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the grid using the PlannedState-level transition (AC5)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(cardIds(h.host)).toEqual(['g1', 'g2']);
    // The incoming PlannedState transition ("cut") ran against the host; no
    // card-level transition fired on the initial mount.
    expect(h.player.played.map((p) => p.animation_id)).toContain('cut');
    expect(h.cardTransitions.played).toHaveLength(0);
  });

  it('buffers a multiple_games PlannedState until its ProgramSlot arrives (AC8)', async () => {
    const h = makeHarness();
    // PlannedState first, slot absent: nothing renders yet.
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(cardIds(h.host)).toEqual([]);

    // ProgramSlot arrives -> the buffered state activates.
    h.dispatcher.dispatch(programSlot());
    await vi.advanceTimersByTimeAsync(0);
    expect(cardIds(h.host)).toEqual(['g1', 'g2']);
  });

  it('routes an in-place ProgramSlot revision through the activator reconcile gate', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    await h.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'g1', game_ids: ['g1', 'g2', 'g3'] },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(cardIds(h.host)).toEqual(['g1', 'g2', 'g3']);
    expect(h.journal.typesOf('multi_game_reconciled')).toHaveLength(1);
  });

  it('supersedes to single_game: outgoing transition + every card unsubscribed (AC9)', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 0 });
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(cardIds(h.host)).toEqual(['g1', 'g2']);

    // A single_game state with a NEW state_id + slot supersedes the grid.
    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g1',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // The grid is gone, the single-game section mounted.
    expect(h.host.querySelector('.crowdaq-multi-game')).toBeNull();
    expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();

    // Cards were unsubscribed at detach: a post-detach delta for g2 mutates nothing.
    const before = h.host.innerHTML;
    h.store.applyEvent({ game_id: 'g2', seq: 9, home_score: 7 });
    expect(h.host.innerHTML).toBe(before);
  });

  it('keeps every card rendered after the dwell boundary fires (dwell handling)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5000);

    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
    // The slot dwell expiring does NOT tear the grid down; cards await the next
    // PlannedState (only a supersede removes them).
    expect(cardIds(h.host)).toEqual(['g1', 'g2']);
  });

  it('swaps the theme at the dwell boundary when a preference apply is pending (AC10)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);

    h.pending.queue({ theme: { state: 'set', id: 'dusk' } } as unknown as BarPreferencesWire);
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
    expect(h.styleSheets.applied).toContain('dusk');
  });
});
