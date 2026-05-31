/**
 * SPEC-CRWDQ-061 — JournalSyncClient (AC4, AC5, AC6, AC7, AC8, AC9).
 *
 * The client drains the JournalStore backlog into WS `JournalSync` frames over
 * the SPEC-CRWDQ-022 send path — never HTTP. It is driven by three triggers:
 * the periodic interval (AC6), a full-batch backlog (AC8), and a WS reconnect
 * (AC9). The store and the batching logic are REAL (INV-16); only the clock
 * (vitest fake timers) and the WsClient (FakeWsClient send + reconnect) are
 * substituted (INV-17).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JournalStore } from '../../src/observability/JournalStore';
import { JournalSyncClient } from '../../src/observability/JournalSyncClient';
import { isPlayerJournalEventType } from '../../src/observability/types';
import { FakeWsClient, resetJournalDb } from './support';

const display = { barId: 'bar-1', displayId: 'disp-1' };
const open: JournalStore[] = [];

async function freshStore(): Promise<JournalStore> {
  const store = new JournalStore(display);
  await store.ready();
  open.push(store);
  return store;
}

function clientFor(
  store: JournalStore,
  ws: FakeWsClient,
  cfg: {
    syncIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    retainMaxRows?: number;
    retainMaxAgeMs?: number;
  } = {},
): JournalSyncClient {
  return new JournalSyncClient({
    store,
    ws,
    identity: display,
    now: () => Date.now(),
    random: () => 0.5,
    config: {
      syncIntervalMs: cfg.syncIntervalMs ?? 60000,
      maxBatchSize: cfg.maxBatchSize ?? 500,
      maxBatchBytes: cfg.maxBatchBytes ?? 256 * 1024,
      retainMaxRows: cfg.retainMaxRows ?? 10000,
      retainMaxAgeMs: cfg.retainMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
    },
  });
}

// fake-indexeddb drives its async callbacks on setImmediate/queueMicrotask, so
// faking those would stall every store op. The interval/backoff tests fake
// ONLY the timer functions the client uses (setInterval/clearInterval/
// setTimeout), leaving the IndexedDB scheduling primitives real.
const TIMER_ONLY = ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

beforeEach(() => resetJournalDb());

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
  for (const store of open.splice(0)) store.close();
});

describe('JournalSyncClient sync frame (AC4, AC5, AC7)', () => {
  it('sends one JournalSync frame draining the backlog when the socket is open', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: { event: 'a' } });
    await store.append({ ts: 't2', event_type: 'dwell_timing', payload: { event: 'b' } });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws);

    const outcome = await client.syncNow();

    expect(outcome).toMatchObject({ kind: 'sent', seqMin: 1, seqMax: 2, rowCount: 2 });
    expect(ws.journalFrames()).toHaveLength(1);
  });

  it('builds the frame as a JournalSync envelope with the backend payload shape', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: { event: 'a' } });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws);

    await client.syncNow();
    const [frame] = ws.journalFrames();

    expect(frame).toMatchObject({
      message_type: 'JournalSync',
      bar_id: 'bar-1',
      display_id: 'disp-1',
      entries: [expect.objectContaining({ seq: 1, event_type: 'config_apply' })],
    });
  });

  it('only ever sends entries whose event_type is in the six-member enum (AC4)', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'heartbeat_ack', payload: {} });
    await store.append({ ts: 't2', event_type: 'transition_error', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws);

    await client.syncNow();
    const [frame] = ws.journalFrames();

    expect(frame?.entries.every((e) => isPlayerJournalEventType(e.event_type))).toBe(true);
  });

  it('retires the sent range so a second sync has nothing to send (AC7 fire-and-forget)', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws);

    await client.syncNow();
    const second = await client.syncNow();

    expect(second).toEqual({ kind: 'noop', reason: 'no_unsynced' });
  });

  it('is a noop with no fetch/send when there is no backlog', async () => {
    const store = await freshStore();
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws);

    const outcome = await client.syncNow();

    expect(outcome).toEqual({ kind: 'noop', reason: 'no_unsynced' });
    expect(ws.sent).toHaveLength(0);
  });
});

describe('JournalSyncClient batch byte cap (AC2)', () => {
  /** A ~1 KiB payload so a handful of rows cross a small byte budget. */
  const kib = (): Record<string, unknown> => ({ blob: 'x'.repeat(1024) });

  it('splits a burst that exceeds maxBatchBytes across successive frames', async () => {
    const store = await freshStore();
    for (const ts of ['t1', 't2', 't3', 't4']) {
      await store.append({ ts, event_type: 'config_apply', payload: kib() });
    }
    const ws = new FakeWsClient();
    ws.open();
    // ~2.5 KiB budget admits ~2 of the ~1 KiB rows per frame though maxBatchSize
    // would allow all four — the burst drains over two syncs.
    const client = clientFor(store, ws, { maxBatchSize: 500, maxBatchBytes: 2560 });

    const first = await client.syncNow();
    const second = await client.syncNow();

    expect(first).toMatchObject({ kind: 'sent', seqMin: 1, seqMax: 2 });
    expect(second).toMatchObject({ kind: 'sent', seqMin: 3, seqMax: 4 });
  });
});

describe('JournalSyncClient retention after send (AC1)', () => {
  it('prunes sent rows beyond the row cap after a successful sync', async () => {
    const store = await freshStore();
    for (const ts of ['t1', 't2', 't3', 't4', 't5']) {
      await store.append({ ts, event_type: 'config_apply', payload: {} });
    }
    const ws = new FakeWsClient();
    ws.open();
    // One sync sends all 5 (maxBatchSize 500); retention keeps only the newest 2.
    const client = clientFor(store, ws, { retainMaxRows: 2 });

    await client.syncNow();

    expect(store.sentSeqs()).toEqual([4, 5]);
  });

  it('does not prune anything when a sync is a noop (nothing sent)', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { retainMaxRows: 1 });

    await client.syncNow(); // sends seq 1, retainMaxRows 1 keeps it
    const second = await client.syncNow(); // noop — no further prune

    expect(second).toEqual({ kind: 'noop', reason: 'no_unsynced' });
    expect(store.sentSeqs()).toEqual([1]);
  });
});

describe('JournalSyncClient periodic loop (AC6)', () => {
  /** Flush the real microtask queue the async sync runs on. */
  const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

  it('sends a frame on the interval tick without an explicit syncNow', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { syncIntervalMs: 60000 });

    vi.useFakeTimers({ toFake: [...TIMER_ONLY] });
    client.start();
    await vi.advanceTimersByTimeAsync(60000);
    client.stop();

    expect(ws.journalFrames()).toHaveLength(1);
  });

  it('does not tick before the interval elapses', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { syncIntervalMs: 60000 });

    vi.useFakeTimers({ toFake: [...TIMER_ONLY] });
    client.start();
    await vi.advanceTimersByTimeAsync(59999);
    client.stop();

    expect(ws.journalFrames()).toHaveLength(0);
  });

  it('honors a shorter interval after updateInterval (ConfigPush arrival)', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { syncIntervalMs: 60000 });

    vi.useFakeTimers({ toFake: [...TIMER_ONLY] });
    client.start();
    client.updateInterval(30000);
    await vi.advanceTimersByTimeAsync(30000);
    client.stop();

    expect(ws.journalFrames()).toHaveLength(1);
    await flush();
  });
});

describe('JournalSyncClient backlog trigger (AC8)', () => {
  it('fires a sync immediately when the backlog reaches maxBatchSize', async () => {
    const store = await freshStore();
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { syncIntervalMs: 60000, maxBatchSize: 2 });

    // Two appends fill the batch; onAppended (the emit-path hook) should drain
    // it now rather than wait the full 60s interval.
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    await store.append({ ts: 't2', event_type: 'dwell_timing', payload: {} });
    await client.onAppended();

    expect(ws.journalFrames()).toHaveLength(1);
  });

  it('does not fire below maxBatchSize', async () => {
    const store = await freshStore();
    const ws = new FakeWsClient();
    ws.open();
    const client = clientFor(store, ws, { syncIntervalMs: 60000, maxBatchSize: 3 });

    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    await client.onAppended();

    expect(ws.journalFrames()).toHaveLength(0);
  });
});

describe('JournalSyncClient connectivity trigger + failure handling (AC9)', () => {
  it('drains the backlog after a reconnect completes (open fires post-reopen)', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    const client = clientFor(store, ws);
    void client; // subscription wired in the constructor

    // Real lifecycle order: reconnect fires while still closed, then open once
    // the socket is actually OPEN. Draining must happen on open, not reconnect.
    ws.reconnectThenOpen();
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.journalFrames()).toHaveLength(1);
  });

  it('does NOT drain on reconnect while the socket is still closed', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient(); // stays closed
    const client = clientFor(store, ws);
    void client;

    ws.emit('reconnect', { attempt: 1 }); // real client emits this while closed
    await Promise.resolve();
    await Promise.resolve();

    // Nothing sent: a drain here would have deferred as ws_not_open.
    expect(ws.journalFrames()).toHaveLength(0);
  });

  it('defers and keeps the backlog when the socket is not open', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient(); // never opened
    const client = clientFor(store, ws);

    const outcome = await client.syncNow();

    expect(outcome).toEqual({ kind: 'deferred', reason: 'ws_not_open' });
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(1);
  });

  it('fails with a capped jittered backoff and keeps the backlog when send throws', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    ws.failNextSend();
    const client = clientFor(store, ws); // random() = 0.5

    const outcome = await client.syncNow();

    // First failure: cap = 60_000 * 2^1 = 120_000; full-jitter at random()=0.5
    // => 60_000.
    expect(outcome).toEqual({ kind: 'failed', reason: 'ws_send_error', retryInMs: 60000 });
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(1);
  });

  it('never loses entries: a later successful sync drains what a failed one left', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    ws.failNextSend();
    const client = clientFor(store, ws);

    await client.syncNow(); // fails, entry stays
    const retry = await client.syncNow(); // succeeds

    expect(retry).toMatchObject({ kind: 'sent', seqMin: 1, seqMax: 1, rowCount: 1 });
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(0);
  });

  it('arms a backoff timer that retries the failed batch after the jittered delay', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    ws.failNextSend(); // first send throws; the retry (timer-driven) succeeds
    const client = clientFor(store, ws); // random()=0.5 => retryInMs 60_000

    vi.useFakeTimers({ toFake: [...TIMER_ONLY] });
    const outcome = await client.syncNow();
    expect(outcome).toMatchObject({ kind: 'failed', retryInMs: 60000 });
    expect(ws.journalFrames()).toHaveLength(0);

    // Before the delay elapses nothing retries; the armed timer fires at 60s.
    await vi.advanceTimersByTimeAsync(59999);
    expect(ws.journalFrames()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(ws.journalFrames()).toHaveLength(1);
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(0);
  });

  it('does not stack timers: a manual sync supersedes a pending backoff retry', async () => {
    const store = await freshStore();
    await store.append({ ts: 't1', event_type: 'config_apply', payload: {} });
    const ws = new FakeWsClient();
    ws.open();
    ws.failNextSend();
    const client = clientFor(store, ws);

    vi.useFakeTimers({ toFake: [...TIMER_ONLY] });
    await client.syncNow(); // fails, arms a retry timer
    await client.syncNow(); // succeeds now, cancelling the pending timer
    expect(ws.journalFrames()).toHaveLength(1);

    // The cancelled timer must not fire a second (empty) drain later.
    await vi.advanceTimersByTimeAsync(120000);
    expect(ws.journalFrames()).toHaveLength(1);
  });
});
