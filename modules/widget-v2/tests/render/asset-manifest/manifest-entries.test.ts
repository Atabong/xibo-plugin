import { describe, it, expect } from 'vitest';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import {
  FakeAssetFetcher,
  MapAssetCache,
  RecordingJournal,
  bytesOf,
  entryOf,
  frameOf,
} from './support';

function newStore() {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal });
  return { cache, fetcher, journal, store };
}

describe('AssetManifestStore.manifestEntries — applied-set snapshot (AC2)', () => {
  it('returns the full applied-manifest entry list', async () => {
    const { store } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    const b = await entryOf('b', bytesOf('bbb'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a, b] }));

    const entries = store.manifestEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.asset_id).sort()).toEqual(['a', 'b']);
    // Each snapshot carries the full applied entry shape.
    const snapshotA = entries.find((e) => e.asset_id === 'a');
    expect(snapshotA).toMatchObject({
      asset_id: 'a',
      content_hash: a.content_hash,
      url: a.url,
      content_type: a.content_type,
      version: 'v1',
      needed_by: a.needed_by,
    });
  });

  it('is empty before any manifest is applied', () => {
    const { store } = newStore();
    expect(store.manifestEntries()).toHaveLength(0);
  });

  it('enables prefix-family enumeration (SPEC-053 "ambient:" filter)', async () => {
    const { store } = newStore();
    const amb1 = await entryOf('ambient:001', bytesOf('a1'), { version: 'v1' });
    const amb2 = await entryOf('ambient:002', bytesOf('a2'), { version: 'v1' });
    const badge = await entryOf('badge:home', bytesOf('bh'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [amb1, badge, amb2] }));

    const ambient = store
      .manifestEntries()
      .filter((e) => e.asset_id.startsWith('ambient:'))
      .map((e) => e.asset_id)
      .sort();
    expect(ambient).toEqual(['ambient:001', 'ambient:002']);
  });

  it('reflects the latest applied set after a version bump (drops removed ids, picks up new)', async () => {
    const { store } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    const b = await entryOf('b', bytesOf('bbb'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a, b] }));

    const a2 = await entryOf('a', bytesOf('aaa2'), { version: 'v2' });
    const c = await entryOf('c', bytesOf('ccc'), { version: 'v2' });
    store.apply(frameOf({ version: 'v2', assets: [a2, c] }));

    const entries = store.manifestEntries();
    expect(entries.map((e) => e.asset_id).sort()).toEqual(['a', 'c']);
    const snapshotA = entries.find((e) => e.asset_id === 'a');
    expect(snapshotA).toMatchObject({ content_hash: a2.content_hash, version: 'v2' });
  });

  it('is a read-only snapshot — mutating the result does not affect the store', async () => {
    const { store } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    const first = store.manifestEntries() as unknown as unknown[];
    // Attempting to mutate the returned array must not corrupt internal state.
    expect(() => {
      first.push({ asset_id: 'injected' } as never);
    }).toThrow();

    const second = store.manifestEntries();
    expect(second.map((e) => e.asset_id)).toEqual(['a']);
  });
});
