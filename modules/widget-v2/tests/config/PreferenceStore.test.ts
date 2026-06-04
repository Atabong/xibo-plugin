/**
 * SPEC-CRWDQ-014 #27 AC7 — PreferenceStore persists the entire payload to
 * LocalStorage key `crowdaq.widgetV2.barPreferences` as `{ payload, configHash }`
 * and `load()` round-trips it or returns null. Runs under jsdom (real
 * LocalStorage); the asset cache is the real in-memory adapter (INV-16).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStoragePreferenceStore,
  PREFERENCES_STORAGE_KEY,
} from '../../src/config/PreferenceStore';
import { InMemoryAssetCacheAdapter, makePayload } from './support';

describe('LocalStoragePreferenceStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no snapshot is persisted', async () => {
    const store = new LocalStoragePreferenceStore(localStorage, new InMemoryAssetCacheAdapter());
    expect(await store.load()).toBeNull();
  });

  it('persists the entire payload + configHash and round-trips it', async () => {
    const store = new LocalStoragePreferenceStore(localStorage, new InMemoryAssetCacheAdapter());
    const payload = makePayload();
    await store.save({ payload, configHash: payload.config_hash });

    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ payload, configHash: payload.config_hash });

    const loaded = await store.load();
    expect(loaded).toEqual({ payload, configHash: payload.config_hash });
    // Full payload — not just preferences — survives the round trip.
    expect(loaded?.payload.cache_ceiling_bytes).toBe(payload.cache_ceiling_bytes);
    expect(loaded?.payload.intervals).toEqual(payload.intervals);
    expect(loaded?.payload.preferences).toEqual(payload.preferences);
  });

  it('returns null for a corrupt stored blob', async () => {
    const store = new LocalStoragePreferenceStore(localStorage, new InMemoryAssetCacheAdapter());
    localStorage.setItem(PREFERENCES_STORAGE_KEY, '{not json');
    expect(await store.load()).toBeNull();
  });

  it('returns null for a wrong-typed configHash in the stored snapshot', async () => {
    const store = new LocalStoragePreferenceStore(localStorage, new InMemoryAssetCacheAdapter());
    // Structurally an object with both keys, but configHash is a number — a
    // blind cast would have surfaced a non-string hash to the handler.
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ payload: makePayload(), configHash: 123 }),
    );
    expect(await store.load()).toBeNull();
  });

  it('returns null when payload is not an object', async () => {
    const store = new LocalStoragePreferenceStore(localStorage, new InMemoryAssetCacheAdapter());
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ payload: 'not-an-object', configHash: 'h1' }),
    );
    expect(await store.load()).toBeNull();
  });

  it('evicts preference-derived cache keys and returns them', async () => {
    const cache = new InMemoryAssetCacheAdapter(['theme:dark', 'badge:nba']);
    const store = new LocalStoragePreferenceStore(localStorage, cache);
    expect(await store.evictPreferenceDerivedCache()).toEqual(['theme:dark', 'badge:nba']);
    // Second eviction is empty — the keys are gone.
    expect(await store.evictPreferenceDerivedCache()).toEqual([]);
  });
});
