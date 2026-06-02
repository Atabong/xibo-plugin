/**
 * SPEC-CRWDQ-053 (#58 part 1) — AmbientPlaylist.resolve() enumerates the
 * `ambient:`-prefixed manifest entries via the REAL AssetManifestStore
 * (INV-FACTORY-16), orders them by `asset_id` lexical, keeps the image-category
 * entries, and skips video entries with a single `ambient_video_deferred`
 * journaled.
 *
 * NOTE (issue #58 vs spec divergence, disclosed in the PR): the issue AC fixes
 * the order as `asset_id` LEXICAL. The spec's proposed interface mentioned an
 * `ambient_seq` metadata key, but the SPEC-CRWDQ-064 `AssetEntry` carries no
 * such field, so lexical asset_id order is the only contract the entry shape
 * supports. We implement the issue's explicit ordering.
 */
import { describe, it, expect } from 'vitest';
import { AmbientPlaylist } from '../../../src/templates/ambient/AmbientPlaylist';
import { RecordingJournal, makeAssetStore, applyManifest, image, video } from './support';

describe('AmbientPlaylist.resolve (SPEC-CRWDQ-053 #58)', () => {
  it('enumerates only ambient:-prefixed entries, ordered by asset_id lexical', () => {
    const store = makeAssetStore();
    const journal = new RecordingJournal();
    // Insertion order deliberately not lexical, plus non-ambient noise.
    applyManifest(store, [
      image('ambient:zulu'),
      image('badge:home'),
      image('ambient:alpha'),
      image('ambient:mike'),
    ]);

    const playlist = new AmbientPlaylist({ assetManifestStore: store, journal });
    const creatives = playlist.resolve();

    expect(creatives.map((c) => c.asset_id)).toEqual([
      'ambient:alpha',
      'ambient:mike',
      'ambient:zulu',
    ]);
    // Each creative carries the entry url so the template can paint <img src>.
    expect(creatives[0]!.url).toBe('https://cdn.example/ambient:alpha.png');
    expect(creatives[0]!.content_type).toBe('image');
  });

  it('keeps image entries, skips video entries, journaling ambient_video_deferred', () => {
    const store = makeAssetStore();
    const journal = new RecordingJournal();
    applyManifest(store, [
      image('ambient:001'),
      video('ambient:002'),
      image('ambient:003'),
    ]);

    const creatives = new AmbientPlaylist({ assetManifestStore: store, journal }).resolve();

    expect(creatives.map((c) => c.asset_id)).toEqual(['ambient:001', 'ambient:003']);
    const deferred = journal.typesOf('ambient_video_deferred');
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({ skipped: ['ambient:002'] });
  });

  it('returns an empty playlist when no ambient:* assets exist', () => {
    const store = makeAssetStore();
    const journal = new RecordingJournal();
    applyManifest(store, [image('badge:home'), image('theme:dark')]);

    expect(new AmbientPlaylist({ assetManifestStore: store, journal }).resolve()).toEqual([]);
  });

  it('returns an empty playlist when every ambient:* asset is a video', () => {
    const store = makeAssetStore();
    const journal = new RecordingJournal();
    applyManifest(store, [video('ambient:001'), video('ambient:002')]);

    const creatives = new AmbientPlaylist({ assetManifestStore: store, journal }).resolve();
    expect(creatives).toEqual([]);
    expect(journal.typesOf('ambient_video_deferred')).toHaveLength(1);
  });

  it('re-resolves the latest applied manifest on each call (mid-mount refresh source)', () => {
    const store = makeAssetStore();
    const journal = new RecordingJournal();
    const playlist = new AmbientPlaylist({ assetManifestStore: store, journal });

    applyManifest(store, [image('ambient:001'), image('ambient:002')], 'v1');
    expect(playlist.resolve().map((c) => c.asset_id)).toEqual(['ambient:001', 'ambient:002']);

    applyManifest(store, [image('ambient:100'), image('ambient:200')], 'v2');
    expect(playlist.resolve().map((c) => c.asset_id)).toEqual(['ambient:100', 'ambient:200']);
  });
});
