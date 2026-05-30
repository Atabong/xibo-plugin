/**
 * SPEC-CRWDQ-064 — Widget v2 AssetManifestStore.
 *
 * The player-side cache of all asset blobs delivered via the `AssetManifest`
 * control-channel frame (D-GRH-23): theme stylesheets, fonts, badges, team
 * logos, animation-definition files (D-GRH-31), ad creatives (D-GRH-55).
 *
 * Responsibilities (deep module — one owned surface replacing the informal
 * cache lookups scattered across SPEC-CRWDQ-034/-041/-053):
 *  - hash-keyed cache, lazy fetch on `ensure()`, eager pre-fetch on manifest
 *    receipt with an in-flight cap,
 *  - in-flight de-duplication, version-bump invalidation + stale flagging,
 *  - SHA-256 content-hash verification of every fetched asset,
 *  - eviction by LRU + version-staleness (see {@link AssetEvictionPolicy}),
 *  - persistence to an injected {@link AssetCache} for cross-restart survival.
 */
import { sha256Hex } from './hash';
import { AssetFetchError } from './AssetTypes';
import { LruStaleEvictionPolicy } from './AssetEvictionPolicy';
import type { AssetCache, AssetCacheRow } from './AssetCache';
import type { AssetFetcher } from './AssetFetcher';
import type { AssetEvictionPolicy, EvictionCandidate } from './AssetEvictionPolicy';
import type {
  AssetEntry,
  AssetManifestFrame,
  AssetManifestPayload,
  CachedAsset,
} from './AssetTypes';
import type { Dispatcher } from '../transport/types';

// Re-export the surface consumers import from this owned module.
export type {
  Envelope,
  AssetManifestFrame,
  AssetManifestPayload,
  AssetEntry,
  CachedAsset,
} from './AssetTypes';
export { AssetFetchError } from './AssetTypes';
export type { AssetCache, AssetCacheRow } from './AssetCache';
export type { AssetFetcher } from './AssetFetcher';
export type { AssetEvictionPolicy, EvictionCandidate } from './AssetEvictionPolicy';
export { LruStaleEvictionPolicy } from './AssetEvictionPolicy';

/** Minimal journal sink for this module's D-GRH-29 events. */
export interface ManifestJournal {
  record(entry: ManifestJournalEntry): void;
}

export interface ManifestJournalEntry {
  type: ManifestJournalEventType;
  [key: string]: unknown;
}

export type ManifestJournalEventType =
  | 'asset_manifest_applied'
  | 'asset_manifest_unchanged'
  | 'asset_cache_evicted'
  | 'asset_content_hash_mismatch'
  | 'asset_cache_persistence_unavailable';

export interface AssetManifestStoreDeps {
  cache: AssetCache;
  fetcher: AssetFetcher;
  journal: ManifestJournal;
  evictionPolicy?: AssetEvictionPolicy;
  /** Cache budget in bytes (default 200 MB). */
  maxBytes?: number;
  /** Max concurrent eager pre-fetches (default 4). */
  prefetchConcurrency?: number;
  /**
   * True if cross-restart persistence is available. When false the store still
   * serves in-memory (hot map) and journals `asset_cache_persistence_unavailable`
   * at construction (boot).
   */
  persistenceAvailable?: boolean;
}

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_PREFETCH_CONCURRENCY = 4;

/** Internal applied-manifest state. */
interface AppliedEntry {
  entry: AssetEntry;
  isStaleVersion: boolean;
}

export class AssetManifestStore {
  private readonly cache: AssetCache;
  private readonly fetcher: AssetFetcher;
  private readonly journal: ManifestJournal;
  private readonly evictionPolicy: AssetEvictionPolicy;
  private readonly maxBytes: number;
  private readonly prefetchConcurrency: number;
  private readonly persistenceAvailable: boolean;

  private currentVersion: string | null = null;
  /** asset_id -> applied entry for the current manifest. */
  private readonly applied = new Map<string, AppliedEntry>();
  /** Entries flagged stale by a version bump, kept for eviction-first ordering. */
  private readonly stale = new Map<string, AssetEntry>();
  /** Synchronous hot map: bytes for warmed assets, keyed by asset_id. */
  private readonly hot = new Map<string, CachedAsset>();
  /** In-flight ensure() de-dup, keyed by asset_id. */
  private readonly inFlight = new Map<string, Promise<CachedAsset>>();
  private readonly listeners = new Set<(version: string) => void>();

  constructor(deps: AssetManifestStoreDeps) {
    this.cache = deps.cache;
    this.fetcher = deps.fetcher;
    this.journal = deps.journal;
    this.evictionPolicy = deps.evictionPolicy ?? new LruStaleEvictionPolicy();
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    this.prefetchConcurrency = deps.prefetchConcurrency ?? DEFAULT_PREFETCH_CONCURRENCY;
    this.persistenceAvailable = deps.persistenceAvailable ?? true;

    if (!this.persistenceAvailable) {
      this.journal.record({ type: 'asset_cache_persistence_unavailable' });
    }
  }

  /** Register `apply()` as the dispatcher's `AssetManifest` control handler. */
  registerWith(dispatcher: Dispatcher): void {
    dispatcher.register(
      'AssetManifest',
      (frame) => this.apply(frame as unknown as AssetManifestFrame),
      'control',
    );
  }

  /**
   * Apply a freshly received manifest. Idempotent on identical
   * (version, entry-set). On change, diffs the prior set, flags stale entries,
   * promotes the new set, schedules eager pre-fetch, and fires listeners.
   */
  apply(frame: AssetManifestFrame): void {
    const { version, assets } = frame.payload;

    if (this.isUnchanged(version, assets)) {
      this.journal.record({ type: 'asset_manifest_unchanged', version });
      return;
    }

    const diff = this.diff(assets);

    // Mark removed/changed prior entries stale (kept readable until evicted).
    for (const prior of diff.staled) {
      this.stale.set(this.staleKey(prior.asset_id, prior.content_hash), prior);
    }

    // Promote the new applied set.
    this.applied.clear();
    for (const entry of assets) {
      this.applied.set(entry.asset_id, { entry, isStaleVersion: false });
    }
    // A changed/removed asset_id no longer has fresh bytes in the hot map.
    for (const prior of diff.staled) {
      const stillFresh = this.applied.get(prior.asset_id);
      if (!stillFresh || stillFresh.entry.content_hash !== prior.content_hash) {
        this.hot.delete(prior.asset_id);
      }
    }
    this.currentVersion = version;

    // Warm the synchronous hot map from persistence so a post-restart get()
    // on a previously cached asset hits without a fetch (AC9). Bytes are read
    // lazily here, keyed by (asset_id, content_hash) — bumped/removed entries
    // miss naturally because their hash no longer matches the applied entry.
    void this.hydrateHotMap(assets);

    // Eager pre-fetch of new/changed entries with a non-null needed_by.
    void this.schedulePrefetch(diff.prefetch);

    this.journal.record({
      type: 'asset_manifest_applied',
      version,
      added: diff.added,
      changed: diff.changed,
      removed: diff.removed,
      total: assets.length,
    });

    for (const listener of this.listeners) {
      listener(version);
    }
  }

  /** Synchronous cache read from the hot map. Never initiates a fetch. */
  get(assetId: string): CachedAsset | null {
    const applied = this.applied.get(assetId);
    if (!applied || applied.isStaleVersion) return null;
    const hot = this.hot.get(assetId);
    if (!hot) return null;
    if (hot.content_hash !== applied.entry.content_hash) return null;
    return hot;
  }

  /**
   * Fetch-on-demand against the applied manifest entry, de-duplicating
   * concurrent callers for the same id. Rejects with {@link AssetFetchError}
   * if the id is not in the applied manifest.
   */
  ensure(assetId: string): Promise<CachedAsset> {
    const applied = this.applied.get(assetId);
    if (!applied) {
      const entry: AssetEntry = {
        asset_id: assetId,
        content_hash: '',
        url: '',
        content_type: '',
        version: this.currentVersion ?? '',
        needed_by: null,
      };
      return Promise.reject(new AssetFetchError(entry, new Error('not in applied manifest')));
    }

    const existing = this.inFlight.get(assetId);
    if (existing) return existing;

    // A stale-flagged entry (post-invalidate) re-fetches against its still-
    // applied manifest entry and clears the flag on success (AC11). A fresh
    // entry resolves from cache (hot map or persistence) before fetching (AC6).
    const promise = this.resolveOrFetch(applied)
      .then((asset) => {
        applied.isStaleVersion = false;
        return asset;
      })
      .finally(() => {
        this.inFlight.delete(assetId);
      });
    this.inFlight.set(assetId, promise);
    return promise;
  }

  /**
   * Populate the hot map from persistence for the applied entries, so a fresh
   * store over a seeded cache serves get() without a fetch (AC9). Cache misses
   * (and persistence-read failures) are silent — get() simply returns null and
   * ensure() will fetch.
   */
  private async hydrateHotMap(assets: readonly AssetEntry[]): Promise<void> {
    await Promise.all(
      assets.map(async (entry) => {
        if (this.hot.has(entry.asset_id)) return;
        try {
          const persisted = await this.cache.read(entry.asset_id, entry.content_hash);
          // Guard against a racing version bump invalidating this id meanwhile.
          const applied = this.applied.get(entry.asset_id);
          if (persisted && applied && applied.entry.content_hash === entry.content_hash) {
            this.hot.set(entry.asset_id, persisted);
          }
        } catch {
          // Persistence unavailable — leave the hot map cold for this id.
        }
      }),
    );
  }

  /** Resolve from the hot map or persistent cache; fetch on a miss. */
  private async resolveOrFetch(applied: AppliedEntry): Promise<CachedAsset> {
    const { entry } = applied;
    if (!applied.isStaleVersion) {
      const hot = this.hot.get(entry.asset_id);
      if (hot && hot.content_hash === entry.content_hash) return hot;

      const persisted = await this.cache.read(entry.asset_id, entry.content_hash);
      if (persisted) {
        this.hot.set(entry.asset_id, persisted);
        return persisted;
      }
    }
    return this.fetchVerifyCache(entry);
  }

  /**
   * Invalidate by version: any applied entry whose version != `version` is
   * flagged stale, so subsequent `get()` returns null until `ensure()`
   * re-fetches against the (presumably newer) manifest entry.
   */
  invalidate(version: string): void {
    for (const [assetId, applied] of this.applied) {
      if (applied.entry.version !== version) {
        applied.isStaleVersion = true;
        this.stale.set(
          this.staleKey(applied.entry.asset_id, applied.entry.content_hash),
          applied.entry,
        );
        this.hot.delete(assetId);
      }
    }
  }

  /** Subscribe to manifest-apply events. Returns an unsubscribe fn. */
  subscribeManifest(listener: (version: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- internals -------------------------------------------------------------

  private async fetchVerifyCache(entry: AssetEntry): Promise<CachedAsset> {
    let asset: CachedAsset;
    try {
      asset = await this.fetcher.fetch(entry);
    } catch (err) {
      throw new AssetFetchError(entry, err);
    }

    const observed = `sha256:${await sha256Hex(asset.bytes)}`;
    if (observed !== entry.content_hash) {
      this.journal.record({
        type: 'asset_content_hash_mismatch',
        asset_id: entry.asset_id,
        expected: entry.content_hash,
        observed,
      });
      throw new AssetFetchError(entry, new Error('content hash mismatch'));
    }

    // Persist (best effort — degraded mode swallows the write failure).
    try {
      await this.cache.write(asset);
    } catch {
      // Persistence unavailable: serve from the hot map only this session.
    }

    this.hot.set(entry.asset_id, asset);
    return asset;
  }

  private isUnchanged(version: string, assets: readonly AssetEntry[]): boolean {
    if (this.currentVersion !== version) return false;
    if (this.applied.size !== assets.length) return false;
    for (const entry of assets) {
      const prior = this.applied.get(entry.asset_id);
      if (!prior || prior.entry.content_hash !== entry.content_hash) return false;
    }
    return true;
  }

  private diff(assets: readonly AssetEntry[]): {
    added: number;
    changed: number;
    removed: number;
    /** Prior entries (removed or hash-changed) to flag stale. */
    staled: AssetEntry[];
    /** New/changed entries with a non-null needed_by, to eager pre-fetch. */
    prefetch: AssetEntry[];
  } {
    const next = new Map(assets.map((e) => [e.asset_id, e] as const));
    let added = 0;
    let changed = 0;
    let removed = 0;
    const staled: AssetEntry[] = [];
    const prefetch: AssetEntry[] = [];

    for (const entry of assets) {
      const prior = this.applied.get(entry.asset_id);
      if (!prior) {
        added += 1;
        if (entry.needed_by !== null) prefetch.push(entry);
      } else if (prior.entry.content_hash !== entry.content_hash) {
        changed += 1;
        staled.push(prior.entry);
        if (entry.needed_by !== null) prefetch.push(entry);
      }
    }
    for (const [assetId, prior] of this.applied) {
      if (!next.has(assetId)) {
        removed += 1;
        staled.push(prior.entry);
      }
    }
    return { added, changed, removed, staled, prefetch };
  }

  /**
   * Eager pre-fetch with an in-flight cap. Ordering: `needed_by` ascending,
   * then `asset_id` lexicographic for determinism.
   */
  private async schedulePrefetch(entries: AssetEntry[]): Promise<void> {
    const ordered = [...entries].sort((a, b) => {
      const an = a.needed_by ?? '';
      const bn = b.needed_by ?? '';
      if (an !== bn) return an < bn ? -1 : 1;
      return a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0;
    });

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ordered.length) {
        const entry = ordered[cursor++];
        if (!entry) return;
        try {
          await this.ensure(entry.asset_id);
        } catch {
          // Pre-fetch failures are non-fatal; ensure() journals as needed.
        }
      }
    };

    const lanes = Math.min(this.prefetchConcurrency, ordered.length);
    await Promise.all(Array.from({ length: lanes }, () => worker()));
  }

  private staleKey(assetId: string, contentHash: string): string {
    return `${assetId} ${contentHash}`;
  }
}
