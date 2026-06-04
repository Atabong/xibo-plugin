/**
 * Shared test doubles for the safe_info template family (SPEC-CRWDQ-052).
 *
 * Only genuine system boundaries are substituted (INV-FACTORY-17): the
 * SPEC-CRWDQ-064 `AssetFetcher` is the network boundary the REAL
 * `AssetManifestStore` is driven through, the WS lifecycle is a tiny event
 * driver, and the clock is vitest fake timers (bound per test, not here). The
 * `AssetManifestStore` and the journal used here are the real shared instances
 * (INV-FACTORY-16 — no internal mocks).
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
 * A substitutable AssetFetcher that returns a tiny asset for any requested
 * entry with the content_hash the entry declares (so the store's hash check
 * passes). Records which asset_ids were fetched — the safe template must
 * NEVER drive a fetch (offline-safe AC), so tests assert this stays empty.
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
export function makeAssetStore(): { store: AssetManifestStore; fetcher: StubAssetFetcher } {
  const fetcher = new StubAssetFetcher();
  const store = new AssetManifestStore({
    cache: new MemoryAssetCache(),
    fetcher,
    journal: new ManifestRecorder(),
    persistenceAvailable: true,
  });
  return { store, fetcher };
}

/**
 * Apply a manifest declaring a single venue-brand asset, then warm the hot map
 * synchronously so `store.get(assetId)` resolves WITHOUT a fetch — exactly the
 * post-restart warm-cache case the safe template reads (offline-safe AC). The
 * fetcher records nothing because `ensure()` resolves from the seeded cache.
 */
export async function seedVenueBrand(
  store: AssetManifestStore,
  assetId: string,
): Promise<void> {
  const assets: AssetEntry[] = [
    {
      asset_id: assetId,
      content_hash: EMPTY_SHA256,
      url: `https://cdn.example/${assetId}.png`,
      content_type: 'image/png',
      version: 'v1',
      needed_by: null,
    },
  ];
  store.apply({
    message_type: 'AssetManifest',
    payload: { version: 'v1', assets },
  } as AssetManifestFrame);
  // ensure() warms the hot map from the (fetcher-backed) source once; after
  // this a synchronous get() hits without any further fetch.
  await store.ensure(assetId);
}
