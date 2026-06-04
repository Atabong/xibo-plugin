/**
 * SPEC-CRWDQ-053 — shared test doubles for the ambient template family.
 *
 * Only genuine system boundaries are substituted (INV-FACTORY-17): the
 * SPEC-CRWDQ-064 `AssetFetcher` is the network boundary the REAL
 * `AssetManifestStore` is driven through, and the clock is vitest fake timers
 * (bound per test, not here). The `AssetManifestStore`, the `SafeInfoTemplate`,
 * the `PlannedStateActivator`, and the journal used here are the real shared
 * instances (INV-FACTORY-16 — no internal mocks).
 */
import {
  AssetManifestStore,
  type AssetCache,
  type AssetCacheRow,
  type AssetFetcher,
  type AssetEntry,
  type CachedAsset,
  type AssetManifestFrame,
  type ManifestJournal,
  type ManifestJournalEntry,
} from '../../../src/render/AssetManifestStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
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
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type {
  BarPreferencesWire,
  PlannedStateFrame,
  ProgramSlotFrame,
  ThemeChoiceWire,
} from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';

/** An in-memory render journal recorder (a real sink, not a mock). */
export class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

/** A no-op in-memory AssetCache (persistence boundary). */
class MemoryAssetCache implements AssetCache {
  private readonly rows = new Map<string, CachedAsset>();
  async read(assetId: string, contentHash: string): Promise<CachedAsset | null> {
    return this.rows.get(`${assetId} ${contentHash}`) ?? null;
  }
  async write(asset: CachedAsset): Promise<void> {
    this.rows.set(`${asset.asset_id} ${asset.content_hash}`, asset);
  }
  async delete(assetId: string, contentHash: string): Promise<void> {
    this.rows.delete(`${assetId} ${contentHash}`);
  }
  async enumerate(): Promise<AssetCacheRow[]> {
    return [];
  }
}

/**
 * A substitutable AssetFetcher returning a tiny asset for any requested entry,
 * with the content_hash the entry declares (so the store's hash check passes).
 */
class StubAssetFetcher implements AssetFetcher {
  async fetch(entry: AssetEntry): Promise<CachedAsset> {
    return {
      asset_id: entry.asset_id,
      content_hash: entry.content_hash,
      url: `blob:${entry.asset_id}`,
      content_type: entry.content_type || 'image/png',
      bytes: new ArrayBuffer(0),
    };
  }
}

/** content_hash of an empty ArrayBuffer (sha256 of zero bytes). */
const EMPTY_SHA256 = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** In-memory manifest journal (a real sink). */
class ManifestRecorder implements ManifestJournal {
  record(_entry: ManifestJournalEntry): void {}
}

/** Build a real AssetManifestStore wired to in-memory boundaries. */
export function makeAssetStore(): AssetManifestStore {
  return new AssetManifestStore({
    cache: new MemoryAssetCache(),
    fetcher: new StubAssetFetcher(),
    journal: new ManifestRecorder(),
    persistenceAvailable: true,
  });
}

/** One asset descriptor for a manifest, with an `image/png` default. */
export interface AssetSpec {
  asset_id: string;
  content_type?: string;
  url?: string;
}

/**
 * Apply a manifest declaring `specs` as (empty-byte) assets. The url defaults
 * to a stable cdn-style address derived from the asset id so a test can assert
 * which creative an `<img src>` reflects.
 */
export function applyManifest(store: AssetManifestStore, specs: AssetSpec[], version = 'v1'): void {
  const assets: AssetEntry[] = specs.map((s) => ({
    asset_id: s.asset_id,
    content_hash: EMPTY_SHA256,
    url: s.url ?? `https://cdn.example/${s.asset_id}.png`,
    content_type: s.content_type ?? 'image/png',
    version,
    needed_by: null,
  }));
  store.apply({
    message_type: 'AssetManifest',
    payload: { version, assets },
  } as AssetManifestFrame);
}

/** Shorthand for an image-category ambient asset spec. */
export const image = (assetId: string, url?: string): AssetSpec => ({
  asset_id: assetId,
  content_type: 'image/png',
  ...(url === undefined ? {} : { url }),
});

/** Shorthand for a video-category ambient asset spec. */
export const video = (assetId: string, url?: string): AssetSpec => ({
  asset_id: assetId,
  content_type: 'video/mp4',
  ...(url === undefined ? {} : { url }),
});

// --------------------------------------------------------------------------
// Shared end-to-end harness (used by both #58 part-1 and #59 part-2 integration
// suites). Everything orchestration is the REAL shared instance (INV-FACTORY-16):
// the PlannedStateActivator, ProgramSlotResolver, DwellTimer, TransitionExecutor,
// AssetManifestStore, AmbientPlaylist, and the SPEC-CRWDQ-052 SafeInfoTemplate.
// Only the genuine boundaries are substituted (INV-FACTORY-17): the clock (fake
// timers, bound per test) and the animation player.
// --------------------------------------------------------------------------

/** A recording animation player (the substitutable transition boundary). */
export class RecordingPlayer implements TransitionPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(definition: TransitionDefinition): Promise<void> {
    this.played.push(definition);
  }
}

/** A recording stylesheet registry (a real sink, asserts theme application). */
export class RecordingStyleSheets implements StyleSheetRegistry {
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

/** Bar preferences carrying a theme choice (drives the dwell-boundary swap). */
export const prefsWithTheme = (theme: ThemeChoiceWire): BarPreferencesWire => ({
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

/** A `PlannedState{ambient}` frame; override any field for a specific case. */
export const ambientState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
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

/** The empty `ProgramSlot` ambient references (real slot, no games — D-GRH-27). */
export const ambientSlot = (over: Partial<Record<string, unknown>> = {}): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'ambient-slot',
    primary_game_id: null,
    game_ids: [],
    ...over,
  }) as unknown as ProgramSlotFrame;

export interface AmbientHarness {
  host: HTMLElement;
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  journal: RecordingJournal;
  player: RecordingPlayer;
  styleSheets: RecordingStyleSheets;
  assetStore: AssetManifestStore;
}

/**
 * Wire the ambient adapter into a real shared `PlannedStateActivator` exactly as
 * production would, returning the host + the live frame dispatcher to drive it.
 */
export function makeAmbientHarness(
  opts: { barPending?: BarPreferencesWire | null; barTheme?: ThemeChoiceWire | null } = {},
): AmbientHarness {
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

/** The mounted ambient `<section>`, or null when the fallback (or nothing) ran. */
export const ambientSection = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-ambient');

/** The safe-info `<section>` the empty-manifest fallback mounts (AC3). */
export const safeSection = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-safe-info');

/** The active rotation `<img>` inside the ambient stage. */
export const ambientImg = (host: ParentNode): HTMLImageElement =>
  host.querySelector<HTMLImageElement>('img.cdq-ambient-creative')!;

/** The hrefs of the live `<link rel="preload" as="image">` window. */
export const ambientPreloadHrefs = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')).map(
    (l) => l.getAttribute('href') ?? '',
  );
