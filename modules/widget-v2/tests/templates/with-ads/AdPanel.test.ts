import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdPanel } from '../../../src/templates/with-ads/AdPanel';
import {
  RecordingJournal,
  makeAssetStore,
  applyAndWarmAdManifest,
  applyColdAdManifest,
  adSlot,
  withSyncImageLoad,
} from './support';

describe('AdPanel.mount (SPEC-CRWDQ-041 #55)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('renders one <img class="cdq-ad-creative"> with the manifest-resolved url', async () => {
    const { store } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(store, ['creative-1']);
    const journal = new RecordingJournal();

    const instance = new AdPanel().mount(host, {
      adSlot: adSlot({ ad_ref: 'creative-1' }),
      assetManifestStore: store,
      journal,
      stateId: 'st-1',
      positionClass: 'right',
    });

    expect(instance).not.toBeNull();
    const imgs = host.querySelectorAll('img.cdq-ad-creative');
    expect(imgs).toHaveLength(1);
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe(urls['creative-1']);
  });

  it('stamps data-ad-slot-id + data-ad-class and sets no click handler / video', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const journal = new RecordingJournal();

    const instance = new AdPanel().mount(host, {
      adSlot: adSlot({ ad_slot_id: 'ad-42', ad_class: 'sidebar', ad_ref: 'creative-1' }),
      assetManifestStore: store,
      journal,
      stateId: 'st-1',
      positionClass: 'right',
    });

    const panel = host.querySelector<HTMLElement>('.cdq-ad-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.dataset['adSlotId']).toBe('ad-42');
    expect(panel.dataset['adClass']).toBe('sidebar');
    expect(panel.dataset['position']).toBe('right');
    // No video element and no anchor / click handler — bar screens are passive.
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
    instance!.detach();
  });

  it('journals ad_slot_rendered with ad_slot_id, ad_ref, state_id on the image load event', async () => {
    const { store } = makeAssetStore();
    await applyAndWarmAdManifest(store, ['creative-1']);
    const journal = new RecordingJournal();

    await withSyncImageLoad(async () => {
      new AdPanel().mount(host, {
        adSlot: adSlot({ ad_slot_id: 'ad-7', ad_ref: 'creative-1' }),
        assetManifestStore: store,
        journal,
        stateId: 'st-9',
        positionClass: 'right',
      });
      // Let the queued load microtask flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    const rendered = journal.typesOf('ad_slot_rendered');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      ad_slot_id: 'ad-7',
      ad_ref: 'creative-1',
      state_id: 'st-9',
    });
  });

  it('on cache miss returns null, journals ad_asset_cache_miss, and warms via ensure()', async () => {
    const { store, fetcher } = makeAssetStore();
    // Declared in the manifest but never warmed -> get() misses.
    applyColdAdManifest(store, ['creative-cold']);
    const journal = new RecordingJournal();

    const instance = new AdPanel().mount(host, {
      adSlot: adSlot({ ad_slot_id: 'ad-cold', ad_ref: 'creative-cold' }),
      assetManifestStore: store,
      journal,
      stateId: 'st-1',
      positionClass: 'right',
    });

    expect(instance).toBeNull();
    expect(host.querySelector('img.cdq-ad-creative')).toBeNull();
    const miss = journal.typesOf('ad_asset_cache_miss');
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ ad_slot_id: 'ad-cold', ad_ref: 'creative-cold' });
    // ensure() was called to warm the cache for the next slot.
    await Promise.resolve();
    expect(fetcher.callsFor('creative-cold')).toBe(1);
  });
});
