/**
 * SPEC-CRWDQ-064 — persistent asset cache surface.
 *
 * IndexedDB-backed in production (`crowdaq-assets` DB, `assets` store keyed by
 * `[asset_id, content_hash]`); in-memory in unit tests. Keying by
 * `(asset_id, content_hash)` lets a version bump that re-hashes an asset leave
 * the prior version retrievable until eviction — so a template that has not yet
 * seen the new manifest keeps rendering the old asset.
 */
import type { CachedAsset } from './AssetTypes';

/** A persisted cache row's metadata (bytes excluded — read lazily). */
export interface AssetCacheRow {
  asset_id: string;
  content_hash: string;
  sizeBytes: number;
  lastAccessAt: Date;
}

export interface AssetCache {
  read(assetId: string, contentHash: string): Promise<CachedAsset | null>;
  write(asset: CachedAsset): Promise<void>;
  delete(assetId: string, contentHash: string): Promise<void>;
  /** All rows; used by the eviction policy and boot warmup. */
  enumerate(): Promise<readonly AssetCacheRow[]>;
}
