/**
 * SPEC-CRWDQ-061 — emit() bucket adapter (AC3, AC4).
 *
 * `emit(internalEvent, payload)` is the shared surface every template calls.
 * It maps the fine-grained internal event name to one of the six closed-set
 * buckets via the fixed table, preserves the fine name in `payload.event`,
 * and appends through a REAL JournalStore (INV-16). It must never throw —
 * journaling is best-effort and must not break a render path.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JournalStore } from '../../src/observability/JournalStore';
import { JournalSyncClient } from '../../src/observability/JournalSyncClient';
import { Observer } from '../../src/observability/index';
import { isPlayerJournalEventType } from '../../src/observability/types';
import { FakeWsClient, resetJournalDb } from './support';

const display = { barId: 'bar-1', displayId: 'disp-1' };
const open: JournalStore[] = [];

async function freshObserver(): Promise<{ observer: Observer; store: JournalStore }> {
  const store = new JournalStore(display);
  await store.ready();
  open.push(store);
  return { observer: new Observer(store, () => '2026-05-30T00:00:00.000Z'), store };
}

afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

describe('Observer.emit', () => {
  beforeEach(() => resetJournalDb());

  it('buckets a fine-grained event into one of the six closed-set types', async () => {
    const { observer, store } = await freshObserver();

    await observer.emit('planned_state_activated', { from: 'a', to: 'b' });
    const [row] = store.unsynced({ maxRows: 10 });

    expect(row?.event_type).toBe('planned_state_render');
    expect(isPlayerJournalEventType(row?.event_type)).toBe(true);
  });

  it('preserves the fine-grained event name under payload.event', async () => {
    const { observer, store } = await freshObserver();

    await observer.emit('dwell_boundary_reached', { target_ms: 5000 });
    const [row] = store.unsynced({ maxRows: 10 });

    expect(row?.payload).toMatchObject({ event: 'dwell_boundary_reached', target_ms: 5000 });
  });

  it('never throws when the durable append fails', async () => {
    const { observer } = await freshObserver();
    // A payload carrying a function is not structured-cloneable, so the real
    // IndexedDB put rejects with a DataCloneError — a genuine store-boundary
    // failure. emit must swallow it and still resolve (best-effort, AC3).
    const payload = { cb: () => undefined } as unknown as Record<string, unknown>;

    await expect(observer.emit('config_push_received', payload)).resolves.toBeUndefined();
  });

  it('maps an unknown fine-grained event to a safe default bucket', async () => {
    const { observer, store } = await freshObserver();

    await observer.emit('some_event_not_in_the_table', {});
    const [row] = store.unsynced({ maxRows: 10 });

    expect(isPlayerJournalEventType(row?.event_type)).toBe(true);
  });

  it('drains immediately at maxBatchSize when a burst arrives via the emit path (AC8)', async () => {
    const store = new JournalStore(display);
    await store.ready();
    open.push(store);
    const ws = new FakeWsClient();
    ws.open();
    // Real JournalSyncClient (INV-16): the Observer pokes its onAppended hook.
    const client = new JournalSyncClient({
      store,
      ws,
      identity: display,
      now: () => Date.now(),
      random: () => 0.5,
      config: {
        syncIntervalMs: 60000,
        maxBatchSize: 2,
        retainMaxRows: 10000,
        retainMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
      },
    });
    const observer = new Observer(store, () => '2026-05-30T00:00:00.000Z', client);

    // Two emits fill the batch; the SECOND must trigger an immediate drain
    // through the shared emit path — not wait for the 60s interval.
    await observer.emit('config_push_received', {});
    await observer.emit('dwell_boundary_reached', {});
    // emit fires onAppended fire-and-forget; let its async sync (incl. the
    // IndexedDB markSent put) settle on a macrotask before asserting.
    await new Promise((r) => setTimeout(r, 0));

    expect(ws.journalFrames()).toHaveLength(1);
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(0);
  });
});
