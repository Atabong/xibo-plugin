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
import {
  OVERLAY_TESTID,
  type AdSlotResolver,
  type SingleGameOverlayAd,
  type SingleGameOverlayInstance,
  type SingleGameOverlayContext,
} from '../../../src/templates/single-game/SingleGameOverlay';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type { AdSlotPayload } from '../../../src/render/types';
import type { PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
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
  async play(_d: TransitionDefinition): Promise<void> {}
}

class RecordingStyleSheets implements StyleSheetRegistry {
  applyTheme(): void {}
}

class FixedBarTheme implements BarThemeSource {
  currentBarTheme() {
    return null;
  }
}

class FakePendingApply implements PendingThemeApply {
  takePending() {
    return null;
  }
}

/** AdSlotResolver stand-in — empty by default (the current universal case). */
class FakeAdSlots implements AdSlotResolver {
  private map = new Map<string, AdSlotPayload>();
  seed(slot: AdSlotPayload): void {
    this.map.set(slot.ad_slot_id, slot);
  }
  resolve(adSlotId: string): AdSlotPayload | null {
    return this.map.get(adSlotId) ?? null;
  }
}

/** Contract-pin double for SPEC-CRWDQ-065's overlay-ad — records the mount. */
class FakeOverlayAd implements SingleGameOverlayAd {
  readonly mounted: SingleGameOverlayContext[] = [];
  detached = 0;
  mount(host: HTMLElement, ctx: SingleGameOverlayContext): SingleGameOverlayInstance {
    this.mounted.push(ctx);
    const img = document.createElement('img');
    img.className = 'cdq-ad-creative';
    img.dataset['testid'] = 'overlay-creative';
    host.appendChild(img);
    const self = this;
    return {
      detach(): void {
        self.detached += 1;
        img.remove();
      },
    };
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
    ad_slot_id: null,
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

interface Harness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  store: GameStateStore;
  journal: RecordingJournal;
  adSlots: FakeAdSlots;
  overlayAd: FakeOverlayAd;
}

function makeHarness(): Harness {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
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
    player: new RecordingPlayer(),
    journal,
  });
  const adSlots = new FakeAdSlots();
  const overlayAd = new FakeOverlayAd();
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template: new SingleGameTemplate(),
    journal,
    styleSheets: new RecordingStyleSheets(),
    barTheme: new FixedBarTheme(),
    pendingApply: new FakePendingApply(),
    clock: systemDwellClock,
    adSlots,
    overlayAd,
  });
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { host, dispatcher, store, journal, adSlots, overlayAd };
}

const adSlot = (id: string): AdSlotPayload => ({
  ad_slot_id: id,
  ad_class: 'banner',
  ad_ref: 'asset-ad-1',
  ad_ref_type: 'asset_id',
  policy: {},
});

const sel = (host: HTMLElement, testid: string): HTMLElement | null =>
  host.querySelector(`[data-testid="${testid}"]`);

describe('overlay-ad branch — null ad_slot_id (AC6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the bare single_game template with no overlay when ad_slot_id is null', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: null }));
    await vi.advanceTimersByTimeAsync(0);

    expect(sel(h.host, TESTID.root)).not.toBeNull();
    expect(sel(h.host, OVERLAY_TESTID.overlay)).toBeNull();
  });
});

describe('overlay-ad branch — non-null ad_slot_id, no AdSlot payload (AC7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the composite shell with an EMPTY overlay (no <img>) and journals ad_slot_payload_unavailable', async () => {
    const h = makeHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    // Content child unaffected (D-GRH-16): the single_game DOM still renders.
    expect(sel(h.host, TESTID.homeTeam)?.textContent).toContain('Lions');

    // Overlay present but EMPTY — no creative image.
    const overlay = sel(h.host, OVERLAY_TESTID.overlay);
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('img')).toBeNull();

    const journaled = h.journal.typesOf('ad_slot_payload_unavailable');
    expect(journaled).toHaveLength(1);
    expect(journaled[0]).toMatchObject({ state_id: 'st-1', ad_slot_id: 'ad-1' });
  });
});

describe('overlay-ad branch — DOM ownership (AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses .cdq-ad-overlay and never the other templates\' .cdq-ad-panel / grid / fixture DOM', async () => {
    const h = makeHarness();
    h.adSlots.seed(adSlot('ad-1'));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('.cdq-ad-overlay')).not.toBeNull();
    expect(h.host.querySelector('.cdq-ad-panel')).toBeNull();
    expect(h.host.querySelector('.cdq-card-grid')).toBeNull();
    expect(h.host.querySelector('.cdq-fixture-card')).toBeNull();
  });
});

describe('overlay-ad branch — AdSlot payload available (AC8 contract-pin)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delegates the overlay mount to SingleGameOverlayAd with adSlot in context', async () => {
    const h = makeHarness();
    h.adSlots.seed(adSlot('ad-1'));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.overlayAd.mounted).toHaveLength(1);
    expect(h.overlayAd.mounted[0]?.adSlot.ad_slot_id).toBe('ad-1');
    // Content child still present alongside the delegated overlay.
    expect(sel(h.host, TESTID.homeTeam)?.textContent).toContain('Lions');
    // No ad_slot_payload_unavailable journal on the payload-available path.
    expect(h.journal.typesOf('ad_slot_payload_unavailable')).toHaveLength(0);
  });
});

describe('overlay-ad branch — supersede chains detach (AC9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detaches content first then overlay, removing the composite on supersede', async () => {
    const h = makeHarness();
    h.adSlots.seed(adSlot('ad-1'));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Tigers' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlot('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.overlayAd.mounted).toHaveLength(1);

    // Supersede with a plain (no-ad) state.
    await h.dispatcher.dispatch(plannedState({ state_id: 'st-2', program_slot_id: 'slot-2', ad_slot_id: null }));
    await vi.advanceTimersByTimeAsync(0);

    // Composite gone; overlay detached exactly once; new bare content mounted.
    expect(h.overlayAd.detached).toBe(1);
    expect(sel(h.host, OVERLAY_TESTID.overlay)).toBeNull();
    expect(sel(h.host, TESTID.homeTeam)?.textContent).toContain('Tigers');
    expect(h.host.querySelectorAll('section.crowdaq-single-game')).toHaveLength(1);
  });
});
