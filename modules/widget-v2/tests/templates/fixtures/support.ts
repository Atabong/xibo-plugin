/**
 * Shared test doubles for the fixtures template family. Only genuine system
 * boundaries are substituted (INV-FACTORY-17): the card-animation playback seam
 * (reused from multi-game) records what it played and resolves immediately, and
 * the SPEC-CRWDQ-064 `AssetFetcher` is the substitutable network boundary the
 * real `AssetManifestStore` is driven through. The `FixtureListStore`,
 * `AssetManifestStore`, and journal used in tests are the REAL shared instances.
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
import type { CardTransitions } from '../../../src/templates/multi-game/CardSet';
import type { Fixture, FixtureListFrameTyped } from '../../../src/templates/fixtures/types';

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

/** A recorded card animation: which card (event id) ran which named animation. */
export interface RecordedCardAnimation {
  eventId: string;
  animationId: string;
  phase: 'enter' | 'exit';
}

/** Records every card enter/exit animation; resolves immediately. */
export class RecordingCardTransitions implements CardTransitions {
  readonly played: RecordedCardAnimation[] = [];
  async enter(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ eventId: card.dataset['eventId'] ?? '', animationId, phase: 'enter' });
  }
  async exit(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ eventId: card.dataset['eventId'] ?? '', animationId, phase: 'exit' });
  }
  phasesFor(eventId: string): Array<'enter' | 'exit'> {
    return this.played.filter((p) => p.eventId === eventId).map((p) => p.phase);
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
 * A substitutable AssetFetcher that returns a tiny asset for any requested
 * entry, with the content_hash the entry declares (so the store's hash check
 * passes). Records which asset_ids were fetched.
 */
export class StubAssetFetcher implements AssetFetcher {
  readonly fetched: string[] = [];
  async fetch(entry: AssetEntry): Promise<CachedAsset> {
    this.fetched.push(entry.asset_id);
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
export const EMPTY_SHA256 =
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** In-memory manifest journal (a real sink) for the AssetManifestStore. */
class ManifestRecorder implements ManifestJournal {
  readonly entries: ManifestJournalEntry[] = [];
  record(entry: ManifestJournalEntry): void {
    this.entries.push(entry);
  }
}

/** Build a real AssetManifestStore wired to in-memory boundaries. */
export function makeAssetStore(): {
  store: AssetManifestStore;
  fetcher: StubAssetFetcher;
} {
  const fetcher = new StubAssetFetcher();
  const store = new AssetManifestStore({
    cache: new MemoryAssetCache(),
    fetcher,
    journal: new ManifestRecorder(),
    persistenceAvailable: true,
  });
  return { store, fetcher };
}

/** Apply a manifest that declares `assetIds` (empty-byte assets). */
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

/** A complete fixture with sensible defaults. */
export const fixture = (eventId: string, over: Partial<Fixture> = {}): Fixture => ({
  eventId,
  sport: 'football',
  leagueId: 39,
  leagueName: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoffUtc: '2026-06-02T00:30:00Z',
  feedStatus: 'scheduled',
  ...over,
});

/** A FixtureList frame carrying `fixtures`. */
export const fixtureFrame = (fixtures: Fixture[]): FixtureListFrameTyped =>
  ({ message_type: 'FixtureList', payload: { fixtures } }) as FixtureListFrameTyped;
