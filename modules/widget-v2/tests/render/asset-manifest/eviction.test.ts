import { describe, it, expect } from 'vitest';
import {
  AssetManifestStore,
  LruStaleEvictionPolicy,
} from '../../../src/render/AssetManifestStore';
import { FakeAssetFetcher, MapAssetCache, RecordingJournal, bytesOf, entryOf, frameOf } from './support';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LruStaleEvictionPolicy — unit (AC12)', () => {
  it('evicts stale-version entries first, then LRU, down to <=90% of maxBytes', () => {
    const policy = new LruStaleEvictionPolicy();
    const now = Date.now();
    const snapshot = [
      { asset_id: 'fresh-new', content_hash: 'h1', sizeBytes: 400, lastAccessAt: new Date(now), isStaleVersion: false },
      { asset_id: 'fresh-old', content_hash: 'h2', sizeBytes: 400, lastAccessAt: new Date(now - 10_000), isStaleVersion: false },
      { asset_id: 'stale', content_hash: 'h3', sizeBytes: 400, lastAccessAt: new Date(now), isStaleVersion: true },
    ];
    // total 1200; maxBytes 1000 -> target 900. Stale evicts first (-> 800 <= 900, stop).
    const evicted = policy.decide(snapshot, 1000);
    expect(evicted).toEqual([{ asset_id: 'stale', content_hash: 'h3' }]);
  });

  it('after stale removal still over budget evicts the LRU same-version entry', () => {
    const policy = new LruStaleEvictionPolicy();
    const now = Date.now();
    const snapshot = [
      { asset_id: 'new', content_hash: 'h1', sizeBytes: 500, lastAccessAt: new Date(now), isStaleVersion: false },
      { asset_id: 'old', content_hash: 'h2', sizeBytes: 500, lastAccessAt: new Date(now - 10_000), isStaleVersion: false },
      { asset_id: 'stale', content_hash: 'h3', sizeBytes: 500, lastAccessAt: new Date(now), isStaleVersion: true },
    ];
    // total 1500; max 1000 -> target 900. Evict stale (1000) then old LRU (500 <= 900).
    const evicted = policy.decide(snapshot, 1000);
    expect(evicted).toEqual([
      { asset_id: 'stale', content_hash: 'h3' },
      { asset_id: 'old', content_hash: 'h2' },
    ]);
  });

  it('no-op when under budget and no stale entries', () => {
    const policy = new LruStaleEvictionPolicy();
    const snapshot = [
      { asset_id: 'a', content_hash: 'h1', sizeBytes: 100, lastAccessAt: new Date(), isStaleVersion: false },
    ];
    expect(policy.decide(snapshot, 1000)).toEqual([]);
  });
});

function newStore(maxBytes: number) {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal, maxBytes });
  return { cache, fetcher, journal, store };
}

describe('AssetManifestStore.evict — stale eviction (AC12)', () => {
  it('evicts the removed (stale) entry, retains the surviving entry, and journals reclaimed bytes', async () => {
    const { store, fetcher, cache, journal } = newStore(1_000_000);
    const a = await entryOf('A', bytesOf('aaaa'), { version: 'v1' });
    const b = await entryOf('B', bytesOf('bbbb'), { version: 'v1' });
    fetcher.setBody('A', bytesOf('aaaa'));
    fetcher.setBody('B', bytesOf('bbbb'));
    store.apply(frameOf({ version: 'v1', assets: [a, b] }));
    await store.ensure('A');
    await store.ensure('B');

    // v2 drops B (removed) -> B flagged stale.
    const a2 = await entryOf('A', bytesOf('aaaa'), { version: 'v2' });
    store.apply(frameOf({ version: 'v2', assets: [a2] }));
    await flush();

    await store.evict();

    const rows = await cache.enumerate();
    const ids = rows.map((r) => r.asset_id);
    expect(ids).toContain('A'); // retained
    expect(ids).not.toContain('B'); // stale, evicted

    const evicted = journal.typesOf('asset_cache_evicted');
    expect(evicted).toHaveLength(1);
    const entry = evicted[0]!;
    expect(entry.evicted).toContain('B');
    expect(entry.reclaimedBytes).toBe(4);
  });
});

describe('AssetManifestStore.evict — LRU within same version (AC12)', () => {
  it('evicts the oldest lastAccessAt entry first until size <= 90% of budget', async () => {
    // Budget 1000 bytes; three 400-byte assets (1200 total) -> evict oldest.
    const { store, fetcher, cache, journal } = newStore(1000);
    const ids = ['x', 'y', 'z'];
    const entries = [];
    for (const id of ids) {
      const bytes = bytesOf('q'.repeat(400));
      entries.push(await entryOf(id, bytes, { version: 'v1' }));
      fetcher.setBody(id, bytes);
    }
    store.apply(frameOf({ version: 'v1', assets: entries }));
    for (const id of ids) await store.ensure(id);

    // Stagger access times: y oldest, then x, then z newest.
    const base = Date.now();
    cache.touch('y', entries[1]!.content_hash, new Date(base - 30_000));
    cache.touch('x', entries[0]!.content_hash, new Date(base - 20_000));
    cache.touch('z', entries[2]!.content_hash, new Date(base - 10_000));

    await store.evict();

    const remaining = (await cache.enumerate()).map((r) => r.asset_id);
    expect(remaining).not.toContain('y'); // oldest evicted first
    const totalBytes = (await cache.enumerate()).reduce((s, r) => s + r.sizeBytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(900); // <= 90% of 1000

    const evicted = journal.typesOf('asset_cache_evicted');
    expect(evicted[0]!.evicted).toContain('y');
  });
});
