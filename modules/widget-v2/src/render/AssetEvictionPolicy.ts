/**
 * SPEC-CRWDQ-064 — eviction policy.
 *
 * Decides which assets to evict when the cache exceeds budget. Stale-version
 * entries evict first; among same-version entries, LRU by `lastAccessAt`.
 * Eviction continues until total size ≤ 90% of `maxBytes` (10% headroom).
 */

/** Snapshot row the eviction policy reasons over. */
export interface EvictionCandidate {
  asset_id: string;
  content_hash: string;
  sizeBytes: number;
  lastAccessAt: Date;
  isStaleVersion: boolean;
}

export interface AssetEvictionPolicy {
  decide(
    snapshot: readonly EvictionCandidate[],
    maxBytes: number,
  ): readonly { asset_id: string; content_hash: string }[];
}

/**
 * Default policy: stale-version entries first, then LRU by `lastAccessAt`.
 * Evicts until total size ≤ 90% of `maxBytes`.
 */
export class LruStaleEvictionPolicy implements AssetEvictionPolicy {
  decide(
    snapshot: readonly EvictionCandidate[],
    maxBytes: number,
  ): readonly { asset_id: string; content_hash: string }[] {
    const total = snapshot.reduce((sum, r) => sum + r.sizeBytes, 0);
    const hasStale = snapshot.some((r) => r.isStaleVersion);
    if (total <= maxBytes && !hasStale) return [];

    const ordered = [...snapshot].sort((a, b) => {
      if (a.isStaleVersion !== b.isStaleVersion) return a.isStaleVersion ? -1 : 1;
      return a.lastAccessAt.getTime() - b.lastAccessAt.getTime();
    });

    const target = maxBytes * 0.9;
    const evicted: { asset_id: string; content_hash: string }[] = [];
    let remaining = total;
    for (const row of ordered) {
      const overBudget = remaining > target;
      if (!overBudget && !row.isStaleVersion) break;
      evicted.push({ asset_id: row.asset_id, content_hash: row.content_hash });
      remaining -= row.sizeBytes;
    }
    return evicted;
  }
}
