import { describe, it, expect } from 'vitest';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { FakeAssetFetcher, MapAssetCache, RecordingJournal, bytesOf, entryOf, frameOf } from './support';

/** Let the apply()-triggered async hot-map hydration settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AssetManifestStore — persistence across restart (AC9)', () => {
  it('a new store over a seeded cache returns the cached asset from get() after re-applying the manifest', async () => {
    const cache = new MapAssetCache(); // shared across the "restart"
    const a = await entryOf('A1', bytesOf('persist-me'), { version: 'v1' });

    // First instance fetches + caches.
    {
      const fetcher = new FakeAssetFetcher();
      fetcher.setBody('A1', bytesOf('persist-me'));
      const store = new AssetManifestStore({ cache, fetcher, journal: new RecordingJournal() });
      store.apply(frameOf({ version: 'v1', assets: [a] }));
      await store.ensure('A1');
    }

    // "Restart": brand-new store over the SAME cache, fresh fetcher.
    const fetcher2 = new FakeAssetFetcher();
    const store2 = new AssetManifestStore({ cache, fetcher: fetcher2, journal: new RecordingJournal() });
    store2.apply(frameOf({ version: 'v1', assets: [a] }));
    await flush();

    const got = store2.get('A1');
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe('persist-me');
    expect(fetcher2.callsFor('A1')).toBe(0); // served from persistence, no fetch
  });
});

describe('AssetManifestStore — IndexedDB-unavailable degradation (AC10)', () => {
  it('journals asset_cache_persistence_unavailable at boot when persistence is unavailable', () => {
    const journal = new RecordingJournal();
    new AssetManifestStore({
      cache: new MapAssetCache(),
      fetcher: new FakeAssetFetcher(),
      journal,
      persistenceAvailable: false,
    });
    expect(journal.has('asset_cache_persistence_unavailable')).toBe(true);
  });

  it('ensure() still resolves in-memory when the cache rejects writes; cross-restart persistence is lost', async () => {
    const cache = new MapAssetCache();
    cache.failWrites = true; // simulate quota/private-browsing write failure
    const fetcher = new FakeAssetFetcher();
    fetcher.setBody('A1', bytesOf('ephemeral'));
    const store = new AssetManifestStore({ cache, fetcher, journal: new RecordingJournal() });
    const a = await entryOf('A1', bytesOf('ephemeral'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    const asset = await store.ensure('A1'); // resolves despite write failure
    expect(new TextDecoder().decode(asset.bytes)).toBe('ephemeral');
    expect(store.get('A1')).not.toBeNull(); // hot map serves this session

    // Nothing persisted: a fresh store over the same cache must re-fetch.
    const fetcher2 = new FakeAssetFetcher();
    fetcher2.setBody('A1', bytesOf('ephemeral'));
    const store2 = new AssetManifestStore({ cache, fetcher: fetcher2, journal: new RecordingJournal() });
    store2.apply(frameOf({ version: 'v1', assets: [a] }));
    await flush();
    expect(store2.get('A1')).toBeNull(); // not persisted
    await store2.ensure('A1');
    expect(fetcher2.callsFor('A1')).toBe(1); // had to re-fetch
  });
});
