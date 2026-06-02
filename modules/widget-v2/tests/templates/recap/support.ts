/**
 * SPEC-CRWDQ-046 (part 1) — shared test doubles for the recap template.
 *
 * Only genuine system boundaries are substituted (INV-FACTORY-17): the
 * SPEC-CRWDQ-064 `AssetFetcher` is the substitutable network boundary the real
 * `AssetManifestStore` is driven through. The `FixtureListStore`,
 * `AssetManifestStore`, `GameStateStore`, and journal used in tests are REAL
 * shared instances (INV-FACTORY-16) — no mocks of the orchestration.
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
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameState, ProgramSlotPayload } from '../../../src/render/types';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { Fixture, FixtureListFrameTyped } from '../../../src/templates/fixtures/types';
import type {
  HeadlineMoment,
  RecapContext,
} from '../../../src/templates/recap/RecapTemplate';

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

/** Apply a manifest that declares `assetIds` as (empty-byte) assets. */
export function applyBadgeManifest(store: AssetManifestStore, assetIds: string[]): void {
  const assets: AssetEntry[] = assetIds.map((id) => ({
    asset_id: id,
    content_hash: EMPTY_SHA256,
    url: `https://cdn.example/${id}.png`,
    content_type: 'image/png',
    version: 'v1',
    needed_by: null,
  }));
  store.apply({ message_type: 'AssetManifest', payload: { version: 'v1', assets } } as AssetManifestFrame);
}

/**
 * Warm an asset into the synchronous hot map so a later `get(assetId)` hits
 * without an async fetch — mirrors a badge already pre-fetched by the time the
 * recap mounts. The id must already be in the applied manifest.
 */
export async function warmAsset(store: AssetManifestStore, assetId: string): Promise<void> {
  await store.ensure(assetId);
}

/** A complete fixture with sensible defaults. */
export const fixture = (eventId: string, over: Partial<Fixture> = {}): Fixture => ({
  eventId,
  sport: 'football',
  leagueId: 39,
  leagueName: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoffUtc: '2026-06-02T00:30:00Z',
  feedStatus: 'final',
  ...over,
});

/** A FixtureList frame carrying `fixtures`. */
export const fixtureFrame = (fixtures: Fixture[]): FixtureListFrameTyped =>
  ({ message_type: 'FixtureList', payload: { fixtures } }) as FixtureListFrameTyped;

/** A final-state GameState snapshot with sensible defaults. */
export const finalGame = (gameId: string, over: Partial<GameState> = {}): GameState => ({
  game_id: gameId,
  seq: 10,
  status: 'final',
  home_score: 3,
  away_score: 1,
  sport_context: { sport: 'football', league: 'Premier League' },
  ...over,
});

/** The recap's freshly minted ProgramSlot (D-GRH-21 / SPEC-CRWDQ-045 buildRecap). */
export const recapSlot = (gameId: string | null, over: Partial<ProgramSlotPayload> = {}): ProgramSlotPayload => ({
  program_slot_id: 'recap-slot-1',
  primary_game_id: gameId,
  game_ids: gameId === null ? [] : [gameId],
  fixture_ids: [],
  ...over,
});

const DEFAULT_THEME: ResolvedTheme = { state: 'default' };

export interface RecapHarness {
  host: HTMLElement;
  ctx: RecapContext;
  journal: RecordingJournal;
  gameStateStore: GameStateStore;
  fixtureListStore: FixtureListStore;
  assetStore: AssetManifestStore;
}

/**
 * Build a recap harness: a fresh host, real stores, and a `RecapContext`. The
 * caller seeds the GameStateStore / FixtureListStore / AssetManifestStore as the
 * scenario needs before calling `template.mount(host, ctx)`.
 */
export function makeRecapHarness(opts: {
  slot?: ProgramSlotPayload;
  headlineMoment?: HeadlineMoment | null;
  theme?: ResolvedTheme;
  badgeAssetIds?: string[];
} = {}): RecapHarness {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const gameStateStore = new GameStateStore(journal);
  const fixtureListStore = new FixtureListStore();
  const assetStore = makeAssetStore();
  applyBadgeManifest(assetStore, opts.badgeAssetIds ?? []);

  const ctx: RecapContext = {
    programSlot: opts.slot ?? recapSlot('g1'),
    theme: opts.theme ?? DEFAULT_THEME,
    gameStateStore,
    fixtureListStore,
    assetManifestStore: assetStore,
    headlineMoment: opts.headlineMoment ?? null,
    pendingApply: null,
    journal,
  };

  return { host, ctx, journal, gameStateStore, fixtureListStore, assetStore };
}
