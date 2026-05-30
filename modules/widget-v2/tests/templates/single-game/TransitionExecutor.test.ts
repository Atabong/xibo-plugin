import { describe, it, expect } from 'vitest';
import { TransitionExecutor, DEFAULT_FADE } from '../../../src/render/TransitionExecutor';
import type {
  TransitionDefinition,
  TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import {
  MapAssetCache,
  FakeAssetFetcher,
  RecordingJournal as ManifestRecordingJournal,
  entryOf,
  frameOf,
  bytesOf,
} from '../../render/asset-manifest/support';

/** Records the played definition; the animation-timing boundary (INV-17). */
class RecordingPlayer implements TransitionPlayer {
  played: TransitionDefinition | null = null;
  durationMs: number | null = null;
  async play(definition: TransitionDefinition, _host: HTMLElement, durationMs: number): Promise<void> {
    this.played = definition;
    this.durationMs = durationMs;
  }
}

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

/** Build a real AssetManifestStore with the in-memory cache + fake fetcher. */
function makeAssets(): { assets: AssetManifestStore; fetcher: FakeAssetFetcher } {
  const fetcher = new FakeAssetFetcher();
  const assets = new AssetManifestStore({
    cache: new MapAssetCache(),
    fetcher,
    journal: new ManifestRecordingJournal(),
  });
  return { assets, fetcher };
}

describe('TransitionExecutor', () => {
  it('resolves a pre-baked catalog animation and plays it for duration_ms', async () => {
    const { assets } = makeAssets();
    const player = new RecordingPlayer();
    const exec = new TransitionExecutor({
      catalog: new Map([['fade_scale_up', { opacity: [0, 1] }]]),
      assets,
      player,
      journal: new RecordingJournal(),
    });
    await exec.run({ animation_id: 'fade_scale_up', duration_ms: 400 }, document.createElement('div'));
    expect(player.played?.source).toBe('catalog');
    expect(player.durationMs).toBe(400);
  });

  it('does not journal a catalog miss when the catalog resolves', async () => {
    const { assets } = makeAssets();
    const journal = new RecordingJournal();
    const exec = new TransitionExecutor({
      catalog: new Map([['fade_scale_up', {}]]),
      assets,
      player: new RecordingPlayer(),
      journal,
    });
    await exec.run({ animation_id: 'fade_scale_up', duration_ms: 400 }, document.createElement('div'));
    expect(journal.entries).toEqual([]);
  });

  it('falls back to the AssetManifest asset cache on a catalog miss and still completes', async () => {
    const { assets, fetcher } = makeAssets();
    const bytes = bytesOf('{"keyframes":1}');
    const entry = await entryOf('anim_slide', bytes, { version: 'v1' });
    fetcher.setBody('anim_slide', bytes); // bytes whose hash matches the entry
    assets.apply(frameOf({ version: 'v1', assets: [entry] }));
    await assets.ensure('anim_slide'); // warm the synchronous hot map

    const player = new RecordingPlayer();
    const exec = new TransitionExecutor({
      catalog: new Map(),
      assets,
      player,
      journal: new RecordingJournal(),
    });
    await exec.run({ animation_id: 'anim_slide', duration_ms: 250 }, document.createElement('div'));
    expect(player.played?.source).toBe('asset_cache');
  });

  it('journals transition_catalog_miss when the animation is not in the catalog', async () => {
    const { assets } = makeAssets();
    const journal = new RecordingJournal();
    const exec = new TransitionExecutor({
      catalog: new Map(),
      assets,
      player: new RecordingPlayer(),
      journal,
    });
    await exec.run({ animation_id: 'nonexistent', duration_ms: 200 }, document.createElement('div'));
    expect(journal.entries).toEqual([
      { type: 'transition_catalog_miss', animation_id: 'nonexistent' },
    ]);
  });

  it('falls back to the default fade when both the catalog and asset cache miss', async () => {
    const { assets } = makeAssets();
    const player = new RecordingPlayer();
    const exec = new TransitionExecutor({
      catalog: new Map(),
      assets,
      player,
      journal: new RecordingJournal(),
    });
    await exec.run({ animation_id: 'nonexistent', duration_ms: 200 }, document.createElement('div'));
    expect(player.played?.source).toBe('default');
    expect(player.played?.animation_id).toBe(DEFAULT_FADE.animation_id);
  });
});
