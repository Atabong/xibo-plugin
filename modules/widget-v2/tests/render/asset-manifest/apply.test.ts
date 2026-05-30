import { describe, it, expect } from 'vitest';
import {
  AssetManifestStore,
  AssetFetchError,
} from '../../../src/render/AssetManifestStore';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester, ServerFrame } from '../../../src/transport/types';
import {
  FakeAssetFetcher,
  MapAssetCache,
  RecordingJournal,
  bytesOf,
  entryOf,
  frameOf,
} from './support';

class NullRequester implements GameStateRequester {
  requestForGap(): void {}
  resolve(): void {}
}
class NoActiveGames implements ActiveGames {
  isActive(): boolean {
    return false;
  }
}

function newStore() {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal });
  return { cache, fetcher, journal, store };
}

describe('AssetManifestStore.apply — happy path', () => {
  it('journals asset_manifest_applied with diff counts and pre-fetches nothing when needed_by is null', async () => {
    const { store, fetcher, journal } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    const b = await entryOf('b', bytesOf('bbb'), { version: 'v1' });
    const c = await entryOf('c', bytesOf('ccc'), { version: 'v1' });

    store.apply(frameOf({ version: 'v1', assets: [a, b, c] }));

    const applied = journal.typesOf('asset_manifest_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ added: 3, changed: 0, removed: 0, total: 3 });
    expect(fetcher.calls).toHaveLength(0); // no needed_by => no eager pre-fetch
  });

  it('reads version and assets from frame.payload', async () => {
    const { store, journal } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v9' });
    store.apply(frameOf({ version: 'v9', assets: [a] }));
    const applied = journal.typesOf('asset_manifest_applied');
    expect(applied[0]).toMatchObject({ version: 'v9', total: 1 });
  });
});

describe('AssetManifestStore.get / ensure — cache hit/miss', () => {
  it('get returns null before any fetch; ensure fetches + caches; get then returns the asset', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    fetcher.setBody('a', bytesOf('aaa'));
    store.apply(frameOf({ version: 'v1', assets: [a] }));

    expect(store.get('a')).toBeNull();

    const asset = await store.ensure('a');
    expect(asset.asset_id).toBe('a');
    expect(new TextDecoder().decode(asset.bytes)).toBe('aaa');

    // After ensure() warms the hot map, get() is a synchronous hit.
    expect(store.get('a')).not.toBeNull();
    expect(store.get('a')?.asset_id).toBe('a');
  });

  it('get for an unknown id returns null and never fetches', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a] }));
    expect(store.get('nope')).toBeNull();
    expect(fetcher.calls).toHaveLength(0);
  });

  it('ensure for an id not in the applied manifest rejects with AssetFetchError', async () => {
    const { store } = newStore();
    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    store.apply(frameOf({ version: 'v1', assets: [a] }));
    await expect(store.ensure('missing')).rejects.toBeInstanceOf(AssetFetchError);
  });
});

describe('AssetManifestStore — dispatcher registration', () => {
  it('registers apply() as the AssetManifest handler on the control channel', async () => {
    const { store, fetcher } = newStore();
    const dispatcher = new FrameDispatcher(new NullRequester(), new NoActiveGames());
    store.registerWith(dispatcher);

    const a = await entryOf('a', bytesOf('aaa'), { version: 'v1' });
    fetcher.setBody('a', bytesOf('aaa'));
    const frame = frameOf({ version: 'v1', assets: [a] }) as unknown as ServerFrame;
    dispatcher.dispatch(frame);

    // The handler ran: applying produced the synchronous manifest state, so
    // get() resolves the entry id (null bytes, but the id is known).
    await store.ensure('a');
    expect(store.get('a')?.asset_id).toBe('a');
  });
});
