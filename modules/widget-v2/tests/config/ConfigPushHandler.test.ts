/**
 * SPEC-CRWDQ-014 #27 — ConfigPushHandler behaviour (AC2-AC10).
 *
 * INV-16: no internal-collaborator mocks. The handler is wired to a real
 * LocalStoragePreferenceStore (jsdom LocalStorage), a real InMemoryAssetCache
 * Adapter, a real PendingApplySlot, and a real MemoryJournal. Only the WS
 * source is substituted — frames are fed to `handle(...)` directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigPushHandler } from '../../src/config/ConfigPushHandler';
import { LocalStoragePreferenceStore } from '../../src/config/PreferenceStore';
import { PendingApplySlot } from '../../src/config/ApplyPreferenceState';
import {
  InMemoryAssetCacheAdapter,
  FailingEvictCacheAdapter,
  MemoryJournal,
  makePayload,
} from './support';

function wire(cacheKeys: string[] = ['theme:prev', 'badge:prev']) {
  const cache = new InMemoryAssetCacheAdapter(cacheKeys);
  const store = new LocalStoragePreferenceStore(localStorage, cache);
  const apply = new PendingApplySlot();
  const journal = new MemoryJournal();
  const handler = new ConfigPushHandler(store, apply, journal);
  return { cache, store, apply, journal, handler };
}

describe('ConfigPushHandler', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('AC2 — total handler, never throws', () => {
    it('returns a ConfigPushOutcome for arbitrary garbage and never throws', async () => {
      const { handler } = wire();
      for (const garbage of [null, undefined, 42, 'frame', [], {}, { message_type: 'Other' }]) {
        const outcome = await handler.handle(garbage);
        expect(outcome.kind).toBe('rejected');
      }
    });
  });

  describe('AC8 — first push', () => {
    it('persists, evicts, queues one apply, journals applied:true', async () => {
      const { handler, store, apply, journal, cache } = wire();
      const payload = makePayload();

      const outcome = await handler.handle(payload);

      expect(outcome.kind).toBe('first_push');
      const persisted = await store.load();
      expect(persisted?.configHash).toBe(payload.config_hash);
      expect(apply.hasPending()).toBe(true);
      expect(apply.takePending()).toEqual(payload.preferences);
      // Cache was evicted (now empty).
      expect(await cache.evictAll()).toEqual([]);
      expect(journal.events).toHaveLength(1);
      expect(journal.events[0]).toMatchObject({
        type: 'config_push_received',
        accepted: true,
        applied: true,
        configHash: payload.config_hash,
        evictedKeys: ['theme:prev', 'badge:prev'],
      });
    });
  });

  describe('AC8 — hash-match push', () => {
    it('performs zero writes/evictions/applies and journals hash_match once', async () => {
      const { handler, store, apply, journal, cache } = wire();
      const payload = makePayload();
      await handler.handle(payload); // first push primes the store

      // Re-seed the cache so we can prove the second push does not evict.
      cache.seed(['should-not-be-evicted']);
      apply.takePending(); // drain the first apply
      const writesBefore = localStorage.getItem('crowdaq.widgetV2.barPreferences');

      const outcome = await handler.handle(makePayload()); // same hash

      expect(outcome).toEqual({ kind: 'unchanged', configHash: payload.config_hash });
      expect(localStorage.getItem('crowdaq.widgetV2.barPreferences')).toBe(writesBefore);
      expect(apply.hasPending()).toBe(false);
      expect(await cache.evictAll()).toEqual(['should-not-be-evicted']); // not evicted by handler
      expect(journal.events).toHaveLength(2);
      expect(journal.events[1]).toEqual({
        type: 'config_push_received',
        accepted: true,
        applied: false,
        configHash: payload.config_hash,
        reason: 'hash_match',
      });
      void store;
    });
  });

  describe('AC8 — hash-different push', () => {
    it('persists new snapshot, evicts, queues apply, returns evictedKeys', async () => {
      const { handler, store, apply, journal, cache } = wire(['k1', 'k2']);
      await handler.handle(makePayload({ config_hash: 'hash-aaa' }));
      apply.takePending();
      cache.seed(['k3', 'k4']);

      const next = makePayload({ config_hash: 'hash-bbb' });
      const outcome = await handler.handle(next);

      expect(outcome).toMatchObject({
        kind: 'replaced',
        previousHash: 'hash-aaa',
        configHash: 'hash-bbb',
        evictedKeys: ['k3', 'k4'],
      });
      // S83 / D-GRH-73: a `replaced` outcome carries the freshly-applied
      // preferences so an EDIT (e.g. a new timezone) reaches the render-side
      // lastPrefs capture and reformats the live fixtures board.
      expect(outcome).toHaveProperty('preferences', next.preferences);
      expect((await store.load())?.configHash).toBe('hash-bbb');
      expect(apply.hasPending()).toBe(true);
      expect(journal.events[1]).toMatchObject({
        accepted: true,
        applied: true,
        configHash: 'hash-bbb',
        evictedKeys: ['k3', 'k4'],
      });
    });
  });

  describe('AC3 — schema-invalid', () => {
    it('rejects a missing field (no timezone) without writing', async () => {
      const { handler, store, journal } = wire();
      const payload = makePayload();
      const broken = JSON.parse(JSON.stringify(payload));
      delete broken.preferences.timezone;

      const outcome = await handler.handle(broken);

      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
      expect(await store.load()).toBeNull();
      expect(journal.events[0]).toMatchObject({ accepted: false, rejectReason: 'schema_invalid' });
    });

    it('rejects an extra field on preferences', async () => {
      const { handler } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      broken.preferences.surprise = true;
      expect((await handler.handle(broken)).kind).toBe('rejected');
      expect(await handler.handle(broken)).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects an extra top-level payload field', async () => {
      const { handler } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      broken.rogue = 1;
      expect(await handler.handle(broken)).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });
  });

  describe('D-GRH-75 — intervals closed three-field shape', () => {
    it('accepts the journal_sync_ms + heartbeat_ms + manifest_recheck_ms triple', async () => {
      const { handler } = wire();
      const outcome = await handler.handle(
        makePayload({
          intervals: { journal_sync_ms: 60_000, heartbeat_ms: 15_000, manifest_recheck_ms: 300_000 },
        }),
      );
      expect(outcome.kind).toBe('first_push');
    });

    it('rejects a two-field intervals missing manifest_recheck_ms as schema_invalid', async () => {
      const { handler } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      delete broken.intervals.manifest_recheck_ms;
      expect(await handler.handle(broken)).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects an extra interval field as schema_invalid', async () => {
      const { handler } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      broken.intervals.surprise_ms = 1;
      expect(await handler.handle(broken)).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });
  });

  describe('AC4 — theme three-state + coupling', () => {
    it('accepts all three valid theme states', async () => {
      for (const theme of [{ state: 'set', id: 'dark' }, { state: 'default' }, { state: 'unset' }]) {
        localStorage.clear();
        const { handler } = wire();
        const outcome = await handler.handle(
          makePayload({ preferences: { ...makePayload().preferences, theme } as never }),
        );
        expect(outcome.kind).toBe('first_push');
      }
    });

    it('rejects a non-object theme as schema_invalid', async () => {
      const { handler } = wire();
      const outcome = await handler.handle(
        makePayload({ preferences: { ...makePayload().preferences, theme: 'dark' } as never }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects a state outside the enum as schema_invalid', async () => {
      const { handler } = wire();
      const outcome = await handler.handle(
        makePayload({ preferences: { ...makePayload().preferences, theme: { state: 'maybe' } } as never }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects set without a non-empty id as theme_coupling_invalid', async () => {
      const { handler } = wire();
      const outcome = await handler.handle(
        makePayload({ preferences: { ...makePayload().preferences, theme: { state: 'set', id: '' } } as never }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'theme_coupling_invalid' });
    });

    it('rejects default/unset carrying an id as theme_coupling_invalid', async () => {
      for (const theme of [{ state: 'default', id: 'x' }, { state: 'unset', id: 'x' }]) {
        const { handler } = wire();
        const outcome = await handler.handle(
          makePayload({ preferences: { ...makePayload().preferences, theme } as never }),
        );
        expect(outcome).toEqual({ kind: 'rejected', reason: 'theme_coupling_invalid' });
      }
    });
  });

  describe('AC5 — timezone + business_hours + fallback_mode_order', () => {
    it('rejects an invalid IANA timezone', async () => {
      const { handler } = wire();
      const outcome = await handler.handle(
        makePayload({ preferences: { ...makePayload().preferences, timezone: 'Mars/Olympus' } }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'timezone_invalid_iana' });
    });

    it('rejects a day_of_week outside MON..SUN', async () => {
      const { handler } = wire();
      const prefs = makePayload().preferences;
      const outcome = await handler.handle(
        makePayload({
          preferences: {
            ...prefs,
            business_hours: [{ day_of_week: 'mon' as never, open_local: '09:00', close_local: '17:00' }],
          },
        }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects a malformed open_local time', async () => {
      const { handler } = wire();
      const prefs = makePayload().preferences;
      const outcome = await handler.handle(
        makePayload({
          preferences: {
            ...prefs,
            business_hours: [{ day_of_week: 'MON', open_local: '9:00', close_local: '17:00' }],
          },
        }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('rejects a fallback_mode_order member outside BusinessMode', async () => {
      const { handler } = wire();
      const prefs = makePayload().preferences;
      const outcome = await handler.handle(
        makePayload({ preferences: { ...prefs, fallback_mode_order: ['single_game', 'nope' as never] } }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'schema_invalid' });
    });

    it('accepts null region/state/city', async () => {
      const { handler } = wire();
      const prefs = makePayload().preferences;
      const outcome = await handler.handle(
        makePayload({ preferences: { ...prefs, region: null, state: null, city: null } }),
      );
      expect(outcome.kind).toBe('first_push');
    });
  });

  describe('AC6 — config_hash missing', () => {
    it('rejects an absent config_hash', async () => {
      const { handler } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      delete broken.config_hash;
      expect(await handler.handle(broken)).toEqual({ kind: 'rejected', reason: 'config_hash_missing' });
    });

    it('rejects an empty config_hash', async () => {
      const { handler } = wire();
      expect(await handler.handle(makePayload({ config_hash: '' }))).toEqual({
        kind: 'rejected',
        reason: 'config_hash_missing',
      });
    });
  });

  describe('reject journaling — configHash null only when unparseable', () => {
    it('journals the carried hash on a downstream reject (timezone) that has a valid config_hash', async () => {
      const { handler, journal } = wire();
      const outcome = await handler.handle(
        makePayload({
          config_hash: 'hash-zzz',
          preferences: { ...makePayload().preferences, timezone: 'Mars/Olympus' },
        }),
      );
      expect(outcome).toEqual({ kind: 'rejected', reason: 'timezone_invalid_iana' });
      expect(journal.events[0]).toMatchObject({
        accepted: false,
        rejectReason: 'timezone_invalid_iana',
        configHash: 'hash-zzz',
      });
    });

    it('journals configHash null when config_hash is genuinely absent', async () => {
      const { handler, journal } = wire();
      const broken = JSON.parse(JSON.stringify(makePayload()));
      delete broken.config_hash;
      await handler.handle(broken);
      expect(journal.events[0]).toMatchObject({ accepted: false, configHash: null });
    });
  });

  describe('AC8 — reconnect idempotency', () => {
    it('two identical-hash re-pushes yield exactly two journal entries and zero extra writes', async () => {
      const { handler, journal } = wire();
      await handler.handle(makePayload()); // first push (write #1)
      const afterFirst = localStorage.getItem('crowdaq.widgetV2.barPreferences');

      await handler.handle(makePayload()); // re-push 1 (no-op)
      await handler.handle(makePayload()); // re-push 2 (no-op)

      expect(journal.events).toHaveLength(3);
      expect(journal.events.filter((e) => e.reason === 'hash_match')).toHaveLength(2);
      expect(localStorage.getItem('crowdaq.widgetV2.barPreferences')).toBe(afterFirst);
    });
  });

  describe('AC9 — supersede on second queueApply before a boundary', () => {
    it('records superseded_by for the prior pending hash and keeps a single slot', async () => {
      const { handler, apply, journal } = wire();
      await handler.handle(makePayload({ config_hash: 'h1' })); // queues apply for h1
      // No boundary read happened: a second distinct push supersedes h1.
      const next = makePayload({ config_hash: 'h2' });
      await handler.handle(next);

      // Single slot — only the latest preferences are pending.
      expect(apply.hasPending()).toBe(true);
      expect(apply.takePending()).toEqual(next.preferences);
      expect(apply.hasPending()).toBe(false);

      // First push had no prior pending → no supersededBy; second push does.
      expect(journal.events[0]?.supersededBy).toBeUndefined();
      expect(journal.events[1]?.supersededBy).toBe('h1');
    });

    it('does NOT supersede once the render loop drained the slot before the next push', async () => {
      const { handler, apply, journal } = wire();
      await handler.handle(makePayload({ config_hash: 'h1' })); // queues apply for h1
      apply.takePending(); // render loop reads at a dwell boundary — slot drained
      expect(apply.hasPending()).toBe(false);

      // A later distinct push finds no pending apply: nothing to supersede.
      await handler.handle(makePayload({ config_hash: 'h2' }));

      expect(journal.events[1]?.supersededBy).toBeUndefined();
      expect(apply.hasPending()).toBe(true);
    });
  });

  describe('hash persisted only after eviction + queueApply succeed', () => {
    it('does not persist the hash when eviction rejects, so a re-push still applies', async () => {
      const cache = new FailingEvictCacheAdapter();
      const store = new LocalStoragePreferenceStore(localStorage, cache);
      const apply = new PendingApplySlot();
      const journal = new MemoryJournal();
      const handler = new ConfigPushHandler(store, apply, journal);

      // Eviction throws inside the apply path; the total handler reports
      // rejected but MUST NOT have persisted the durable hash.
      const outcome = await handler.handle(makePayload({ config_hash: 'h1' }));
      expect(outcome.kind).toBe('rejected');
      expect(await store.load()).toBeNull();

      // Because nothing was persisted, an identical re-push does not hash-match
      // — it re-enters the apply path rather than being silently skipped.
      const second = await handler.handle(makePayload({ config_hash: 'h1' }));
      expect(second.kind).toBe('rejected'); // still fails eviction, but DID try
      expect(await store.load()).toBeNull();
    });
  });
});
