---
spec_id: SPEC-CRWDQ-064
title: Widget v2 AssetManifestStore
status: impl-ready
owner: player-runtime/widget-v2/asset-manifest
depends_on: [SPEC-CRWDQ-022]
generated_by: grill-amendment
generated_at: 2026-05-15
---

# SPEC-CRWDQ-064 — Widget v2 AssetManifestStore

## Metadata

| Field | Value |
|-------|-------|
| Parent slice | S2 — Bar onboarding (introduced with ConfigPush + AssetManifest) |
| Plane epic | CRWDQ-3 |
| Decisions referenced | D-GRH-23, D-GRH-31, D-GRH-55, D-GRH-74 |
| Source files | `modules/widget-v2/src/transport/Dispatcher.ts` (consumed) |
| New files | `modules/widget-v2/src/render/AssetManifestStore.ts`, `modules/widget-v2/src/render/AssetCache.ts`, `modules/widget-v2/src/render/AssetFetcher.ts`, `modules/widget-v2/src/render/AssetEvictionPolicy.ts`, `modules/widget-v2/tests/render/asset-manifest/*.test.ts` |

> **Backend authority note:** The `AssetManifest` wire frame consumed by
> this store is governed by the wire-protocol spec
> `crowdaq-backend/docs/specs/SPEC-CRWDQ-017` and delivered by
> `SPEC-CRWDQ-020` (GameDeliveryService re-push). SPEC-CRWDQ-020 ships an
> S3 *stub* `AssetManifest` payload (`{ "assets": [] }`); the full manifest
> with real entries arrives in S6+. The frame-shape claims below are
> cross-checked against those specs. The backend is the source of truth.

## Module

`player-runtime :: widget-v2 :: render/asset-manifest` — the player-side cache of all asset blobs delivered via `AssetManifest` (D-GRH-23): theme stylesheets, font files, sport/league badges, team logos, animation definition files (D-GRH-31), ad creatives (D-GRH-55). Hash-keyed cache, lazy fetch on `ensure()`, eager pre-fetch on manifest receipt, in-flight de-duplication, version-bump invalidation, eviction by LRU + version-staleness, persistence to IndexedDB for cross-restart survival.

This spec consolidates the `AssetManifestStore` interface that several other specs declare as a consumed surface (SPEC-CRWDQ-034, 041, 046, 052, 053, 063, 065, 066). Those specs reference the type without owning its full lifecycle. This spec owns it.

## Current shape

- v1 had no asset cache. The legacy widget loaded team logos by URL on every render — no caching layer, no version awareness, no offline tolerance.
- D-GRH-23 establishes `AssetManifest` as a control-channel message carrying the full asset set for a `theme_id` + bar configuration. It is a SPEC-CRWDQ-017 `Envelope<AssetManifestPayload>`; the payload carries a `version` and an `assets` list (SPEC-CRWDQ-020's S3 stub payload is `{ "assets": [] }` — the list key is `assets`). Each entry in `assets` has the shape (per D-GRH-23, D-GRH-31, D-GRH-55):
  ```jsonl
  {
    "asset_id": "string",
    "content_hash": "sha256:...",
    "url": "https://...",                  // resolved per D-GRH-74 (R2 backend)
    "content_type": "image/png|font/woff2|text/css|application/json|video/mp4|...",
    "version": "string",                   // manifest-level version bump trigger
    "needed_by": "iso8601 | null"          // soft deadline for pre-fetch
  }
  ```
- D-GRH-74 establishes Cloudflare R2 as the backend. The URL in each asset entry is fully qualified — the store does not synthesize URLs.
- SPEC-CRWDQ-020 ships an S3 *stub* `AssetManifest` (`assets: []`); the full manifest with real entries arrives in S6+. This store handles an empty `assets` list gracefully — `get` returns `null`, `ensure` rejects "not in manifest" — so it is correct against the S3 stub and the S6+ full manifest alike.
- Without this store, SPEC-CRWDQ-034 (fixture badges), SPEC-CRWDQ-041 (ad creatives), and SPEC-CRWDQ-053 (ambient assets) each describe their own cache lookup informally. This spec replaces that informal scatter with one owned surface.

## Proposed deep interface

```ts
// modules/widget-v2/src/render/AssetManifestStore.ts
export interface AssetManifestStore {
  /**
   * Apply a freshly received AssetManifest frame. Diffs against the
   * current applied manifest by `version`; on bump, marks the prior
   * version's assets stale (kept until evicted) and the new assets
   * pending. Triggers eager pre-fetch of all entries with non-null
   * `needed_by` (background; no blocking).
   *
   * Idempotent on identical (version, asset set) input.
   */
  apply(manifest: AssetManifestFrame): void;

  /**
   * Synchronous cache read. Returns the cached asset if its bytes are
   * present and its content_hash matches the applied manifest entry;
   * null otherwise. No fetch is initiated by this call — use ensure()
   * for fetch-on-demand.
   */
  get(assetId: string): CachedAsset | null;

  /**
   * Fetch-on-demand. If get() would return non-null, resolves with
   * that. Otherwise initiates a fetch against the applied manifest's
   * entry for `assetId`, de-duplicating concurrent ensure() calls for
   * the same id. Rejects if `assetId` is not in the applied manifest.
   *
   * Retry: per-fetcher policy (default 3× exponential backoff). A final
   * failure rejects with AssetFetchError carrying the manifest entry.
   */
  ensure(assetId: string): Promise<CachedAsset>;

  /**
   * Invalidate by version. Any asset whose version != currentVersion
   * is marked for eviction; subsequent get() returns null for those
   * ids; ensure() re-fetches against the new manifest entry.
   *
   * Called automatically by apply() on version bump — exposed for
   * tests and explicit operator-driven invalidation.
   */
  invalidate(version: string): void;

  /**
   * Subscribe to manifest-apply events. Listener receives the new
   * version string. Used by render orchestration to trigger re-fetch
   * of currently-referenced assets after a version bump.
   */
  subscribeManifest(listener: (version: string) => void): () => void;

  /**
   * The full entry list of the currently applied manifest. Used by
   * consumers that must enumerate a family of assets rather than look
   * one up by exact id — e.g. SPEC-CRWDQ-053's AmbientPlaylist filters
   * every `ambient:`-prefixed entry. Returns a read-only snapshot;
   * callers must not mutate it.
   */
  manifestEntries(): readonly AssetManifestEntry[];
}

/**
 * The on-the-wire AssetManifest frame — a SPEC-CRWDQ-017
 * Envelope<AssetManifestPayload>. `schema_version`, `channel`,
 * `message_type`, `ts`, and `bar_id` are envelope-level; `version` and
 * the `assets` list are payload-level. The dispatcher hands the parsed
 * envelope to `apply()`, which reads `frame.payload`.
 */
export interface AssetManifestFrame {
  schema_version: number;                  // 1 in phase-1
  channel: 'control';                      // AssetManifest pins to the control channel
  message_type: 'AssetManifest';
  ts: string;                              // RFC 3339 UTC
  bar_id: string;
  payload: AssetManifestPayload;
}

export interface AssetManifestPayload {
  version: string;                         // manifest-level version bump trigger
  /** The asset set. Key is `assets` per SPEC-CRWDQ-020's stub payload
   *  `{ "assets": [] }`. Empty in the S3 stub; populated S6+. */
  assets: AssetManifestEntry[];
}

export interface AssetManifestEntry {
  asset_id: string;
  content_hash: string;                    // sha256:<hex>
  url: string;                             // fully qualified per D-GRH-74
  content_type: string;
  version: string;                         // === manifest version
  needed_by: string | null;                // ISO 8601 UTC
}

export interface CachedAsset {
  asset_id: string;
  content_hash: string;
  /** Object URL or data URL resolvable from <img src>, <link href>, etc. */
  url: string;
  content_type: string;
  /** Raw bytes for callers that need them (e.g., JSON animation defs). */
  bytes: ArrayBuffer;
}

export class AssetFetchError extends Error {
  constructor(public readonly entry: AssetManifestEntry, public readonly cause: unknown) {
    super(`AssetFetchError: ${entry.asset_id} (${entry.url})`);
  }
}
```

```ts
// modules/widget-v2/src/render/AssetCache.ts
/**
 * Persistent cache. IndexedDB-backed in production; in-memory in tests.
 * Keys by (asset_id, content_hash) so a version bump that re-hashes
 * an asset leaves the prior version retrievable until eviction.
 */
export interface AssetCache {
  read(assetId: string, contentHash: string): Promise<CachedAsset | null>;
  write(asset: CachedAsset): Promise<void>;
  delete(assetId: string, contentHash: string): Promise<void>;
  /** All entries; used by eviction policy and boot warmup. */
  enumerate(): Promise<readonly { asset_id: string; content_hash: string; sizeBytes: number; lastAccessAt: Date }[]>;
}
```

```ts
// modules/widget-v2/src/render/AssetFetcher.ts
/**
 * HTTP fetch with retry. Verifies fetched bytes against
 * AssetManifestEntry.content_hash; mismatch is a fetch error (not a
 * partial-write recoverable state).
 */
export interface AssetFetcher {
  fetch(entry: AssetManifestEntry): Promise<CachedAsset>;
}
```

```ts
// modules/widget-v2/src/render/AssetEvictionPolicy.ts
/**
 * Decides which assets to evict when cache exceeds budget. Inputs:
 * current cache size, max budget (default 200 MB), entries with
 * lastAccessAt + version-staleness. Stale-version entries evict
 * first; among same-version entries, LRU.
 */
export interface AssetEvictionPolicy {
  decide(snapshot: readonly { asset_id: string; content_hash: string; sizeBytes: number; lastAccessAt: Date; isStaleVersion: boolean }[], maxBytes: number): readonly { asset_id: string; content_hash: string }[];
}
```

### Wiring

`AssetManifest` is a control-channel frame. The dispatcher registration:

```ts
dispatcher.register('AssetManifest', (frame) => store.apply(frame), 'control');
```

The store is constructed once at boot, threaded into every consumer (fixtures template, ad panel, ambient template, override handler, etc.) via the same context-object pattern the templates already use.

### Apply flow

For an incoming `AssetManifestFrame` (the manifest fields are read from `frame.payload`):

1. **Version check.** If `frame.payload.version === currentVersion` AND the `assets` set is identical (same `asset_id` × `content_hash` for every entry), no-op. Journal `asset_manifest_unchanged`.
2. **Diff.** Build added / removed / changed sets of `frame.payload.assets` vs the prior manifest's `assets`.
3. **Mark stale.** Entries removed or with a different `content_hash` are flagged `isStaleVersion = true` on their cache rows — they remain readable via the OLD content hash until eviction (i.e., a template that has not yet seen the new manifest can keep rendering with the old asset).
4. **Promote new entries.** Added or changed entries replace the applied set. `get()` from now on resolves against the new `assets`.
5. **Eager pre-fetch.** For each new/changed entry with non-null `needed_by`, schedule `ensure(asset_id)`. Pre-fetch runs concurrent with a default cap of 4 in-flight (so a 50-asset manifest does not flood the network). No prioritization beyond `needed_by` ordering (sooner first); inside the same deadline, `asset_id` lex order for determinism.
6. **Notify.** Fire `subscribeManifest` listeners with the new `version`.
7. **Journal.** `asset_manifest_applied` with counts: `added`, `changed`, `removed`, `total`.

### ensure() flow

```
ensure(assetId):
  entry = currentManifest.payload.assets.find(asset_id == assetId)
  if entry is null: reject(AssetFetchError "not in manifest")
  cached = cache.read(assetId, entry.content_hash)
  if cached: return cached
  if assetId in inFlight: return inFlight[assetId]
  promise = fetcher.fetch(entry)
    .then(asset => { cache.write(asset); inFlight.delete(assetId); return asset })
    .catch(err => { inFlight.delete(assetId); throw new AssetFetchError(entry, err) })
  inFlight[assetId] = promise
  return promise
```

The in-flight map de-duplicates concurrent callers — N templates calling `ensure(sameId)` share one fetch. The promise resolves to the same `CachedAsset` for all callers.

### Persistence

`AssetCache` writes to IndexedDB in production (`crowdaq-assets` database, `assets` object store keyed by `[asset_id, content_hash]`). On boot:

1. Open the DB.
2. Read all rows into an in-memory index of `(asset_id, content_hash) → row metadata` (size, lastAccessAt). Bytes are NOT eagerly loaded — `get()` resolves bytes on read.
3. `get()` cache hits are async-but-fast — IndexedDB read.

Note: `get()` is documented as synchronous in the interface. Implementation reconciles this with a small in-memory promotion: bytes for any asset currently referenced by the active `PlannedState` are kept in a hot map; `get()` consults the hot map first (synchronous) and falls back to `ensure()` for cold reads. Render orchestration warms the hot map via `ensure()` at slot activation.

If IndexedDB is unavailable (private browsing, quota exceeded), the cache degrades to in-memory only — assets survive the session but not restart. Journal `asset_cache_persistence_unavailable` on boot.

### Eviction

Triggered on:
- `apply()` after a manifest version bump (potentially stale entries to clear).
- Quota exceeded on `cache.write()` (`QuotaExceededError`).
- Periodic tick (1× per 5 min idle).

Policy (see `AssetEvictionPolicy`):
1. Compute total size from `cache.enumerate()`.
2. If size ≤ `maxBytes` (default 200 MB) and no stale entries flagged for cleanup, no-op.
3. Sort candidates: stale-version first, then LRU by `lastAccessAt`.
4. Evict until size ≤ `maxBytes * 0.9` (10% headroom).
5. Journal `asset_cache_evicted` with the evicted ids and reclaimed bytes.

### Content-hash verification

Every fetched asset's bytes are SHA-256-hashed and compared to `entry.content_hash`. Mismatch:
- Journal `asset_content_hash_mismatch` with expected vs observed.
- Reject the `ensure()` promise with `AssetFetchError` (cause: hash mismatch).
- Do NOT write to cache.

This protects against truncated reads, content-replaced URLs (R2 misconfig), or proxy-injected bytes.

### Out of scope

- The HTTP layer's TLS/auth — `AssetFetcher` uses the standard `fetch()` API with no custom credential handling. R2 URLs are publicly readable in phase 1 (D-GRH-74); presigning is a future R2 lifecycle change handled at the manifest publisher side.
- Manifest-version rollback — if a newer manifest is invalid (e.g., references a URL that returns 404), the player does NOT auto-rollback to the prior manifest. The render path falls through to its existing miss handling (see SPEC-CRWDQ-041 `ad_asset_cache_miss`, SPEC-CRWDQ-034 badge fallback, etc.). Manifest validity is the publisher's responsibility.
- Cross-bar asset sharing — each player instance has its own cache keyed by the bar's manifest. Two bars at the same site running on the same hardware do not share the cache; they have separate widget instances.

## Test strategy

| Dependency | Category | Test approach |
|-----------|----------|--------------|
| `Dispatcher` | 1 in-process | Real instance from SPEC-CRWDQ-022; store registers as `AssetManifest` handler. |
| `AssetCache` | 1 in-process | In-memory `MapAssetCache` implementation for tests; real IndexedDB implementation covered by SPEC-CRWDQ-027 e2e. |
| `AssetFetcher` | 2 local-substitutable | `FakeAssetFetcher` with scriptable responses (success, failure, slow, content-hash mismatch). |
| `AssetEvictionPolicy` | 1 in-process | Real implementation; assert decisions deterministically. |
| Hash verifier | 1 in-process | Real SHA-256 from `crypto.subtle.digest`. |
| Clock | system boundary | Fake timers; advance for periodic eviction tick. |
| Journal sink | 2 local-substitutable | In-memory. |

Test cases:

- **Apply happy path.** Send `AssetManifest` with 3 entries (no `needed_by`). Assert: `applied` journal with `added: 3, total: 3`; no pre-fetch initiated; `get()` for each returns null (no bytes yet); `ensure()` for each fetches and caches; subsequent `get()` returns the cached asset.
- **Cache hit/miss.** `get("known-id")` after `ensure("known-id")` returns the asset. `get("unknown-id")` returns null. `ensure("unknown-id")` rejects with `AssetFetchError`.
- **Version bump triggers re-fetch.** Apply manifest v1 with entry `A1 / hash1`. `ensure(A1)` caches. Apply manifest v2 with entry `A1 / hash2` (same id, new hash). Assert: `get(A1)` returns null (stale flagged); `ensure(A1)` re-fetches and resolves to `hash2`-version bytes.
- **Concurrent ensure de-dupes.** Issue 5 concurrent `ensure(A1)` calls before fetch resolves. Assert: `FakeAssetFetcher.fetch` called exactly once; all 5 promises resolve to the same `CachedAsset` instance.
- **Eager pre-fetch on apply.** Apply manifest with 3 entries, two having `needed_by: now+30s`, one with `needed_by: null`. Assert: the two with deadlines initiate fetches (verify via fetcher invocation count); the third does not.
- **Concurrency cap.** Apply manifest with 10 entries all having `needed_by`. Assert: at any point during pre-fetch, in-flight count ≤ 4.
- **Stale eviction.** Apply v1 with entries A, B; `ensure` both. Apply v2 with entry A only (B removed). Run eviction tick. Assert: B evicted; `asset_cache_evicted` journal includes B; A retained.
- **LRU within same version.** Cache budget 1 MB; write 1.2 MB of assets across 3 entries with staggered `lastAccessAt`. Trigger eviction. Assert: oldest `lastAccessAt` entry evicted first; size drops to ≤ 0.9 MB; `asset_cache_evicted` journal includes the oldest.
- **Content-hash mismatch rejected.** `FakeAssetFetcher` returns bytes whose hash ≠ entry's `content_hash`. Assert: `ensure()` rejects with `AssetFetchError` cause hash-mismatch; cache.write NOT called; journal `asset_content_hash_mismatch`.
- **Persisted store survives restart.** With in-memory `MapAssetCache` seeded from a prior instance's writes, simulate a "restart" by constructing a new `AssetManifestStore` over the same cache. Apply the same manifest. Assert: `get()` returns the cached asset immediately (no fetch).
- **IndexedDB unavailable graceful degradation.** Inject a cache that throws on `write()`. Assert: `ensure()` still resolves (asset returned to caller); journal `asset_cache_persistence_unavailable`; subsequent `get()` returns null (no persistence), `ensure()` re-fetches.
- **Idempotent apply.** Apply manifest v1. Apply v1 again (same version, identical entries). Assert: journal `asset_manifest_unchanged`; no pre-fetch re-triggered; no listener fire.
- **Subscribe fires on apply.** Subscribe listener, apply v1, then v2. Assert: listener invoked with `v1`, then `v2`; once per apply, not per entry.

## Vocabulary

- `AssetManifest`, `asset_id`, `content_hash`, `version`, `needed_by` — D-GRH-23, D-GRH-55.
- `asset_id` is an opaque backend-minted string; this store treats it as a flat key. Consuming specs and the backend publisher agree on prefix conventions: `badge:<sport>:<league>` (SPEC-CRWDQ-034), `team:<team_id>` (SPEC-CRWDQ-046 / 066), `venue_brand:<bar_id>` (SPEC-CRWDQ-052), `ambient:<NNN>` (SPEC-CRWDQ-053), and ad creative ids carried directly as `AdSlot.ad_ref` (SPEC-CRWDQ-041 / 065). These conventions are not enforced by this store.
- "animation definition assets" — D-GRH-31 (in-scope of this cache).
- "R2 backend" — D-GRH-74 (informational: the URL host; this spec is backend-agnostic for fetch).
- "stale version", "hot map" — internal terms defined in this spec.

## Acceptance Criteria

- [ ] `AssetManifestStore.apply(frame)` is registered as the dispatcher's `AssetManifest` handler on the control channel; `frame` is a SPEC-CRWDQ-017 `Envelope<AssetManifestPayload>` and `apply()` reads the manifest fields from `frame.payload` (`version` + the `assets` list).
- [ ] `apply()` is idempotent on identical (`payload.version`, `payload.assets` set) input — journals `asset_manifest_unchanged` and does not re-trigger pre-fetch or listener fanout.
- [ ] On version bump or entry change, `apply()` diffs the prior set, flags removed/changed entries as `isStaleVersion = true`, schedules eager pre-fetch for new/changed entries with non-null `needed_by`, and fires `subscribeManifest` listeners with the new version string.
- [ ] Eager pre-fetch caps in-flight fetches at 4; ordering is by `needed_by` ascending, then `asset_id` lex order.
- [ ] `get(assetId)` is synchronous; returns `null` when bytes are not in the hot map; never initiates fetch.
- [ ] `ensure(assetId)` resolves from cache if present; otherwise fetches; concurrent ensure for the same id de-dupe — `AssetFetcher.fetch` called exactly once and all callers receive the same `CachedAsset`.
- [ ] `ensure(assetId)` rejects with `AssetFetchError` if `assetId` is not in the applied manifest.
- [ ] Every fetched asset's bytes are SHA-256-verified against the manifest entry's `content_hash`; mismatch rejects the `ensure()` promise, does NOT write to cache, journals `asset_content_hash_mismatch`.
- [ ] Persistence: cache survives a "restart" (new `AssetManifestStore` over a seeded `AssetCache` instance) — assets cached pre-restart are returned by `get()` after the same manifest is re-applied.
- [ ] IndexedDB-unavailable degradation: `ensure()` still resolves (in-memory only); journals `asset_cache_persistence_unavailable` at boot; cross-restart persistence is lost.
- [ ] `invalidate(version)` flags non-matching-version entries for eviction; subsequent `get()` returns null for those ids until next `ensure()` re-fetches.
- [ ] `manifestEntries()` returns the full applied-manifest entry list as a read-only snapshot, enabling prefix-family enumeration (e.g. SPEC-CRWDQ-053's `ambient:` filter).
- [ ] Eviction policy: stale-version entries evict first; same-version eviction is LRU by `lastAccessAt`; eviction continues until total size ≤ 90% of `maxBytes`; journals `asset_cache_evicted` with the evicted ids and reclaimed bytes.
- [ ] Tests cover: apply happy path, cache hit/miss, version-bump re-fetch, concurrent ensure de-dup, eager pre-fetch + concurrency cap, stale eviction, LRU within same version, content-hash mismatch, persisted store survives restart, IndexedDB-unavailable degradation, idempotent apply, subscribeManifest fanout.
- [ ] No mocks of `AssetCache`, `AssetEvictionPolicy`, or hash verifier (INV-FACTORY-16); only `AssetFetcher` (HTTP boundary) and clock are substituted (INV-FACTORY-17).
