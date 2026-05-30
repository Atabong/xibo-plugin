/**
 * SPEC-CRWDQ-064 — HTTP fetch boundary.
 *
 * Fetches an asset's bytes for a manifest entry. The store (not the fetcher)
 * verifies the SHA-256 content hash, so hash verification stays testable
 * independently of the network. R2 URLs are publicly readable in phase 1
 * (D-GRH-74); no custom credential handling here.
 */
import type { AssetEntry, CachedAsset } from './AssetTypes';

export interface AssetFetcher {
  fetch(entry: AssetEntry): Promise<CachedAsset>;
}
