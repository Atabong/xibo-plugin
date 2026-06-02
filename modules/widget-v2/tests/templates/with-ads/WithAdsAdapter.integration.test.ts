import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PlannedStateActivator,
  type PendingThemeApply,
} from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { systemDwellClock } from '../../../src/render/DwellTimer';
import { TransitionExecutor, type TransitionDefinition, type TransitionPlayer } from '../../../src/render/TransitionExecutor';
import { SingleGameTemplate } from '../../../src/templates/single-game/SingleGameTemplate';
import { MultiGameTemplate } from '../../../src/templates/multi-game/MultiGameTemplate';
import { MultiGameWithAdsTemplate } from '../../../src/templates/with-ads/MultiGameWithAdsTemplate';
import {
  makeMultiGameWithAdsAdapter,
  SnapshottingDwellTimer,
  type AdSlotResolver,
} from '../../../src/templates/with-ads/WithAdsAdapter';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { ThemeChoiceWire, BarPreferencesWire, PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import type { AdSlotPayload } from '../../../src/render/types';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  RecordingCardTransitions,
  makeAssetStore,
  applyAndWarmAdManifest,
  adSlot,
} from './support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(e: RenderJournalEntry): void {
    this.entries.push(e);
  }
  typesOf(t: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === t);
  }
}
class RecordingPlayer implements TransitionPlayer {
  async play(_d: TransitionDefinition): Promise<void> {}
}
class RecordingStyleSheets implements StyleSheetRegistry {
  applyTheme(): void {}
}
class FixedBarTheme implements BarThemeSource {
  currentBarTheme(): ThemeChoiceWire | null {
    return null;
  }
}
class QueuedPendingApply implements PendingThemeApply {
  takePending(): BarPreferencesWire | null {
    return null;
  }
}
/** A real in-memory AdSlot resolver (the production resolver shape). */
class MapAdSlots implements AdSlotResolver {
  private readonly slots = new Map<string, AdSlotPayload>();
  upsert(s: AdSlotPayload): void {
    this.slots.set(s.ad_slot_id, s);
  }
  resolve(id: string): AdSlotPayload | null {
    return this.slots.get(id) ?? null;
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'multiple_games_with_ads',
    program_slot_id: 'slot-1',
    ad_slot_id: 'ad-1',
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

function makeHarness() {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  const { store: assets } = makeAssetStore();
  const adSlots = new MapAdSlots();
  const dwell = new SnapshottingDwellTimer(systemDwellClock);
  const transitions = new TransitionExecutor({
    catalog: new Map([['cut', {}], ['fade_scale_up', {}], ['fade_scale_down', {}]]),
    assets,
    player: new RecordingPlayer(),
    journal,
  });
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell,
    template: new SingleGameTemplate(),
    journal,
    styleSheets: new RecordingStyleSheets(),
    barTheme: new FixedBarTheme(),
    pendingApply: new QueuedPendingApply(),
    clock: systemDwellClock,
  });
  activator.registerTemplate(
    'multiple_games_with_ads',
    makeMultiGameWithAdsAdapter({
      template: new MultiGameWithAdsTemplate(new MultiGameTemplate()),
      journal,
      cardTransitions: new RecordingCardTransitions(),
      assetManifestStore: assets,
      adSlots,
      dwell,
    }),
  );
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, activator, dispatcher, store, journal, assets, adSlots };
}

const cardIds = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.cdq-card')).map((c) => c.dataset['gameId'] ?? '');

describe('multiple_games_with_ads activation through the shared activator (SPEC-CRWDQ-041 #55)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the composite once BOTH the ProgramSlot and the AdSlot are resolvable', async () => {
    const h = makeHarness();
    await applyAndWarmAdManifest(h.assets, ['creative-1']);
    h.adSlots.upsert(adSlot({ ad_slot_id: 'ad-1', ad_ref: 'creative-1' }));
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    const section = h.host.querySelector<HTMLElement>('section.crowdaq-with-ads')!;
    expect(section).not.toBeNull();
    expect(section.dataset['mode']).toBe('multiple_games_with_ads');
    expect(cardIds(section.querySelector('.cdq-content')!)).toEqual(['g1', 'g2']);
    expect(section.querySelector('.cdq-ad-panel img.cdq-ad-creative')).not.toBeNull();
  });

  it('the ProgramSlot half buffers until the slot arrives, then resolves the AdSlot and mounts', async () => {
    const h = makeHarness();
    await applyAndWarmAdManifest(h.assets, ['creative-1']);
    h.adSlots.upsert(adSlot({ ad_slot_id: 'ad-1', ad_ref: 'creative-1' }));

    // PlannedState first, slot absent: nothing renders.
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.querySelector('section.crowdaq-with-ads')).toBeNull();

    // ProgramSlot arrives -> the buffered composite activates (AdSlot resolves).
    h.dispatcher.dispatch(programSlot());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.querySelector('section.crowdaq-with-ads')).not.toBeNull();
  });

  it('an unresolved AdSlot declines: template_input_invalid, no composite mounts', async () => {
    const h = makeHarness();
    await applyAndWarmAdManifest(h.assets, ['creative-1']);
    // AdSlot NOT upserted -> resolver returns null.
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(h.journal.typesOf('template_input_invalid')).not.toHaveLength(0);
  });

  it('supersede journals ad_slot_completed with the boundary dwell from the shared DwellTimer', async () => {
    const h = makeHarness();
    await applyAndWarmAdManifest(h.assets, ['creative-1']);
    h.adSlots.upsert(adSlot({ ad_slot_id: 'ad-1', ad_ref: 'creative-1' }));
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);

    // Advance partway through the dwell, then supersede with a plain single_game.
    await vi.advanceTimersByTimeAsync(3000);
    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g1',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2', ad_slot_id: null }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('section.crowdaq-with-ads')).toBeNull();
    const completed = h.journal.typesOf('ad_slot_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ad_slot_id: 'ad-1', ad_ref: 'creative-1', state_id: 'st-1' });
    expect(completed[0]!['dwell_actual_ms']).toBe(3000);
  });
});
