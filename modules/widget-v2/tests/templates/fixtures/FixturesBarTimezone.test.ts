/**
 * SPEC-CRWDQ-034 / D-GRH-73 (S83) — GUARANTEED bar-local timezone handling for
 * fixture kickoff times on the bar player.
 *
 * Regression guard for the production bug where the `fixtures` board rendered
 * kickoff times in UTC because the bar timezone was captured EAGERLY at adapter
 * registration (before the first ConfigPush populated the bar preferences),
 * freezing the 'UTC' fallback into every render. The fix passes the timezone as
 * a THUNK evaluated INSIDE `mount` (which runs per PlannedState, after the first
 * ConfigPush set the bar prefs), and broadcasts a live reformat when a later
 * `replaced` ConfigPush EDITS the zone.
 *
 * These tests drive the REAL adapter through the REAL shared activator
 * (INV-FACTORY-16): the only substituted boundaries (INV-FACTORY-17) are the
 * clock (fake timers), the animation player, and the AssetFetcher. The bar
 * timezone is read through a mutable `barTimezone` ref, exactly mirroring the
 * bootstrap thunk `() => lastPrefs?.timezone ?? 'UTC'` and the
 * `FixturesTimezoneBroadcast` the composition root fires on a tz edit.
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
import { makeFixturesAdapter } from '../../../src/templates/fixtures/FixturesAdapter';
import { FixturesTimezoneBroadcast } from '../../../src/render/FixturesTimezoneBroadcast';
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
    business_mode: 'fixtures',
    program_slot_id: 'slot-1',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (fixtureIds: string[]): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-1',
    primary_game_id: null,
    game_ids: [],
    fixture_ids: fixtureIds,
  }) as unknown as ProgramSlotFrame;

interface Harness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  broadcast: FixturesTimezoneBroadcast;
  /** Mutable bar timezone the adapter thunk reads (mirrors bootstrap lastPrefs). */
  tz: { current: string };
}

function makeHarness(): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const cardTransitions = new RecordingCardTransitions();
  const { store: assetStore } = makeAssetStore();
  applyBadgeManifest(assetStore, []);
  const store = new FixtureListStore();
  // 20:10Z kickoff — the spec's worked example (2:10 PM MDT in America/Denver).
  store.applyList(
    fixtureFrame([fixture('eA', { kickoffUtc: '2026-06-02T20:10:00Z' })]),
  );

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
    styleSheets: new RecordingStyleSheets(),
    barTheme: new FixedBarTheme(),
    pendingApply: new QueuedPendingApply(),
    clock: systemDwellClock,
  });

  const broadcast = new FixturesTimezoneBroadcast();
  // Pre-ConfigPush: the thunk reads the UTC fallback, exactly like the bootstrap
  // `() => lastPrefs?.timezone ?? 'UTC'` before the first push lands.
  const tz = { current: 'UTC' };
  activator.registerTemplate(
    'fixtures',
    makeFixturesAdapter({
      template: new FixturesTemplate(),
      journal,
      cardTransitions,
      fixtureListStore: store,
      assetManifestStore: assetStore,
      timezone: () => tz.current,
      timezoneBroadcast: broadcast,
    }),
  );

  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, dispatcher, broadcast, tz };
}

/** The rendered kickoff text of the first card. */
const whenText = (host: ParentNode): string =>
  host.querySelector<HTMLElement>('[data-testid="cdq-fixture-when"]')?.textContent ?? '';

async function mountBoard(h: Harness): Promise<void> {
  h.dispatcher.dispatch(programSlot(['eA']));
  await h.dispatcher.dispatch(plannedState());
  await vi.advanceTimersByTimeAsync(0);
}

describe('fixtures bar-timezone handling (SPEC-CRWDQ-034 / D-GRH-73, S83)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-02T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders kickoff in the bar timezone set by a ConfigPush, not UTC (America/Denver)', async () => {
    const h = makeHarness();
    // ConfigPush sets the bar zone BEFORE the board mounts (the normal order):
    // the thunk now reads America/Denver, so a 20:10Z kickoff renders 2:10 PM.
    h.tz.current = 'America/Denver';
    await mountBoard(h);

    const text = whenText(h.host);
    expect(text).toMatch(/2:10/); // 20:10Z == 14:10 MDT
    expect(text).not.toMatch(/8:10/); // NOT raw UTC (20:10 -> 8:10 PM)
  });

  it('labels the rendered time with the bar timezone short name (MDT)', async () => {
    const h = makeHarness();
    h.tz.current = 'America/Denver';
    await mountBoard(h);
    // GUARANTEED-LABEL: the viewer always sees which zone the kickoff is in.
    expect(whenText(h.host)).toMatch(/MDT/);
  });

  it('renders a labeled, explicit UTC for the pre-ConfigPush fallback', async () => {
    const h = makeHarness(); // tz stays 'UTC' — no ConfigPush yet
    await mountBoard(h);
    const text = whenText(h.host);
    expect(text).toMatch(/8:10/); // 20:10Z == 8:10 PM UTC
    // The UTC fallback is explicitly labeled, never silently implying local.
    expect(text).toMatch(/UTC/);
  });

  it('reformats an already-mounted board when a `replaced` ConfigPush edits the zone', async () => {
    const h = makeHarness();
    h.tz.current = 'America/Denver';
    await mountBoard(h);
    expect(whenText(h.host)).toMatch(/2:10 PM MDT/);

    // Operator EDITS the bar zone to Los Angeles (a `replaced` ConfigPush). The
    // composition root updates lastPrefs and fires the broadcast; the live board
    // reformats in place — no remount.
    h.tz.current = 'America/Los_Angeles';
    h.broadcast.broadcast('America/Los_Angeles');

    const text = whenText(h.host);
    expect(text).toMatch(/1:10 PM PDT/); // 20:10Z == 13:10 PDT
    expect(text).not.toMatch(/MDT/);
  });

  it('unsubscribes a superseded board from the broadcast (no reformat after detach)', async () => {
    const h = makeHarness();
    h.tz.current = 'America/Denver';
    await mountBoard(h);
    expect(h.broadcast.size).toBe(1);

    // Supersede with a new state_id -> the outgoing board detaches.
    h.dispatcher.dispatch(programSlot(['eA']));
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2' }));
    await vi.advanceTimersByTimeAsync(0);

    // The torn-down board no longer holds a live broadcast subscription; only
    // the current board does (size stays bounded, no leak).
    expect(h.broadcast.size).toBe(1);
  });
});
