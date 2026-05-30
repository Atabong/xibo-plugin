/**
 * SPEC-CRWDQ-014 #27 — persistent bar-preferences store (AC7).
 *
 * LocalStorage is chosen over IndexedDB (D-GRH-60 rationale): the payload is
 * < 4 KB and the synchronous boot read avoids a frame of empty preferences
 * before the WS opens. The persisted value is the ENTIRE ConfigPushPayload
 * (preferences + config_hash + cache_ceiling_bytes + intervals) plus the
 * server-supplied `configHash`, JSON-encoded as `{ payload, configHash }`.
 *
 * Preference-derived cache state lives in a separate adapter (the asset
 * cache); `evictPreferenceDerivedCache` delegates to it and returns the
 * evicted keys for journaling (D-GRH-60).
 */
import type { ConfigPushPayload } from '../wire';
import type { PreferenceSnapshot } from './types';

/** LocalStorage key holding the JSON-encoded snapshot. */
export const PREFERENCES_STORAGE_KEY = 'crowdaq.widgetV2.barPreferences';

/**
 * The preference-derived cache surface the store evicts on a config change.
 * Implemented by SPEC-CRWDQ-023's real asset cache in production and by the
 * `InMemoryAssetCacheAdapter` test double in unit tests (same interface — no
 * internal mock per INV-16).
 */
export interface PreferenceDerivedCache {
  /** Drop every preference-derived entry; return the evicted keys. */
  evictAll(): Promise<string[]>;
}

export interface PreferenceStore {
  load(): Promise<PreferenceSnapshot | null>;
  save(snapshot: PreferenceSnapshot): Promise<void>;
  /** Evict preference-derived cache; returns evicted keys for journaling. */
  evictPreferenceDerivedCache(): Promise<string[]>;
}

/** LocalStorage-backed {@link PreferenceStore}. */
export class LocalStoragePreferenceStore implements PreferenceStore {
  constructor(
    private readonly storage: Storage,
    private readonly cache: PreferenceDerivedCache,
  ) {}

  async load(): Promise<PreferenceSnapshot | null> {
    const raw = this.storage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt blob is indistinguishable from "no snapshot" for the
      // caller's purposes — return null and let the next push repopulate.
      return null;
    }
    // Validate the stored shape before trusting it: a malformed LocalStorage
    // value (hand-edited, a stale older schema, a wrong-typed configHash) is
    // treated as "no snapshot" rather than cast blindly into the type system.
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const { payload, configHash } = record;
    if (typeof configHash !== 'string' || configHash.length === 0) return null;
    if (typeof payload !== 'object' || payload === null) return null;
    return { payload: payload as ConfigPushPayload, configHash };
  }

  async save(snapshot: PreferenceSnapshot): Promise<void> {
    this.storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(snapshot));
  }

  async evictPreferenceDerivedCache(): Promise<string[]> {
    return this.cache.evictAll();
  }
}
