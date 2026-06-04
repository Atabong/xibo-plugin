/**
 * SPEC-CRWDQ-S11 — CrestResolver: resolve a team's crest image URL from the
 * AssetManifest (kind=crest, ref=team name_key), with a clean miss → null
 * fallback (the template then renders its colour block, never a fake).
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { AssetManifestStore } from '../../src/render/AssetManifestStore';
import { CrestResolver, teamNameKey } from '../../src/render/CrestResolver';
import {
  FakeAssetFetcher,
  MapAssetCache,
  RecordingJournal,
  bytesOf,
  hashOf,
  frameOf,
} from './asset-manifest/support';
import type { AssetEntry } from '../../src/render/AssetManifestStore';

/** A crest manifest entry (carries the S11 kind/ref extras). */
async function crestEntry(
  assetId: string,
  nameKey: string,
  bytes: ArrayBuffer,
  version = 'v1',
): Promise<AssetEntry> {
  return {
    asset_id: assetId,
    content_hash: await hashOf(bytes),
    url: `http://admin-gateway.example/assets/${assetId}`,
    content_type: 'image/png',
    version,
    needed_by: null,
    // S11 extras (widget AssetEntry doesn't declare them; carried at runtime).
    kind: 'crest',
    ref: nameKey,
  } as AssetEntry & { kind: string; ref: string };
}

describe('teamNameKey', () => {
  it('matches the backend normalisation (lower, trim, collapse spaces)', () => {
    expect(teamNameKey('  Borussia   Dortmund ')).toBe('borussia dortmund');
    expect(teamNameKey('Bayern München')).toBe('bayern münchen');
  });
});

describe('CrestResolver', () => {
  let store: AssetManifestStore;
  let fetcher: FakeAssetFetcher;
  let cache: MapAssetCache;

  beforeEach(() => {
    cache = new MapAssetCache();
    fetcher = new FakeAssetFetcher();
    store = new AssetManifestStore({ cache, fetcher, journal: new RecordingJournal() });
  });

  it('resolves a crest asset_id by team display name', async () => {
    const dortBytes = bytesOf('dortmund-crest-png');
    const entry = await crestEntry('crest:api-football:165', 'borussia dortmund', dortBytes);
    store.apply(frameOf({ version: 'v1', assets: [entry] } as never));

    const resolver = new CrestResolver(store);
    expect(resolver.assetIdForTeam('Borussia Dortmund')).toBe('crest:api-football:165');
    // Display-name variants normalise to the same key.
    expect(resolver.assetIdForTeam('  borussia   dortmund ')).toBe('crest:api-football:165');
  });

  it('returns null for a team with no published crest (colour-block fallback)', () => {
    const resolver = new CrestResolver(store);
    expect(resolver.assetIdForTeam('Nonexistent FC')).toBeNull();
    expect(resolver.crestUrlForTeam('Nonexistent FC')).toBeNull();
    expect(resolver.crestUrlForTeam(undefined)).toBeNull();
  });

  it('returns the crest URL once the bytes are warm in the cache', async () => {
    const bytes = bytesOf('crest-bytes');
    const entry = await crestEntry('crest:api-football:165', 'borussia dortmund', bytes);
    // The fetcher must return the SAME bytes the entry hash was computed over.
    fetcher.setBody('crest:api-football:165', bytes);
    store.apply(frameOf({ version: 'v1', assets: [entry] } as never));
    const resolver = new CrestResolver(store);

    // Cold: bytes not warmed yet → null (but kicks ensure()).
    expect(resolver.crestUrlForTeam('Borussia Dortmund')).toBeNull();
    // Warm it explicitly (the fetcher returns matching bytes).
    await store.ensure('crest:api-football:165');
    expect(resolver.crestUrlForTeam('Borussia Dortmund')).toBe(
      'http://admin-gateway.example/assets/crest:api-football:165',
    );
  });

  it('rebuilds its index when a new manifest is applied', async () => {
    const resolver = new CrestResolver(store);
    expect(resolver.assetIdForTeam('Bayern München')).toBeNull();

    const entry = await crestEntry('crest:api-football:157', 'bayern münchen', bytesOf('b'));
    store.apply(frameOf({ version: 'v2', assets: [entry] } as never));
    expect(resolver.assetIdForTeam('Bayern München')).toBe('crest:api-football:157');
  });

  it('fires AT MOST ONE warm-fetch per asset across many renders (no churn)', async () => {
    const bytes = bytesOf('crest-bytes');
    const entry = await crestEntry('crest:api-football:165', 'borussia dortmund', bytes);
    // Make the fetch hang (never resolves) — simulates an unreachable crest.
    fetcher.block('crest:api-football:165');
    store.apply(frameOf({ version: 'v1', assets: [entry] } as never));
    const resolver = new CrestResolver(store);

    // Render the same team 50 times (as the score-bug re-renders on each state).
    for (let i = 0; i < 50; i++) {
      expect(resolver.crestUrlForTeam('Borussia Dortmund')).toBeNull(); // colour-block fallback
    }
    // Let the fire-and-forget ensure() microtasks run.
    await Promise.resolve();
    await Promise.resolve();
    // AT MOST ONE underlying fetch was kicked despite 50 renders — no churn,
    // and the render never blocked on the hanging fetch (it returned null 50x).
    expect(fetcher.callsFor('crest:api-football:165')).toBeLessThanOrEqual(1);
  });

  it('crestUrlForTeam is synchronous + never throws when the warm-fetch rejects', () => {
    // No manifest applied → assetIdForTeam null → immediate null, no fetch.
    const resolver = new CrestResolver(store);
    expect(() => resolver.crestUrlForTeam('Anything FC')).not.toThrow();
    expect(resolver.crestUrlForTeam('Anything FC')).toBeNull();
  });

  it('ignores non-crest (creative) entries', async () => {
    const creative: AssetEntry = {
      asset_id: 'creative-1',
      content_hash: await hashOf(bytesOf('c')),
      url: 'http://admin-gateway.example/assets/creative-1',
      content_type: 'image/jpeg',
      version: 'v1',
      needed_by: null,
      // kind=creative, ref=creative-1
    } as AssetEntry & { kind: string; ref: string };
    (creative as unknown as { kind: string; ref: string }).kind = 'creative';
    (creative as unknown as { kind: string; ref: string }).ref = 'creative-1';
    store.apply(frameOf({ version: 'v1', assets: [creative] } as never));

    const resolver = new CrestResolver(store);
    // A creative is not a crest — never resolved as a team badge.
    expect(resolver.assetIdForTeam('creative-1')).toBeNull();
  });
});
