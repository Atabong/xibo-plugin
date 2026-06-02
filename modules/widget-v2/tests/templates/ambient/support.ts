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
