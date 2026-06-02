/**
 * Shared test collaborators for the with-ads composite template family
 * (SPEC-CRWDQ-041). Per INV-FACTORY-16/-17 the only substituted boundaries are
 * the genuine ones: the `AssetFetcher` (network) the REAL `AssetManifestStore`
 * is driven through, the card-animation playback seam, and the image `load`
 * event (image fetch is the boundary — see {@link withSyncImageLoad}). The
 * `MultiGameTemplate`, `FixturesTemplate`, `AssetManifestStore`,
 * `FixtureListStore`, `GameStateStore`, and journal are all REAL instances.
 */
import {
  AssetManifestStore,
  type AssetCache,
  type AssetCacheRow,
  type AssetFetcher,
  type AssetEntry,
  type CachedAsset,
  type AssetManifestFrame,
  type ManifestJournal,
  type ManifestJournalEntry,
} from '../../../src/render/AssetManifestStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { CardTransitions } from '../../../src/templates/multi-game/CardSet';
import type { AdSlotPayload } from '../../../src/render/types';

/** An in-memory render journal recorder (a real sink, not a mock). */
export class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

/** Records every card enter/exit animation; resolves immediately. */
export class RecordingCardTransitions implements CardTransitions {
  readonly played: Array<{ id: string; animationId: string; phase: 'enter' | 'exit' }> = [];
  async enter(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ id: idOf(card), animationId, phase: 'enter' });
  }
  async exit(card: HTMLElement, animationId: string): Promise<void> {
    this.played.push({ id: idOf(card), animationId, phase: 'exit' });
  }
}

function idOf(card: HTMLElement): string {
  return card.dataset['gameId'] ?? card.dataset['eventId'] ?? '';
}

/** A no-op in-memory AssetCache (the persistence boundary). */
class MemoryAssetCache implements AssetCache {
  private readonly rows = new Map<string, CachedAsset>();
  async read(assetId: string, contentHash: string): Promise<CachedAsset | null> {
    return this.rows.get(`${assetId} ${contentHash}`) ?? null;
  }
  async write(asset: CachedAsset): Promise<void> {
    this.rows.set(`${asset.asset_id} ${asset.content_hash}`, asset);
  }
  async delete(assetId: string, contentHash: string): Promise<void> {
    this.rows.delete(`${assetId} ${contentHash}`);
  }
  async enumerate(): Promise<AssetCacheRow[]> {
    return [];
  }
}

/** content_hash of an empty ArrayBuffer (sha256 of zero bytes). */
export const EMPTY_SHA256 =
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** A substitutable AssetFetcher returning the entry's declared hash + url. */
export class StubAssetFetcher implements AssetFetcher {
  readonly fetched: string[] = [];
  async fetch(entry: AssetEntry): Promise<CachedAsset> {
    this.fetched.push(entry.asset_id);
    return {
      asset_id: entry.asset_id,
      content_hash: entry.content_hash,
      url: entry.url,
      content_type: entry.content_type || 'image/png',
      bytes: new ArrayBuffer(0),
    };
  }
  callsFor(assetId: string): number {
    return this.fetched.filter((id) => id === assetId).length;
  }
}

/** In-memory manifest journal (a real sink). */
class ManifestRecorder implements ManifestJournal {
  readonly entries: ManifestJournalEntry[] = [];
  record(entry: ManifestJournalEntry): void {
    this.entries.push(entry);
  }
}

/** Build a real AssetManifestStore wired to in-memory boundaries. */
export function makeAssetStore(): { store: AssetManifestStore; fetcher: StubAssetFetcher } {
  const fetcher = new StubAssetFetcher();
  const store = new AssetManifestStore({
    cache: new MemoryAssetCache(),
    fetcher,
    journal: new ManifestRecorder(),
    persistenceAvailable: true,
  });
  return { store, fetcher };
}

/**
 * Apply a manifest declaring `assetIds`, then WARM the hot map so a synchronous
 * `get()` hits (the with-ads templates read the cache synchronously at mount,
 * exactly as production does after the AssetManifest pre-fetch — D-GRH-23).
 * Returns the per-id resolvable url so a test can assert the `<img src>`.
 */
export async function applyAndWarmAdManifest(
  store: AssetManifestStore,
  assetIds: string[],
): Promise<Record<string, string>> {
  const assets: AssetEntry[] = assetIds.map((id) => ({
    asset_id: id,
    content_hash: EMPTY_SHA256,
    url: `https://cdn.example/${id}.png`,
    content_type: 'image/png',
    version: 'v1',
    needed_by: null,
  }));
  store.apply({ message_type: 'AssetManifest', payload: { version: 'v1', assets } } as AssetManifestFrame);
  // Warm the synchronous hot map (production warms it via pre-fetch on receipt).
  await Promise.all(assetIds.map((id) => store.ensure(id)));
  return Object.fromEntries(assets.map((a) => [a.asset_id, a.url]));
}

/** Apply a manifest that DECLARES the ids but never warms them (cache miss). */
export function applyColdAdManifest(store: AssetManifestStore, assetIds: string[]): void {
  const assets: AssetEntry[] = assetIds.map((id) => ({
    asset_id: id,
    content_hash: EMPTY_SHA256,
    url: `https://cdn.example/${id}.png`,
    content_type: 'image/png',
    version: 'v1',
    needed_by: null,
  }));
  store.apply({ message_type: 'AssetManifest', payload: { version: 'v1', assets } } as AssetManifestFrame);
}

/** A complete AdSlot payload with sensible defaults. */
export const adSlot = (over: Partial<AdSlotPayload> = {}): AdSlotPayload => ({
  ad_slot_id: 'ad-1',
  ad_class: 'banner',
  ad_ref: 'creative-1',
  ad_ref_type: 'asset_id',
  policy: {},
  ...over,
});

/**
 * Drive a block so every `<img>` whose `src` is assigned fires its `load`
 * event synchronously. Image fetching is the genuine system boundary
 * (INV-FACTORY-17); under jsdom no real fetch occurs, so this makes the
 * `load` deterministic instead of never firing. Restores the prototype after.
 */
export async function withSyncImageLoad<T>(body: () => T | Promise<T>): Promise<T> {
  const proto = HTMLImageElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'src');
  Object.defineProperty(proto, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value);
      // Fire load on the next microtask so listeners attached after the set
      // still observe it (mirrors a fetched-from-cache image resolving async).
      queueMicrotask(() => this.dispatchEvent(new Event('load')));
    },
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? '';
    },
  });
  try {
    return await body();
  } finally {
    if (original) Object.defineProperty(proto, 'src', original);
    else delete (proto as unknown as Record<string, unknown>)['src'];
  }
}
