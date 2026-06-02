/**
 * SPEC-CRWDQ-065 (#64) — the single_game overlay-ad creative seam.
 *
 * The composite SHELL (`<section class="crowdaq-single-game-composite">`, the
 * `.cdq-content` / `.cdq-ad-overlay` hosts, the activator branch on
 * `ad_slot_id`, the ProgramSlot/AdSlot buffer, the chained detach + supersede
 * transition) is owned by the already-merged SPEC-CRWDQ-023 part-2
 * `mountOverlayComposite` (`src/templates/single-game/SingleGameOverlay.ts`).
 * This spec OWNS the `SingleGameOverlayAd` seam that part-2 delegates the
 * overlay creative to: it paints exactly one static `AdPanel` creative into the
 * overlay host, declines (empty overlay) on a cache miss so the bare content
 * survives (D-GRH-16), fires `ad_slot_rendered` on the image `load`, and
 * journals `ad_slot_completed` at detach.
 *
 * Per INV-FACTORY-16/-17 the children are REAL: the real `AdPanel`, a real
 * `AssetManifestStore` driven through a substituted `AssetFetcher`, and a real
 * in-memory journal. The only substituted boundaries are the asset fetch and
 * the image `load` event ({@link withSyncImageLoad}). Where it exercises the
 * full activation path it drives the REAL `PlannedStateActivator` +
 * `mountOverlayComposite` + `SingleGameTemplate` so the seam is verified as a
 * consumer wires it, not in isolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SingleGameOverlayAd } from '../../../src/templates/with-ads/SingleGameOverlayAd';
import { PlannedStateActivator } from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import type { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { OVERLAY_TESTID, type AdSlotResolver } from '../../../src/templates/single-game/SingleGameOverlay';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource, ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type { SingleGameContext } from '../../../src/templates/single-game/SingleGameTemplate';
import type { AdSlotPayload } from '../../../src/render/types';
import type { PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  RecordingJournal,
  makeAssetStore,
  applyAndWarmAdManifest,
  applyColdAdManifest,
  adSlot,
  withSyncImageLoad,
} from './support';

const DEFAULT_THEME: ResolvedTheme = { state: 'default' };

const sel = (host: HTMLElement, testid: string): HTMLElement | null =>
  host.querySelector(`[data-testid="${testid}"]`);

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

class RecordingPlayer implements TransitionPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(d: TransitionDefinition): Promise<void> {
    this.played.push(d);
  }
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
/** Resolves AdSlots seeded by id (the AC8 payload-available path). */
class FakeAdSlots implements AdSlotResolver {
  private map = new Map<string, AdSlotPayload>();
  seed(slot: AdSlotPayload): void {
    this.map.set(slot.ad_slot_id, slot);
  }
  resolve(adSlotId: string): AdSlotPayload | null {
    return this.map.get(adSlotId) ?? null;
  }
}

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'single_game',
    program_slot_id: 'slot-1',
    ad_slot_id: 'ad-1',
    dwell_target_ms: 30_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlotFrame = (id: string, primaryGameId: string | null): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
  }) as unknown as ProgramSlotFrame;

interface E2EHarness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  store: GameStateStore;
  journal: RecordingJournal;
  adSlots: FakeAdSlots;
  player: RecordingPlayer;
}

/**
 * Drive the REAL activator + merged `mountOverlayComposite` + REAL
 * `SingleGameTemplate` with the REAL `SingleGameOverlayAd` (this spec) wired as
 * the `overlayAd` seam and a REAL `AssetManifestStore` behind it — the seam is
 * verified as a consumer wires it (INV-FACTORY-16), not in isolation.
 */
async function makeE2E(store: AssetManifestStore): Promise<E2EHarness> {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const gameStore = new GameStateStore(journal);
  const player = new RecordingPlayer();
  const transitions = new TransitionExecutor({
    catalog: new Map([
      ['fade_scale_up', {}],
      ['fade_scale_down', {}],
    ]),
    assets: store,
    player,
    journal,
  });
  const adSlots = new FakeAdSlots();
  const overlayAd = new SingleGameOverlayAd({
    assetManifestStore: store,
    journal,
    stateId: () => 'st-1',
  });
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: gameStore,
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
  return { host, dispatcher, store: gameStore, journal, adSlots, player };
}

/** A bare SingleGameContext bound to a resolved slot + store. */
function context(store: GameStateStore, primaryGameId: string | null): SingleGameContext {
  return {
    programSlot: { program_slot_id: 'slot-1', primary_game_id: primaryGameId, game_ids: [] },
    theme: DEFAULT_THEME,
    gameStateStore: store,
  };
}

// ---- direct-seam harness: paint into a standalone overlay host -------------

describe('SingleGameOverlayAd.mount — creative paint (AC2)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('paints one static <img class="cdq-ad-creative"> with the manifest-resolved url into the overlay host', async () => {
    const { store } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(store, ['creative-1']);
    const gameStore = new GameStateStore(new RecordingJournal());
    const journal = new RecordingJournal();

    new SingleGameOverlayAd({ assetManifestStore: store, journal }).mount(host, {
      ...context(gameStore, 'g1'),
      adSlot: adSlot({ ad_ref: 'creative-1' }),
    });

    const imgs = host.querySelectorAll('img.cdq-ad-creative');
    expect(imgs).toHaveLength(1);
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe(urls['creative-1']);
  });
});

describe('SingleGameOverlayAd.mount — cache miss leaves the overlay empty (AC4)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('renders no creative and journals ad_asset_cache_miss + warms the cache on a miss', async () => {
    const { store, fetcher } = makeAssetStore();
    applyColdAdManifest(store, ['creative-cold']); // declared, never warmed -> get() misses
    const gameStore = new GameStateStore(new RecordingJournal());
    const journal = new RecordingJournal();

    new SingleGameOverlayAd({ assetManifestStore: store, journal }).mount(host, {
      ...context(gameStore, 'g1'),
      adSlot: adSlot({ ad_slot_id: 'ad-cold', ad_ref: 'creative-cold' }),
    });

    // Overlay empty (content survives, D-GRH-16) + the miss is journaled + warmed.
    expect(host.querySelector('img.cdq-ad-creative')).toBeNull();
    const miss = journal.typesOf('ad_asset_cache_miss');
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ ad_slot_id: 'ad-cold', ad_ref: 'creative-cold' });
    await Promise.resolve();
    expect(fetcher.callsFor('creative-cold')).toBe(1);
  });
});

describe('SingleGameOverlayAd.mount — ad_slot_rendered on load (AC6)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('journals ad_slot_rendered with ad_slot_id, ad_ref, state_id on the image load event', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const gameStore = new GameStateStore(new RecordingJournal());
    const journal = new RecordingJournal();

    await withSyncImageLoad(async () => {
      new SingleGameOverlayAd({
        assetManifestStore: store,
        journal,
        stateId: () => 'st-9',
      }).mount(host, {
        ...context(gameStore, 'g1'),
        adSlot: adSlot({ ad_slot_id: 'ad-7', ad_ref: 'creative-1' }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const rendered = journal.typesOf('ad_slot_rendered');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ ad_slot_id: 'ad-7', ad_ref: 'creative-1', state_id: 'st-9' });
  });
});

describe('SingleGameOverlayAd detach — ad_slot_completed (AC9, seam portion)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('journals ad_slot_completed with the slot identity + dwell and removes the creative', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const gameStore = new GameStateStore(new RecordingJournal());
    const journal = new RecordingJournal();

    const instance = new SingleGameOverlayAd({
      assetManifestStore: store,
      journal,
      stateId: () => 'st-3',
      dwellActualMs: () => 4200,
    }).mount(host, {
      ...context(gameStore, 'g1'),
      adSlot: adSlot({ ad_slot_id: 'ad-3', ad_ref: 'creative-1' }),
    });
    expect(host.querySelector('img.cdq-ad-creative')).not.toBeNull();

    instance.detach();

    // Creative torn down behaviourally (INV-FACTORY-16: observe the DOM, not a spy).
    expect(host.querySelector('img.cdq-ad-creative')).toBeNull();
    const completed = journal.typesOf('ad_slot_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      ad_slot_id: 'ad-3',
      ad_ref: 'creative-1',
      state_id: 'st-3',
      dwell_actual_ms: 4200,
    });
  });
});

// ---- end-to-end through the REAL activator + merged composite -------------

describe('overlay composite end-to-end (AC1/AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the bare single_game template with no overlay creative when ad_slot_id is null', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const h = await makeE2E(store);
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlotFrame('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: null }));
    await vi.advanceTimersByTimeAsync(0);

    expect(sel(h.host, TESTID.root)).not.toBeNull();
    expect(sel(h.host, OVERLAY_TESTID.overlay)).toBeNull();
    expect(h.host.querySelector('img.cdq-ad-creative')).toBeNull();
  });

  it('mounts .cdq-content (single_game output) beside .cdq-ad-overlay carrying the AdPanel creative', async () => {
    const { store } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(store, ['creative-1']);
    const h = await makeE2E(store);
    h.adSlots.seed(adSlot({ ad_slot_id: 'ad-1', ad_class: 'overlay', ad_ref: 'creative-1' }));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlotFrame('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    // Content child: the unmodified single_game output, full surface.
    const content = sel(h.host, OVERLAY_TESTID.content);
    expect(content).not.toBeNull();
    expect(content?.querySelector(`[data-testid="${TESTID.homeTeam}"]`)?.textContent).toContain('Lions');

    // Overlay host: the AdPanel creative painted by THIS seam.
    const overlay = sel(h.host, OVERLAY_TESTID.overlay);
    const img = overlay?.querySelector<HTMLImageElement>('img.cdq-ad-creative');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(urls['creative-1']);
  });
});

describe('overlay composite end-to-end — GameState isolation (AC7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a GameState event updates .cdq-content but the overlay <img> keeps its src', async () => {
    const { store } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(store, ['creative-1']);
    const h = await makeE2E(store);
    h.adSlots.seed(adSlot({ ad_slot_id: 'ad-1', ad_class: 'overlay', ad_ref: 'creative-1' }));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions', home_score: 0 });
    h.dispatcher.dispatch(programSlotFrame('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    const img = sel(h.host, OVERLAY_TESTID.overlay)?.querySelector<HTMLImageElement>('img.cdq-ad-creative');
    const srcBefore = img?.getAttribute('src');

    // Score advances on the subscribed primary game.
    h.store.applyEvent({ game_id: 'g1', seq: 2, home_score: 3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(sel(h.host, TESTID.homeTeam)?.textContent).toContain('3');
    // Same <img> node, same src — the overlay never re-rendered (D-GRH-16).
    const imgAfter = sel(h.host, OVERLAY_TESTID.overlay)?.querySelector<HTMLImageElement>('img.cdq-ad-creative');
    expect(imgAfter).toBe(img);
    expect(imgAfter?.getAttribute('src')).toBe(srcBefore);
  });
});

describe('overlay composite end-to-end — supersede (AC9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the outgoing transition, removes the composite, and journals ad_slot_completed', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const h = await makeE2E(store);
    h.adSlots.seed(adSlot({ ad_slot_id: 'ad-1', ad_class: 'overlay', ad_ref: 'creative-1' }));
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.store.upsertSnapshot({ game_id: 'g2', seq: 1, home_team: 'Tigers' });
    h.dispatcher.dispatch(programSlotFrame('slot-1', 'g1'));
    h.dispatcher.dispatch(programSlotFrame('slot-2', 'g2'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.querySelector('img.cdq-ad-creative')).not.toBeNull();
    const transitionsBefore = h.player.played.length;

    // Supersede with a bare (no-ad) state on a different slot.
    await h.dispatcher.dispatch(
      plannedState({ state_id: 'st-2', program_slot_id: 'slot-2', ad_slot_id: null }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Composite + overlay gone behaviourally; the new bare content mounted.
    expect(sel(h.host, OVERLAY_TESTID.overlay)).toBeNull();
    expect(h.host.querySelector('img.cdq-ad-creative')).toBeNull();
    expect(sel(h.host, TESTID.homeTeam)?.textContent).toContain('Tigers');
    // The outgoing transition ran (a new transition was played on supersede).
    expect(h.player.played.length).toBeGreaterThan(transitionsBefore);
    // ad_slot_completed was journaled for the superseded overlay.
    const completed = h.journal.typesOf('ad_slot_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ad_slot_id: 'ad-1', ad_ref: 'creative-1', state_id: 'st-1' });
  });
});

describe('single-game-overlay-ad.css — coexistence (AC2/AC7, D-GRH-15/16)', () => {
  // Suite runs under jsdom where import.meta.url is not a file URL; resolve from
  // the package root (vitest cwd) exactly as the safe-info CSS test does.
  const cssPath = resolve(process.cwd(), 'src/templates/with-ads/single-game-overlay-ad.css');
  const code = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('positions the ad overlay absolutely above content with pointer-events: none', () => {
    // The overlay floats above the full-surface content and never intercepts
    // pointer input or re-flows the score render.
    expect(code).toMatch(/\.cdq-ad-overlay[\s\S]*?position\s*:\s*absolute/);
    expect(code).toMatch(/\.cdq-ad-overlay[\s\S]*?pointer-events\s*:\s*none/);
  });

  it('lets the content fill the full surface (inset: 0)', () => {
    expect(code).toMatch(/\.cdq-content[\s\S]*?inset\s*:\s*0/);
  });

  it('styles the actual merged composite class as well as the spec-named alias', () => {
    // The merged SPEC-CRWDQ-023 composite renders .crowdaq-single-game-composite;
    // the spec names .crowdaq-single-game-overlay-ad. The sheet covers both.
    expect(code).toMatch(/\.crowdaq-single-game-composite\b/);
    expect(code).toMatch(/\.crowdaq-single-game-overlay-ad\b/);
  });
});
