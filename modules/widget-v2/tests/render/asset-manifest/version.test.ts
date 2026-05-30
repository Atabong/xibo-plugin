import { describe, it, expect } from 'vitest';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { FakeAssetFetcher, MapAssetCache, RecordingJournal, bytesOf, entryOf, frameOf } from './support';

function newStore() {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal });
  return { cache, fetcher, journal, store };
}

describe('AssetManifestStore — idempotent apply (AC2)', () => {
  it('re-applying the same (version, entry-set) journals asset_manifest_unchanged and fires no listener or pre-fetch', async () => {
    const { store, fetcher, journal } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1', needed_by: '2030-01-01T00:00:00Z' });
    fetcher.setBody('a', bytesOf('aaa'));

    const versions: string[] = [];
    store.subscribeManifest((v) => versions.push(v));

    store.apply(frameOf({ version: 'v1', assets: [a] }));
    const callsAfterFirst = fetcher.callsFor('a');

    store.apply(frameOf({ version: 'v1', assets: [a] })); // identical

    expect(journal.has('asset_manifest_unchanged')).toBe(true);
    expect(journal.typesOf('asset_manifest_applied')).toHaveLength(1); // only the first
    expect(versions).toEqual(['v1']); // listener fired once
    expect(fetcher.callsFor('a')).toBe(callsAfterFirst); // no re-prefetch
  });
});

describe('AssetManifestStore — version bump (AC3)', () => {
  it('flags the prior entry stale (get returns null) and ensure re-fetches the new hash', async () => {
    const { store, fetcher } = newStore();
    const v1 = await entryOf('A1', bytesOf('hash1-bytes'), { version: 'v1' });
    fetcher.setBody('A1', bytesOf('hash1-bytes'));
    store.apply(frameOf({ version: 'v1', assets: [v1] }));
    const cached1 = await store.ensure('A1');
    expect(new TextDecoder().decode(cached1.bytes)).toBe('hash1-bytes');
    expect(store.get('A1')).not.toBeNull();

    const v2 = await entryOf('A1', bytesOf('hash2-bytes'), { version: 'v2' });
    fetcher.setBody('A1', bytesOf('hash2-bytes'));
    store.apply(frameOf({ version: 'v2', assets: [v2] }));

    // Prior version's bytes no longer satisfy the new applied hash.
    expect(store.get('A1')).toBeNull();

    const cached2 = await store.ensure('A1');
    expect(new TextDecoder().decode(cached2.bytes)).toBe('hash2-bytes');
    expect(store.get('A1')).not.toBeNull();
  });

  it('fires subscribeManifest listeners with each new version once per apply', async () => {
    const { store, fetcher } = newStore();
    fetcher.setBody('A1', bytesOf('one'));
    const v1 = await entryOf('A1', bytesOf('one'), { version: 'v1' });
    const v2 = await entryOf('A1', bytesOf('two'), { version: 'v2' });
    fetcher.setBody('A1', bytesOf('two'));

    const versions: string[] = [];
    const unsub = store.subscribeManifest((v) => versions.push(v));

    store.apply(frameOf({ version: 'v1', assets: [v1] }));
    store.apply(frameOf({ version: 'v2', assets: [v2] }));
    unsub();
    store.apply(frameOf({ version: 'v3', assets: [await entryOf('A1', bytesOf('three'), { version: 'v3' })] }));

    expect(versions).toEqual(['v1', 'v2']); // v3 after unsubscribe is not seen
  });
});

describe('AssetManifestStore.invalidate (AC11)', () => {
  it('flags entries whose version != given version; get returns null until ensure re-fetches', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('A1', bytesOf('aaa'), { version: 'v1' });
    fetcher.setBody('A1', bytesOf('aaa'));
    store.apply(frameOf({ version: 'v1', assets: [a] }));
    await store.ensure('A1');
    expect(store.get('A1')).not.toBeNull();

    store.invalidate('v2'); // A1 is version v1 -> flagged stale

    expect(store.get('A1')).toBeNull();

    // AC11: ensure() re-fetches against the (still-applied) manifest entry,
    // clearing the stale flag so a subsequent get() hits again.
    const refetched = await store.ensure('A1');
    expect(refetched.asset_id).toBe('A1');
    expect(store.get('A1')).not.toBeNull();
  });
});
