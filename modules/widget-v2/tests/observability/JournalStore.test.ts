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
