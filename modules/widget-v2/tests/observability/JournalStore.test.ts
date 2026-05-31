/**
 * SPEC-CRWDQ-061 — JournalStore behaviour (AC1, AC2).
 *
 * Runs against a REAL IndexedDB: `fake-indexeddb/auto` installs an in-process
 * engine as the global `indexedDB`, so the store's open / put / cursor path
 * executes unmodified (INV-FACTORY-16: the store is never mocked; INV-17:
 * IndexedDB is the one substituted boundary here).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JournalStore } from '../../src/observability/JournalStore';
import { resetJournalDb } from './support';

const display = { barId: 'bar-1', displayId: 'disp-1' };

const open: JournalStore[] = [];

async function freshStore(): Promise<JournalStore> {
  const store = new JournalStore(display);
  await store.ready();
  open.push(store);
  return store;
}

afterEach(() => {
  // Release every connection a test opened so the next `resetJournalDb`
  // (deleteDatabase) is not blocked by a held-open db.
  for (const store of open.splice(0)) store.close();
});

describe('JournalStore.append', () => {
  beforeEach(() => resetJournalDb());

  it('assigns seq 1 to the first appended entry and returns it', async () => {
    const store = await freshStore();

    const seq = await store.append({
      ts: '2026-05-30T00:00:00.000Z',
      event_type: 'config_apply',
      payload: { event: 'config_push_received' },
    });

    expect(seq).toBe(1);
  });

  it('stamps every row with the store-bound bar_id and display_id', async () => {
    const store = await freshStore();

    await store.append({
      ts: '2026-05-30T00:00:00.000Z',
      event_type: 'heartbeat_ack',
      payload: {},
    });
    const [row] = store.unsynced({ maxRows: 10 });

    expect(row).toMatchObject({ bar_id: 'bar-1', display_id: 'disp-1', event_type: 'heartbeat_ack' });
  });
});

describe('JournalStore seq across reloads (AC2)', () => {
  beforeEach(() => resetJournalDb());

  it('continues the seq from the highest stored value after a reload', async () => {
    const first = new JournalStore(display);
    await first.ready();
    open.push(first);
    await first.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    await first.append({ ts: 't2', event_type: 'dwell_timing', payload: {} });
    first.close();

    // A fresh store over the same database = a widget reload.
    const reloaded = new JournalStore(display);
    await reloaded.ready();
    open.push(reloaded);
    const next = await reloaded.append({ ts: 't3', event_type: 'heartbeat_ack', payload: {} });

    expect(next).toBe(3);
  });

  it('recovers the unsynced backlog from durable rows after a reload', async () => {
    const first = new JournalStore(display);
    await first.ready();
    open.push(first);
    await first.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    await first.append({ ts: 't2', event_type: 'dwell_timing', payload: {} });
    first.close();

    const reloaded = new JournalStore(display);
    await reloaded.ready();
    open.push(reloaded);

    expect(reloaded.unsynced({ maxRows: 10 }).map((r) => r.seq)).toEqual([1, 2]);
  });

  it('resets in-memory seq + backlog on close so a re-open matches durable state', async () => {
    const store = new JournalStore(display);
    await store.ready();
    open.push(store);
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    store.close();

    // Re-ready the SAME instance: bootstrap must rebuild purely from durable
    // rows (one row, seq=1), not stack on top of the pre-close mirror.
    await store.ready();

    expect(store.unsynced({ maxRows: 10 }).map((r) => r.seq)).toEqual([1]);
    const next = await store.append({ ts: 't2', event_type: 'dwell_timing', payload: {} });
    expect(next).toBe(2);
  });
});

describe('JournalStore.prune retention (AC1)', () => {
  beforeEach(() => resetJournalDb());

  /** Append `n` rows and immediately mark them all sent, returning the seqs. */
  async function appendAndSend(store: JournalStore, tsList: string[]): Promise<void> {
    for (const ts of tsList) {
      await store.append({ ts, event_type: 'config_apply', payload: {} });
    }
    await store.markSent(1, tsList.length);
  }

  it('prunes the oldest sent rows beyond the row cap, keeping the newest', async () => {
    const store = await freshStore();
    await appendAndSend(store, ['t1', 't2', 't3', 't4', 't5']);

    const { pruned } = await store.prune({ maxRows: 2, maxAgeMs: Number.MAX_SAFE_INTEGER });

    // 5 sent rows, cap 2 → the 3 oldest are pruned; a reload sees only seq 4,5.
    expect(pruned).toBe(3);
    store.close();
    await store.ready();
    expect(store.sentSeqs()).toEqual([4, 5]);
  });

  it('prunes sent rows older than the age cap by their ts', async () => {
    const store = await freshStore();
    // Three sent rows at fixed wall-clock instants spanning ~2 minutes.
    await appendAndSend(store, [
      '2026-05-30T00:00:00.000Z',
      '2026-05-30T00:01:00.000Z',
      '2026-05-30T00:02:00.000Z',
    ]);

    // "now" = 00:02:00; keep only rows within the last 90s → the 00:00:00 row
    // (120s old) is pruned, the two newer ones survive.
    const now = Date.parse('2026-05-30T00:02:00.000Z');
    const { pruned } = await store.prune({ maxRows: Number.MAX_SAFE_INTEGER, maxAgeMs: 90_000, now });

    expect(pruned).toBe(1);
    store.close();
    await store.ready();
    expect(store.sentSeqs()).toEqual([2, 3]);
  });

  it('never prunes unsynced rows even when they exceed the caps', async () => {
    const store = await freshStore();
    // Five rows appended, NONE marked sent — all are unsynced.
    for (const ts of ['t1', 't2', 't3', 't4', 't5']) {
      await store.append({ ts, event_type: 'config_apply', payload: {} });
    }

    const { pruned } = await store.prune({ maxRows: 1, maxAgeMs: 0 });

    // Unsynced rows are uncapped (D-GRH-29) — nothing is pruned.
    expect(pruned).toBe(0);
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(5);
  });
});

describe('JournalStore per-display isolation (AC2)', () => {
  const dispA = { barId: 'bar-1', displayId: 'disp-A' };
  const dispB = { barId: 'bar-1', displayId: 'disp-B' };

  beforeEach(async () => {
    await resetJournalDb('disp-A');
    await resetJournalDb('disp-B');
  });

  it('keeps independent monotonic seq lines for two displays on one origin', async () => {
    const a = new JournalStore(dispA);
    const b = new JournalStore(dispB);
    await a.ready();
    await b.ready();
    open.push(a, b);

    const a1 = await a.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const b1 = await b.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const a2 = await a.append({ ts: 't2', event_type: 'dwell_timing', payload: {} });

    // Both start at seq=1 without colliding; each advances on its own line.
    expect([a1, a2]).toEqual([1, 2]);
    expect(b1).toBe(1);
    expect(a.unsynced({ maxRows: 10 }).map((r) => r.display_id)).toEqual(['disp-A', 'disp-A']);
    expect(b.unsynced({ maxRows: 10 }).map((r) => r.display_id)).toEqual(['disp-B']);
  });
});
