/**
 * SPEC-CRWDQ-S105 — widget ad-impression emit.
 *
 * The {@link ImpressionEmitter} is the RenderJournal decorator that turns an
 * `ad_slot_rendered` render event into a durable journal row (which the
 * JournalSyncClient drains to the backend over the WS). It must:
 *  - forward EVERY render event to the inner sink (the console breadcrumb);
 *  - emit exactly ONE impression row per `ad_slot_rendered`, bucketed to a
 *    closed-set `event_type` with `payload.event = 'ad_slot_rendered'` + the ad
 *    fields the backend meters on (ad_ref/ad_slot_id/state_id/shown_at);
 *  - NOT emit an impression for any other render event;
 *  - never block the render path (best-effort).
 *
 * REAL JournalStore + Observer (INV-16); only IndexedDB is the substituted
 * boundary (fake-indexeddb) and the clock is injected.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JournalStore } from '../../src/observability/JournalStore';
import { Observer } from '../../src/observability/index';
import { ImpressionEmitter } from '../../src/observability/ImpressionEmitter';
import type { RenderJournal, RenderJournalEntry } from '../../src/render/RenderJournal';
import { resetJournalDb } from './support';

const display = { barId: 'bar-1', displayId: 'disp-1' };
const open: JournalStore[] = [];

class RecordingInner implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

async function freshEmitter(): Promise<{
  emitter: ImpressionEmitter;
  store: JournalStore;
  inner: RecordingInner;
}> {
  const store = new JournalStore(display);
  await store.ready();
  open.push(store);
  const observer = new Observer(store, () => '2026-06-08T12:00:00.000Z');
  const inner = new RecordingInner();
  const emitter = new ImpressionEmitter({
    inner,
    observer,
    now: () => new Date('2026-06-08T12:00:00.000Z'),
  });
  return { emitter, store, inner };
}

afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

describe('ImpressionEmitter', () => {
  beforeEach(() => resetJournalDb());

  it('forwards every render event to the inner sink', async () => {
    const { emitter, inner } = await freshEmitter();
    emitter.record({ type: 'dwell_boundary_reached', target_ms: 5000 });
    emitter.record({ type: 'ad_slot_rendered', ad_ref: 'creative-1', ad_slot_id: 'ad-1', state_id: 'st-1' });
    expect(inner.entries.map((e) => e.type)).toEqual([
      'dwell_boundary_reached',
      'ad_slot_rendered',
    ]);
  });

  it('emits exactly one impression journal row per ad_slot_rendered', async () => {
    const { emitter, store } = await freshEmitter();
    emitter.record({ type: 'ad_slot_rendered', ad_ref: 'creative-7', ad_slot_id: 'ad-7', state_id: 'st-9' });
    // Let the async append flush.
    await new Promise((r) => setTimeout(r, 0));

    const rows = store.unsynced({ maxRows: 10 });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // Bucketed to a closed-set event_type the backend ingest accepts.
    expect(row.event_type).toBe('planned_state_render');
    // The backend meters on payload.event + ad_ref.
    expect(row.payload).toMatchObject({
      event: 'ad_slot_rendered',
      ad_ref: 'creative-7',
      ad_slot_id: 'ad-7',
      state_id: 'st-9',
      shown_at: '2026-06-08T12:00:00.000Z',
    });
    // Identity is stamped from the store's bound bar/display.
    expect(row.bar_id).toBe('bar-1');
    expect(row.display_id).toBe('disp-1');
  });

  it('does NOT emit an impression for a non-ad render event', async () => {
    const { emitter, store } = await freshEmitter();
    emitter.record({ type: 'dwell_boundary_reached', target_ms: 5000 });
    emitter.record({ type: 'ad_asset_cache_miss', ad_ref: 'creative-x', ad_slot_id: 'ad-x', state_id: 'st-x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.unsynced({ maxRows: 10 })).toHaveLength(0);
  });

  it('emits one row per distinct ad render (fire-once-per-render contract)', async () => {
    const { emitter, store } = await freshEmitter();
    // Two genuine renders (e.g. two ad slots / two paints).
    emitter.record({ type: 'ad_slot_rendered', ad_ref: 'creative-a', ad_slot_id: 'ad-a', state_id: 'st-1' });
    emitter.record({ type: 'ad_slot_rendered', ad_ref: 'creative-b', ad_slot_id: 'ad-b', state_id: 'st-2' });
    await new Promise((r) => setTimeout(r, 0));
    const rows = store.unsynced({ maxRows: 10 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload['ad_ref'])).toEqual(['creative-a', 'creative-b']);
  });
});
