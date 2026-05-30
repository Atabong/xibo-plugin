import { describe, it, expect } from 'vitest';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import { FakeAssetFetcher, MapAssetCache, RecordingJournal, bytesOf, entryOf, frameOf } from './support';

function newStore(prefetchConcurrency?: number) {
  const cache = new MapAssetCache();
  const fetcher = new FakeAssetFetcher();
  const journal = new RecordingJournal();
  const store = new AssetManifestStore({ cache, fetcher, journal, prefetchConcurrency });
  return { cache, fetcher, journal, store };
}

/** Let queued microtasks drain so fire-and-forget pre-fetch lanes start. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AssetManifestStore — eager pre-fetch (AC3)', () => {
  it('pre-fetches new entries with a non-null needed_by and skips needed_by=null', async () => {
    const { store, fetcher } = newStore();
    const a = await entryOf('a', bytesOf('a'), { version: 'v1', needed_by: '2030-01-01T00:00:00Z' });
    const b = await entryOf('b', bytesOf('b'), { version: 'v1', needed_by: '2030-01-01T00:00:00Z' });
    const c = await entryOf('c', bytesOf('c'), { version: 'v1', needed_by: null });
    fetcher.setBody('a', bytesOf('a'));
    fetcher.setBody('b', bytesOf('b'));

    store.apply(frameOf({ version: 'v1', assets: [a, b, c] }));
    await flush();

    expect(fetcher.callsFor('a')).toBe(1);
    expect(fetcher.callsFor('b')).toBe(1);
    expect(fetcher.callsFor('c')).toBe(0); // needed_by null => no eager pre-fetch
  });
});

describe('AssetManifestStore — pre-fetch concurrency cap (AC4)', () => {
  it('never exceeds 4 in-flight fetches', async () => {
    const { store, fetcher } = newStore(4);
    fetcher.blockAll();
    const assets = [];
    for (let i = 0; i < 10; i++) {
      const id = `asset-${i}`;
      assets.push(await entryOf(id, bytesOf(id), { version: 'v1', needed_by: '2030-01-01T00:00:00Z' }));
      fetcher.setBody(id, bytesOf(id));
    }

    store.apply(frameOf({ version: 'v1', assets }));
    await flush();
    await flush();

    expect(fetcher.maxInFlight()).toBeLessThanOrEqual(4);

    // Drain: release everything so no fetch is left hanging.
    for (let i = 0; i < 10; i++) fetcher.release(`asset-${i}`);
    await flush();
    await flush();
    expect(fetcher.maxInFlight()).toBeLessThanOrEqual(4);
  });

  it('orders pre-fetch by needed_by ascending, then asset_id lexicographic', async () => {
    const { store, fetcher } = newStore(1); // single lane => start order is deterministic
    fetcher.blockAll();
    const early = '2030-01-01T00:00:00Z';
    const late = '2030-06-01T00:00:00Z';
    // Intentionally out of order; expect: zeta(early), alpha(late), beta(late)
    const beta = await entryOf('beta', bytesOf('beta'), { version: 'v1', needed_by: late });
    const zeta = await entryOf('zeta', bytesOf('zeta'), { version: 'v1', needed_by: early });
    const alpha = await entryOf('alpha', bytesOf('alpha'), { version: 'v1', needed_by: late });
    for (const e of [beta, zeta, alpha]) fetcher.setBody(e.asset_id, bytesOf(e.asset_id));

    store.apply(frameOf({ version: 'v1', assets: [beta, zeta, alpha] }));
    // With one lane, release each in turn so the next starts.
    for (let step = 0; step < 3; step++) {
      await flush();
      const started = fetcher.startOrder[fetcher.startOrder.length - 1];
      if (started) fetcher.release(started);
    }
    await flush();

    expect(fetcher.startOrder).toEqual(['zeta', 'alpha', 'beta']);
  });
});
