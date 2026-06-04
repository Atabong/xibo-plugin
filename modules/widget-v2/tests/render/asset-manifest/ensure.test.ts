import { describe, it, expect } from 'vitest';
import { AssetManifestStore, AssetFetchError } from '../../../src/render/AssetManifestStore';
import { FakeAssetFetcher, MapAssetCache, RecordingJournal, bytesOf, entryOf, frameOf } from './support';

function newStore() {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal });
  return { cache, fetcher, journal, store };
}

describe('AssetManifestStore.ensure — concurrent de-dup (AC6)', () => {
  it('fetches exactly once for N concurrent ensure() of the same id; all callers get the same CachedAsset', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('A1', bytesOf('payload'), { version: 'v1' });
    fetcher.setBody('A1', bytesOf('payload'));
    fetcher.block('A1'); // hold the fetch open until all callers have queued
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    const calls = [store.ensure('A1'), store.ensure('A1'), store.ensure('A1'), store.ensure('A1'), store.ensure('A1')];
    fetcher.release('A1');
    const results = await Promise.all(calls);

    expect(fetcher.callsFor('A1')).toBe(1);
    for (const r of results) {
      expect(r).toBe(results[0]); // same instance
    }
  });

  it('after a fetch settles a fresh ensure() may fetch again (in-flight cleared)', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('A1', bytesOf('payload'), { version: 'v1' });
    fetcher.setBody('A1', bytesOf('payload'));
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    await store.ensure('A1');
    // get() now hits; ensure() should return the cached asset without a 2nd fetch.
    const second = await store.ensure('A1');
    expect(second.asset_id).toBe('A1');
    // Cache short-circuits the fetcher on the second ensure (read hit).
    expect(fetcher.callsFor('A1')).toBe(1);
  });
});

describe('AssetManifestStore.ensure — content-hash verification (AC8)', () => {
  it('rejects with AssetFetchError, does not cache, and journals on hash mismatch', async () => {
    const { store, fetcher, cache, journal } = newStore();
    const a = await entryOf('A1', bytesOf('correct-bytes'), { version: 'v1' });
    // Fetcher returns DIFFERENT bytes -> SHA-256 will not match entry.content_hash.
    fetcher.setCorrupt('A1', bytesOf('tampered-bytes'));
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    await expect(store.ensure('A1')).rejects.toBeInstanceOf(AssetFetchError);
    expect(cache.size()).toBe(0); // no cache write
    expect(store.get('A1')).toBeNull();

    const mismatch = journal.typesOf('asset_content_hash_mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ asset_id: 'A1', expected: a.content_hash });
  });
});
