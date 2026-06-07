/**
 * SPEC-CRWDQ-066 (part 2) — the `fixtures_with_live_game` composite activating
 * through the SHARED SPEC-CRWDQ-023 `PlannedStateActivator`, NOT a forked
 * orchestration. The adapter contributes only the mode-specific mount; the
 * activator owns buffer / transition / dwell / supersede / reconcile dispatch.
 *
 * Every shared collaborator is the real instance (INV-FACTORY-16): the
 * activator, the ProgramSlotResolver, the DwellTimer, the FixtureListStore, the
 * GameStateStore, the AssetManifestStore. Only the genuine boundaries are
 * substituted (INV-FACTORY-17): the clock (fake timers), the transition player,
 * the card-animation player, and the SPEC-CRWDQ-064 AssetFetcher.
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
import { FixturesWithLiveGameTemplate } from '../../../src/templates/mixed-state/FixturesWithLiveGameTemplate';
import { makeFixturesWithLiveGameAdapter } from '../../../src/templates/mixed-state/FixturesWithLiveGameAdapter';
import { LIVE_TILE_TESTID } from '../../../src/templates/mixed-state/LiveFixtureTile';
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

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'fixtures_with_live_game',
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
    primary_game_id: 'fA',
    game_ids: [],
    fixture_ids: ['fA', 'fB', 'fC'],
    ...over,
  }) as unknown as ProgramSlotFrame;

function makeHarness() {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const cardTransitions = new RecordingCardTransitions();
  const styleSheets = new RecordingStyleSheets();
  const { store: assetStore } = makeAssetStore();
  applyBadgeManifest(assetStore, []);
  const fixtures = new FixtureListStore();
  fixtures.applyList(
    fixtureFrame([
      fixture('fA', { homeTeam: 'Arsenal', awayTeam: 'Chelsea', feedStatus: 'live' }),
      fixture('fB', { homeTeam: 'Spurs', awayTeam: 'Fulham' }),
      fixture('fC', { homeTeam: 'Leeds', awayTeam: 'Wolves' }),
    ]),
  );
  const games = new GameStateStore(journal);
  games.upsertSnapshot({
    game_id: 'fA',
    seq: 1,
    home_score: 14,
    away_score: 7,
    sport_context: { period_clock: 'Q3 8:12' },
  });

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
    gameStateStore: games,
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
    'fixtures_with_live_game',
    makeFixturesWithLiveGameAdapter({
      template: new FixturesWithLiveGameTemplate(),
      journal,
      cardTransitions,
      fixtureListStore: fixtures,
      assetManifestStore: assetStore,
      gameStateStore: games,
      timezone: () => 'America/Chicago',
    }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, activator, dispatcher, journal, player, games };
}

const liveCard = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('.cdq-fixture-card.cdq-tile-live');
const ids = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-fixture-card')).map(
    (c) => c.dataset['eventId'] ?? '',
  );

describe('fixtures_with_live_game through the shared activator (SPEC-CRWDQ-066 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-01T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches the mode to the composite, reusing the shared transition + dwell (AC2)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(ids(h.host)).toEqual(['fA', 'fB', 'fC']);
    expect(liveCard(h.host)!.dataset['gameId']).toBe('fA');
    // The activator ran the incoming "cut" exactly once (the composite did not
    // double-run a PlannedState-level transition).
    expect(h.player.played.filter((p) => p.animation_id === 'cut')).toHaveLength(1);

    // The dwell armed by the activator fires its boundary.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });

  it('buffers the PlannedState until its ProgramSlot arrives (re-push order)', async () => {
    const h = makeHarness();
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(ids(h.host)).toEqual([]);

    h.dispatcher.dispatch(programSlot());
    await vi.advanceTimersByTimeAsync(0);
    expect(ids(h.host)).toEqual(['fA', 'fB', 'fC']);
  });

  it('routes an in-place ProgramSlot re-promotion through the activator reconcile gate', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    h.games.upsertSnapshot({ game_id: 'fB', seq: 1, home_score: 3, away_score: 1, sport_context: { period_clock: 'P2' } });

    await h.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'fB', game_ids: [], fixture_ids: ['fA', 'fB', 'fC'] },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(liveCard(h.host)!.dataset['gameId']).toBe('fB');
    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(1);
    expect(h.journal.typesOf('live_tile_reconciled')).toHaveLength(1);
  });

  it('does NOT re-arm the dwell on a reconcile (D-GRH-13 mid-slot dwell is sacrosanct)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);
    h.games.upsertSnapshot({ game_id: 'fB', seq: 1, home_score: 0, away_score: 0, sport_context: {} });

    await vi.advanceTimersByTimeAsync(3000);
    await h.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'fB', game_ids: [], fixture_ids: ['fA', 'fB', 'fC'] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
  });

  it('supersedes to single_game: detach unsubscribes the live tile + the static cards', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    const live = liveCard(h.host)!;
    const liveScoreBefore = live.querySelector(`[data-testid="${LIVE_TILE_TESTID.homeScore}"]`)!.textContent;

    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'fA',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('.crowdaq-fixtures-with-live-game')).toBeNull();
    expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();

    // A post-detach GameEvent for fA must not mutate the detached live tile.
    h.games.applyEvent({ game_id: 'fA', seq: 2, home_score: 99 });
    expect(live.querySelector(`[data-testid="${LIVE_TILE_TESTID.homeScore}"]`)!.textContent).toBe(
      liveScoreBefore,
    );
  });
});
