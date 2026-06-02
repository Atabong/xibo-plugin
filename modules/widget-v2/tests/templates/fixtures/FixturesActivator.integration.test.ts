/**
 * SPEC-CRWDQ-034 (part 2) — the `fixtures` template activating through the
 * SHARED SPEC-CRWDQ-023 `PlannedStateActivator`, NOT a forked orchestration.
 *
 * Part 1 unit-tested `FixturesInstance.reconcile` by calling it directly. The
 * part-2 AC is that the instance is invoked by the activator's active-slot
 * reconcile dispatch: a revised `ProgramSlot` (same `program_slot_id`) routed
 * through `activator.reconcile()` must hit the gate, journal
 * `template_reconcile_dispatched`, and run the instance's hook in place —
 * cards swap, the dwell is NOT re-armed, `fixtures_reconciled` is journaled.
 * The `ad_slot` / `game_state_revision` kinds gate as no-ops, and the fixtures
 * render subscribes to NO games (it is the pre-game catalog).
 *
 * Everything shared is the real instance (INV-FACTORY-16): the activator, the
 * resolver, the dwell timer, the FixtureListStore, the AssetManifestStore. Only
 * the genuine boundaries are substituted (INV-FACTORY-17): the clock (fake
 * timers), the animation players, and the SPEC-CRWDQ-064 AssetFetcher.
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
import { FixturesTemplate } from '../../../src/templates/fixtures/FixturesTemplate';
import {
  makeFixturesAdapter,
  type PendingTimezoneApply,
} from '../../../src/templates/fixtures/FixturesAdapter';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  RecordingCardTransitions,
  makeAssetStore,
  applyBadgeManifest,
  fixture,
  fixtureFrame,
} from './support';

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
  currentBarTheme(): null {
    return null;
  }
}

class QueuedPendingApply implements PendingThemeApply {
  private slot: BarPreferencesWire | null = null;
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
    business_mode: 'fixtures',
    program_slot_id: 'slot-1',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (
  fixtureIds: string[],
  over: Partial<Record<string, unknown>> = {},
): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-1',
    primary_game_id: null,
    game_ids: [],
    fixture_ids: fixtureIds,
    ...over,
  }) as unknown as ProgramSlotFrame;

interface Harness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  store: FixtureListStore;
  journal: RecordingJournal;
  player: RecordingPlayer;
  cardTransitions: RecordingCardTransitions;
}

/** A one-shot pending-timezone source the adapter drains at mount (AC12). */
class OneShotPendingTimezone implements PendingTimezoneApply {
  private slot: { timezone?: string } | null;
  constructor(timezone: string) {
    this.slot = { timezone };
  }
  takePending(): { timezone?: string } | null {
    const s = this.slot;
    this.slot = null;
    return s;
  }
}

function makeHarness(opts: { pendingTimezone?: string } = {}): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const cardTransitions = new RecordingCardTransitions();
  const styleSheets = new RecordingStyleSheets();
  const { store: assetStore } = makeAssetStore();
  applyBadgeManifest(assetStore, []);
  const store = new FixtureListStore();
  store.applyList(fixtureFrame([fixture('eA'), fixture('eB'), fixture('eC')]));

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
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: new GameStateStore(journal),
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template: new SingleGameTemplate(),
    journal,
    styleSheets,
    barTheme: new FixedBarTheme(),
    pendingApply: new QueuedPendingApply(),
    clock: systemDwellClock,
  });
  activator.registerTemplate(
    'fixtures',
    makeFixturesAdapter({
      template: new FixturesTemplate(),
      journal,
      cardTransitions,
      fixtureListStore: store,
      assetManifestStore: assetStore,
      timezone: 'America/Chicago',
      ...(opts.pendingTimezone
        ? { pendingApply: new OneShotPendingTimezone(opts.pendingTimezone) }
        : {}),
    }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, activator, dispatcher, store, journal, player, cardTransitions };
}

const order = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-fixture-card')).map(
    (c) => c.dataset['eventId'] ?? '',
  );

describe('fixtures activation through the shared activator (SPEC-CRWDQ-034 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-01T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the catalog using the PlannedState-level transition, no card-level transition (AC7)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot(['eA', 'eB', 'eC']));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(order(h.host)).toEqual(['eA', 'eB', 'eC']);
    // The activator ran the incoming "cut" exactly once; the template did not
    // double-run it, and no card-level slide fired on the initial mount.
    expect(h.player.played.filter((p) => p.animation_id === 'cut')).toHaveLength(1);
    expect(h.cardTransitions.played).toHaveLength(0);
  });

  it('buffers a fixtures PlannedState until its ProgramSlot arrives (re-push order)', async () => {
    const h = makeHarness();
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(order(h.host)).toEqual([]);

    h.dispatcher.dispatch(programSlot(['eA', 'eB']));
    await vi.advanceTimersByTimeAsync(0);
    expect(order(h.host)).toEqual(['eA', 'eB']);
  });

  it('routes an in-place ProgramSlot revision through the activator reconcile gate (AC11)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot(['eA', 'eB']));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(order(h.host)).toEqual(['eA', 'eB']);

    await h.activator.reconcile({
      kind: 'program_slot',
      slot: {
        program_slot_id: 'slot-1',
        primary_game_id: null,
        game_ids: [],
        fixture_ids: ['eA', 'eB', 'eC'],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(order(h.host)).toEqual(['eA', 'eB', 'eC']);
    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(1);
    const rec = h.journal.typesOf('fixtures_reconciled');
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ added: ['eC'], removed: [], reordered: [] });
    // The card-level enter ran for the new card during the dispatched reconcile.
    expect(h.cardTransitions.phasesFor('eC')).toEqual(['enter']);
  });

  it('does NOT re-arm the dwell on a reconcile (D-GRH-13 mid-slot dwell is sacrosanct)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot(['eA', 'eB']));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);

    // Let 3s of the 5s dwell elapse, then reconcile.
    await vi.advanceTimersByTimeAsync(3000);
    await h.activator.reconcile({
      kind: 'program_slot',
      slot: {
        program_slot_id: 'slot-1',
        primary_game_id: null,
        game_ids: [],
        fixture_ids: ['eA', 'eB', 'eC'],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    // No boundary yet (reconcile did not reset the clock).
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);

    // The remaining 2s of the ORIGINAL dwell fires the boundary exactly once. A
    // re-arm would have pushed it out to 3s + 5s and produced none here.
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });

  it('gates ad_slot and game_state_revision as no-ops (no GameState subscription)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot(['eA', 'eB']));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    // ad_slot: the fixtures state carries no ad_slot_id -> gate miss (silent).
    await h.activator.reconcile({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'a', ad_class: 'b', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    // game_state_revision: fixtures subscribes to NO games -> gate miss (silent).
    await h.activator.reconcile({
      kind: 'game_state_revision',
      gameState: { game_id: 'eA', seq: 1 },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(order(h.host)).toEqual(['eA', 'eB']);
    expect(h.journal.typesOf('fixtures_reconciled')).toHaveLength(0);
    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(0);
    expect(h.cardTransitions.played).toHaveLength(0);
  });

  it('supersedes to single_game: detach unsubscribes every fixture card', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot(['eA']));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    const card = h.host.querySelector<HTMLElement>('.cdq-fixture-card')!;
    expect(card.dataset['status']).toBe('scheduled');

    // A single_game state with a new state_id + slot supersedes the catalog.
    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g1',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('.crowdaq-fixtures')).toBeNull();
    expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();

    // A post-detach re-push for eA must not mutate the detached card.
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'live' })]));
    expect(card.dataset['status']).toBe('scheduled');
  });

  it('drains a pending timezone through the adapter at mount, re-formatting cards (AC12)', async () => {
    const h = makeHarness({ pendingTimezone: 'America/New_York' });
    h.dispatcher.dispatch(programSlot(['eA']));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    const when = h.host.querySelector<HTMLElement>('[data-testid="cdq-fixture-when"]')!;
    // Default fixture kickoff 2026-06-02T00:30:00Z -> 8:30 PM New York (EDT),
    // not 7:30 PM Chicago: the adapter applied the pending timezone at mount.
    expect(when.textContent).toMatch(/8:30/);
    expect(h.journal.typesOf('template_locale_refresh')).toHaveLength(1);
  });
});
