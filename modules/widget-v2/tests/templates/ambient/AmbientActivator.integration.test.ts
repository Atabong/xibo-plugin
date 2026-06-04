/**
 * SPEC-CRWDQ-053 (#58 part 1) — the `ambient` template activating through the
 * SHARED SPEC-CRWDQ-023 `PlannedStateActivator`, NOT a forked orchestration
 * (INV-FACTORY-19). Everything shared is the REAL instance (INV-FACTORY-16): the
 * activator, the ProgramSlotResolver, the DwellTimer, the AssetManifestStore,
 * the AmbientPlaylist, AND the SPEC-CRWDQ-052 SafeInfoTemplate exercised
 * end-to-end on the empty-manifest fallback. Only the genuine boundaries are
 * substituted (INV-FACTORY-17): the clock (fake timers) and the animation
 * player.
 */
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
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { SafeInfoTemplate } from '../../../src/templates/safe-info/SafeInfoTemplate';
import { AmbientTemplate } from '../../../src/templates/ambient/AmbientTemplate';
import { AmbientPlaylist } from '../../../src/templates/ambient/AmbientPlaylist';
import { makeAmbientAdapter } from '../../../src/templates/ambient/AmbientAdapter';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type { BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame, ThemeChoiceWire } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import { makeAssetStore, applyManifest, image, video } from './support';

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

class SeededBarTheme implements BarThemeSource {
  constructor(private readonly theme: ThemeChoiceWire | null) {}
  currentBarTheme(): ThemeChoiceWire | null {
    return this.theme;
  }
}

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

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

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

const ambientState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-ambient',
    business_mode: 'ambient',
    program_slot_id: 'ambient-slot',
    ad_slot_id: null,
    dwell_target_ms: 5_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const ambientSlot = (over: Partial<Record<string, unknown>> = {}): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'ambient-slot',
    primary_game_id: null,
    game_ids: [],
    ...over,
  }) as unknown as ProgramSlotFrame;

function makeHarness(
  opts: { barPending?: BarPreferencesWire | null; barTheme?: ThemeChoiceWire | null } = {},
) {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const player = new RecordingPlayer();
  const styleSheets = new RecordingStyleSheets();
  const assetStore = makeAssetStore();
  const gameStateStore = new GameStateStore(journal);

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
    barTheme: new SeededBarTheme(opts.barTheme ?? null),
    pendingApply: new QueuedThemeApply(opts.barPending ?? null),
    clock: systemDwellClock,
  });
  activator.registerTemplate(
    'ambient',
    makeAmbientAdapter({
      template: new AmbientTemplate(),
      safeInfoTemplate: new SafeInfoTemplate(),
      assetManifestStore: assetStore,
      journal,
      makePlaylist: () => new AmbientPlaylist({ assetManifestStore: assetStore, journal }),
      makeDwell: () => new DwellTimer(systemDwellClock),
      barPreferences: () => null,
    }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, activator, dispatcher, journal, player, styleSheets, assetStore };
}

const ambientSection = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-ambient');
const safeSection = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-safe-info');

describe('ambient activation through the shared activator (SPEC-CRWDQ-053 #58)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-02T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the ambient stage through the shared activator with the PlannedState transition', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [image('ambient:001'), image('ambient:002')]);

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState());
    await vi.advanceTimersByTimeAsync(0);

    expect(ambientSection(h.host)).not.toBeNull();
    expect(h.player.played.filter((p) => p.animation_id === 'fade_scale_up')).toHaveLength(1);
  });

  it('resolves the non-null program_slot_id via the shared resolver (buffers until the slot arrives)', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [image('ambient:001')]);

    // PlannedState first, slot absent -> the shared activator buffers it.
    await h.dispatcher.dispatch(ambientState());
    await vi.advanceTimersByTimeAsync(0);
    expect(ambientSection(h.host)).toBeNull();

    // The slot frame lands -> the buffered ambient mounts.
    h.dispatcher.dispatch(ambientSlot());
    await vi.advanceTimersByTimeAsync(0);
    expect(ambientSection(h.host)).not.toBeNull();
  });

  it('routes an empty manifest to SafeInfoTemplate in the same host (AC3)', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [image('badge:home')]); // no ambient:* assets

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState());
    await vi.advanceTimersByTimeAsync(0);

    expect(ambientSection(h.host)).toBeNull();
    const safe = safeSection(h.host)!;
    expect(safe).not.toBeNull();
    expect(safe.dataset['source']).toBe('backend_planned');
    expect(safe.dataset['reason']).toBe('no_content');
    expect(h.journal.typesOf('ambient_empty_manifest')).toHaveLength(1);
  });

  it('routes an all-video manifest to SafeInfoTemplate (AC3 filtered-empty)', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [video('ambient:001'), video('ambient:002')]);

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState());
    await vi.advanceTimersByTimeAsync(0);

    expect(ambientSection(h.host)).toBeNull();
    expect(safeSection(h.host)).not.toBeNull();
    expect(h.journal.typesOf('ambient_empty_manifest')).toHaveLength(1);
    expect(h.journal.typesOf('ambient_video_deferred')).toHaveLength(1);
  });

  it('rotates on the shared dwell pace and continues indefinitely', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [image('ambient:001'), image('ambient:002')]);

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState({ dwell_target_ms: 5_000 }));
    await vi.advanceTimersByTimeAsync(0);

    const img = () => h.host.querySelector<HTMLImageElement>('img.cdq-ambient-creative')!;
    expect(img().dataset['assetId']).toBe('ambient:001');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(img().dataset['assetId']).toBe('ambient:002');
    expect(ambientSection(h.host)).not.toBeNull();
  });

  it('applies the resolved theme and swaps it at the PlannedState dwell boundary independent of rotation', async () => {
    const h = makeHarness({ barPending: prefsWithTheme({ state: 'set', id: 'midnight' }) });
    applyManifest(h.assetStore, [image('ambient:001'), image('ambient:002')]);

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState({ dwell_target_ms: 5_000 }));
    await vi.advanceTimersByTimeAsync(0);

    const before = ambientSection(h.host)!;
    expect(before.dataset['theme']).toBe('__default__');

    await vi.advanceTimersByTimeAsync(5_000);
    // The activator's dwell-boundary theme swap moved data-theme on the same root.
    const after = ambientSection(h.host)!;
    expect(after).toBe(before);
    expect(after.dataset['theme']).toBe('midnight');
    expect(h.styleSheets.applied).toContain('midnight');
  });

  it('supersedes: cancels the dwell, runs the outgoing transition, and detaches the ambient', async () => {
    const h = makeHarness();
    applyManifest(h.assetStore, [image('ambient:001'), image('ambient:002')]);

    h.dispatcher.dispatch(ambientSlot());
    await h.dispatcher.dispatch(ambientState({ dwell_target_ms: 5_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ambientSection(h.host)).not.toBeNull();

    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g2',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      ambientState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(ambientSection(h.host)).toBeNull();
    expect(h.host.querySelector('.crowdaq-single-game')).not.toBeNull();
    expect(h.player.played.some((p) => p.animation_id === 'fade_scale_down')).toBe(true);

    // The ambient rotation timer was cancelled at detach: no zombie rotation.
    const advancedBefore = h.journal.typesOf('ambient_creative_advanced').length;
    await vi.advanceTimersByTimeAsync(5_000 * 3);
    expect(h.journal.typesOf('ambient_creative_advanced')).toHaveLength(advancedBefore);
  });
});
