/**
 * SPEC-CRWDQ-046 (part 2) — the `recap` template activating through the SHARED
 * SPEC-CRWDQ-023 `PlannedStateActivator`, NOT a forked orchestration.
 *
 * Part 1 unit-tested `RecapTemplate.mount` by calling it directly. The part-2 AC
 * is that the recap mounts, dwells, supersedes, and applies preferences through
 * the activator's shared lifecycle via the new `RecapAdapter`:
 *
 *  - re-push order: a recap PlannedState whose ProgramSlot has not yet arrived
 *    buffers, then mounts the moment the slot frame lands;
 *  - dwell boundary: the activator arms the wire `dwell_target_ms` (30 s default)
 *    and journals `dwell_boundary_reached`, leaving the composition rendered;
 *  - pending apply: a pending bar theme drained at the dwell boundary swaps the
 *    rendered `data-theme` WITHOUT re-mounting the frozen composition (the shared
 *    SPEC-CRWDQ-023 dwell-boundary contract);
 *  - supersede: a new state cancels the dwell, runs the outgoing transition, and
 *    `detach()`es the recap — which holds NO GameState subscription, so there is
 *    nothing to unwind and a post-detach late revision never mutates it;
 *  - frozen image: recap subscribes to NO games, so a `game_state_revision`
 *    gates as a silent no-op at the activator (never reaching the instance);
 *  - decline-to-safe: a null `primary_game_id` / a GameState cache miss returns
 *    null from the adapter -> the activator renders nothing (escalation owned by
 *    the safe template).
 *
 * Everything shared is the REAL instance (INV-FACTORY-16): the activator, the
 * resolver, the dwell timer, the GameStateStore, the FixtureListStore, the
 * AssetManifestStore. Only the genuine boundaries are substituted
 * (INV-FACTORY-17): the clock (fake timers), the animation player, and the
 * SPEC-CRWDQ-064 AssetFetcher.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PlannedStateActivator,
  type PendingThemeApply,
} from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { RecapTemplate, type HeadlineMoment } from '../../../src/templates/recap/RecapTemplate';
import {
  makeRecapAdapter,
  type HeadlineMomentSource,
  type PendingRecapApply,
} from '../../../src/templates/recap/RecapAdapter';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type {
  BarPreferencesWire,
  PlannedStateFrame,
  ProgramSlotFrame,
  ThemeChoiceWire,
} from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  makeAssetStore,
  applyBadgeManifest,
  fixture,
  fixtureFrame,
  finalGame,
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

/** A bar theme that returns whatever it is seeded with (default: none). */
class FixedBarTheme implements BarThemeSource {
  currentBarTheme(): null {
    return null;
  }
}

/** A one-shot pending bar-theme source the ACTIVATOR drains at a dwell boundary. */
class QueuedThemeApply implements PendingThemeApply {
  private slot: BarPreferencesWire | null;
  constructor(slot: BarPreferencesWire | null = null) {
    this.slot = slot;
  }
  takePending(): BarPreferencesWire | null {
    const s = this.slot;
    this.slot = null;
    return s;
  }
}

/** A one-shot headline-moment source the ADAPTER drains at mount. */
class OneShotHeadlineMoment implements HeadlineMomentSource {
  private moment: HeadlineMoment | null;
  constructor(moment: HeadlineMoment | null) {
    this.moment = moment;
  }
  takeHeadlineMoment(): HeadlineMoment | null {
    const m = this.moment;
    this.moment = null;
    return m;
  }
}

/** A one-shot recap pending-apply source the ADAPTER drains at mount. */
class OneShotRecapApply implements PendingRecapApply {
  private slot: { theme?: unknown } | null;
  constructor(slot: { theme?: unknown } | null) {
    this.slot = slot;
  }
  takePending(): { theme?: unknown } | null {
    const s = this.slot;
    this.slot = null;
    return s;
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

/** A complete BarPreferencesWire carrying just the theme the swap reads. */
const prefsWithTheme = (theme: ThemeChoiceWire): BarPreferencesWire => ({
  theme,
  sports: [],
  leagues: [],
  region: null,
  state: null,
  city: null,
  timezone: 'America/Chicago',
  business_hours: [],
  local_team_list: [],
  fallback_mode_order: [],
});

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-recap',
    business_mode: 'recap',
    program_slot_id: 'recap-slot',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (
  primaryGameId: string | null,
  over: Partial<Record<string, unknown>> = {},
): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'recap-slot',
    primary_game_id: primaryGameId,
    game_ids: primaryGameId === null ? [] : [primaryGameId],
    fixture_ids: [],
    ...over,
  }) as unknown as ProgramSlotFrame;

interface Harness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  gameStateStore: GameStateStore;
  fixtureListStore: FixtureListStore;
  journal: RecordingJournal;
  player: RecordingPlayer;
  styleSheets: RecordingStyleSheets;
}

function makeHarness(
  opts: {
    barPending?: BarPreferencesWire | null;
    headlineMoment?: HeadlineMoment | null;
    recapPending?: { theme?: unknown } | null;
  } = {},
): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const styleSheets = new RecordingStyleSheets();
  const assetStore = makeAssetStore();
  applyBadgeManifest(assetStore, []);
  const gameStateStore = new GameStateStore(journal);
  const fixtureListStore = new FixtureListStore();

  const transitions = new TransitionExecutor({
    catalog: new Map([
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
    gameStateStore,
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template: new SingleGameTemplate(),
    journal,
    styleSheets,
    barTheme: new FixedBarTheme(),
    pendingApply: new QueuedThemeApply(opts.barPending ?? null),
    clock: systemDwellClock,
  });
  activator.registerTemplate(
    'recap',
    makeRecapAdapter({
      template: new RecapTemplate(),
      journal,
      fixtureListStore,
      assetManifestStore: assetStore,
      ...(opts.headlineMoment !== undefined
        ? { headlineMoment: new OneShotHeadlineMoment(opts.headlineMoment) }
        : {}),
      ...(opts.recapPending !== undefined
        ? { pendingApply: new OneShotRecapApply(opts.recapPending) }
        : {}),
    }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return {
    host,
    activator,
    dispatcher,
    gameStateStore,
    fixtureListStore,
    journal,
    player,
    styleSheets,
  };
}

const recapSection = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-recap');

describe('recap activation through the shared activator (SPEC-CRWDQ-046 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-02T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the recap using the PlannedState-level transition exactly once', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 3, away_score: 1 }));
    h.fixtureListStore.applyList(
      fixtureFrame([fixture('g1', { homeTeam: 'Arsenal', awayTeam: 'Chelsea' })]),
    );

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    const section = recapSection(h.host)!;
    expect(section).not.toBeNull();
    expect(section.dataset['gameId']).toBe('g1');
    expect(section.dataset['winner']).toBe('home');
    expect(section.querySelector('.cdq-team-home .cdq-team-name')!.textContent).toBe('Arsenal');
    // The activator ran the incoming transition exactly once; the template did
    // not double-run it.
    expect(h.player.played.filter((p) => p.animation_id === 'fade_scale_up')).toHaveLength(1);
  });

  it('renders the adapter-drained headline moment and the resolved draw winner', async () => {
    const h = makeHarness({
      headlineMoment: { kind: 'goal', atClock: "90'+3", detail: { scorer: 'Saka' } },
    });
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 2, away_score: 2 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    const section = recapSection(h.host)!;
    expect(section.dataset['winner']).toBe('draw');
    const moment = section.querySelector<HTMLElement>('.cdq-headline-moment')!;
    expect(moment.dataset['momentKind']).toBe('goal');
    expect(moment.textContent).toContain("90'+3");
    expect(moment.textContent).toContain('Saka');
  });

  it('buffers a recap PlannedState until its ProgramSlot arrives (re-push order)', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    // PlannedState first, slot not yet resolved -> buffered, nothing rendered.
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(recapSection(h.host)).toBeNull();

    // The slot frame lands -> the buffered recap mounts.
    h.dispatcher.dispatch(programSlot('g1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(recapSection(h.host)).not.toBeNull();
    expect(h.journal.typesOf('template_buffer_timeout')).toHaveLength(0);
  });

  it('arms the wire dwell and journals dwell_boundary_reached, leaving the composition rendered', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 30_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(1);
    // The closing image stays rendered until the next PlannedState supersedes it.
    expect(recapSection(h.host)).not.toBeNull();
  });

  it('swaps the rendered data-theme at the dwell boundary without re-mounting (shared pending-apply contract)', async () => {
    const h = makeHarness({ barPending: prefsWithTheme({ state: 'set', id: 'midnight' }) });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 30_000 }));
    await vi.advanceTimersByTimeAsync(0);

    const sectionBefore = recapSection(h.host)!;
    expect(sectionBefore.dataset['theme']).toBe('__default__');

    await vi.advanceTimersByTimeAsync(30_000);

    // Same node — the frozen composition was NOT re-mounted; only data-theme moved.
    const sectionAfter = recapSection(h.host)!;
    expect(sectionAfter).toBe(sectionBefore);
    expect(sectionAfter.dataset['theme']).toBe('midnight');
    expect(h.styleSheets.applied).toContain('midnight');
  });

  it('supersedes: cancels the dwell, runs the outgoing transition, and detaches the recap (no subscription to unwind)', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 2, away_score: 1 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 30_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recapSection(h.host)).not.toBeNull();

    // A new single_game state supersedes the recap.
    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g2',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // The recap detached; the outgoing fade ran; the dwell never fired post-supersede.
    expect(recapSection(h.host)).toBeNull();
    expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();
    expect(h.player.played.some((p) => p.animation_id === 'fade_scale_down')).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    // The recap's dwell was cancelled at supersede, so no recap boundary fires
    // and the recap stays detached — there was no subscription to leak.
    expect(recapSection(h.host)).toBeNull();
  });

  it('gates a game_state_revision as a silent no-op — recap subscribes to no games', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 2, away_score: 1 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    const before = recapSection(h.host)!.outerHTML;

    // A late same-game revision: recap registered an EMPTY subscribed set, so the
    // activator's per-game gate misses and never dispatches to the instance.
    await h.activator.reconcile({
      kind: 'game_state_revision',
      gameState: { game_id: 'g1', seq: 99, home_score: 5, away_score: 0 },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(0);
    expect(h.journal.typesOf('recap_late_event')).toHaveLength(0);
    // The frozen image is byte-identical.
    expect(recapSection(h.host)!.outerHTML).toBe(before);
  });

  it('journals recap_premature but still mounts through the activator on a non-final status', async () => {
    const h = makeHarness();
    h.gameStateStore.upsertSnapshot(finalGame('g1', { status: 'live', home_score: 1, away_score: 0 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(recapSection(h.host)).not.toBeNull();
    expect(recapSection(h.host)!.dataset['winner']).toBe('home');
    expect(h.journal.typesOf('recap_premature')).toHaveLength(1);
  });

  it('declines to safe on a null primary_game_id — the adapter returns null, nothing renders', async () => {
    const h = makeHarness();

    h.dispatcher.dispatch(programSlot(null));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(recapSection(h.host)).toBeNull();
    expect(h.journal.typesOf('template_input_invalid')).toHaveLength(1);
    // No dwell is armed when the adapter declines.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);
  });

  it('declines to safe on a GameState cache miss — recap_no_gamestate, nothing renders', async () => {
    const h = makeHarness();
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));
    // GameStateStore is empty for g1.

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(recapSection(h.host)).toBeNull();
    expect(h.journal.typesOf('recap_no_gamestate')).toHaveLength(1);
  });

  it('drains the pending apply through the adapter at mount without re-mounting the composition', async () => {
    // The adapter-level pendingApply is the recap template's own slot; the bare
    // template accepts it but the activator owns the actual theme swap. Draining
    // it must be harmless: the composition mounts once, unchanged.
    const h = makeHarness({ recapPending: { theme: 'midnight' } });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    h.dispatcher.dispatch(programSlot('g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    // Mounted exactly one recap section; the drained pending-apply did not fork it.
    expect(h.host.querySelectorAll('section.crowdaq-recap')).toHaveLength(1);
    // The resolved theme on the wire is still default (the per-state theme_id is
    // null and the bar theme is none); the adapter-drained slot is inert here.
    expect(recapSection(h.host)!.dataset['theme']).toBe('__default__');
  });
});
