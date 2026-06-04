/**
 * SPEC-CRWDQ-014 #27 test support — real local-substitutable collaborators
 * (INV-16: no mocks of internal collaborators). Only the WS frame source and
 * the clock are substituted; the PreferenceStore, asset cache, apply slot,
 * and journal are real-behaviour doubles.
 */
import type { ConfigPushPayload } from '../../src/wire';
import type { PreferenceDerivedCache } from '../../src/config/PreferenceStore';
import type { ConfigJournal, ConfigPushJournalEvent } from '../../src/config/Journal';

/**
 * In-memory preference-derived asset cache implementing the same eviction
 * interface SPEC-CRWDQ-023 uses. Pre-seeded with keys so a replace returns a
 * non-empty evicted-key list.
 */
export class InMemoryAssetCacheAdapter implements PreferenceDerivedCache {
  private keys: string[];

  constructor(initialKeys: string[] = []) {
    this.keys = [...initialKeys];
  }

  async evictAll(): Promise<string[]> {
    const evicted = [...this.keys];
    this.keys = [];
    return evicted;
  }

  /** Re-seed keys (e.g. to assert a second replace evicts a fresh set). */
  seed(keys: string[]): void {
    this.keys = [...keys];
  }
}

/**
 * A preference-derived cache whose `evictAll` rejects — used to prove the
 * handler does NOT persist the durable config hash when eviction fails (so a
 * later identical re-push still re-attempts eviction + apply). This is a real
 * implementation of the cache port with an injected fault, not an internal
 * mock (INV-16): the WS source and clock remain the only substituted seams.
 */
export class FailingEvictCacheAdapter implements PreferenceDerivedCache {
  async evictAll(): Promise<string[]> {
    throw new Error('eviction failed');
  }
}

/** Records every journal event for assertion. */
export class MemoryJournal implements ConfigJournal {
  readonly events: ConfigPushJournalEvent[] = [];

  record(event: ConfigPushJournalEvent): void {
    this.events.push(event);
  }
}

/** Build a valid ConfigPushPayload, overriding any field for negative tests. */
export function makePayload(overrides: Partial<ConfigPushPayload> = {}): ConfigPushPayload {
  return {
    message_type: 'ConfigPush',
    schema_version: 1,
    ts: '2026-05-30T12:00:00Z',
    bar_id: 'bar-42',
    display_id: null,
    preferences: {
      theme: { state: 'set', id: 'dark_sport' },
      sports: ['nba', 'nfl'],
      leagues: ['nba'],
      region: 'NA',
      state: 'NY',
      city: 'New York',
      timezone: 'America/New_York',
      business_hours: [{ day_of_week: 'MON', open_local: '09:00', close_local: '23:30' }],
      local_team_list: ['knicks'],
      fallback_mode_order: ['single_game', 'ambient'],
    },
    cache_ceiling_bytes: 1_073_741_824,
    intervals: { journal_sync_ms: 60_000, heartbeat_ms: 15_000, manifest_recheck_ms: 300_000 },
    config_hash: 'hash-aaa',
    ...overrides,
  };
}
