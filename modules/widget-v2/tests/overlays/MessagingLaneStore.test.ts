import { describe, it, expect } from 'vitest';
import { MessagingLaneStore } from '../../src/overlays/MessagingLaneStore';
import { RecordingJournal, laneFrame } from './support';

const W = { valid_from: '2026-06-01T00:00:00.000Z', valid_until: '2026-06-01T01:00:00.000Z' };
const inWindow = new Date('2026-06-01T00:30:00.000Z');

describe('MessagingLaneStore.upsert', () => {
  it('stores a frame and exposes it as active within the validity window', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    store.upsert(laneFrame({ lane_id: 'L1', text: 'Happy Hour', ...W }));
    const active = store.active(inWindow);
    expect(active.map((e) => ({ lane_id: e.lane_id, text: e.text, display_form: e.display_form }))).toEqual([
      { lane_id: 'L1', text: 'Happy Hour', display_form: 'banner' },
    ]);
  });

  it('replaces a prior entry with the same lane_id rather than adding a second', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    store.upsert(laneFrame({ lane_id: 'L1', text: 'first', ...W }));
    store.upsert(laneFrame({ lane_id: 'L1', text: 'second', ...W }));
    const active = store.active(inWindow);
    expect(active.map((e) => e.text)).toEqual(['second']);
  });

  it('keeps an entry whose valid_from is still in the future but does not surface it as active', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    store.upsert(
      laneFrame({ lane_id: 'L1', valid_from: '2026-06-01T02:00:00.000Z', valid_until: '2026-06-01T03:00:00.000Z' }),
    );
    expect(store.active(inWindow)).toEqual([]);
    expect(store.active(new Date('2026-06-01T02:30:00.000Z')).map((e) => e.lane_id)).toEqual(['L1']);
  });

  it('treats valid_until as exclusive: an entry is inactive at exactly valid_until', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    store.upsert(laneFrame({ lane_id: 'L1', ...W }));
    expect(store.active(new Date('2026-06-01T01:00:00.000Z'))).toEqual([]);
  });

  it('journals schema_violation_received and does not store an unknown display_form', () => {
    const journal = new RecordingJournal();
    const store = new MessagingLaneStore(journal);
    store.upsert(laneFrame({ lane_id: 'L1', display_form: 'popup', ...W }));
    expect(store.active(inWindow)).toEqual([]);
    expect(journal.entries).toEqual([
      { type: 'schema_violation_received', lane_id: 'L1', display_form: 'popup', reason: 'unknown_display_form' },
    ]);
  });

  it('notifies subscribers on each upsert with all stored entries', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    const seen: number[] = [];
    store.subscribe((entries) => seen.push(entries.length));
    store.upsert(laneFrame({ lane_id: 'L1', ...W }));
    store.upsert(laneFrame({ lane_id: 'L2', ...W }));
    expect(seen).toEqual([1, 2]);
  });

  it('does not notify subscribers for a rejected (unknown display_form) frame', () => {
    const store = new MessagingLaneStore(new RecordingJournal());
    let calls = 0;
    store.subscribe(() => calls++);
    store.upsert(laneFrame({ lane_id: 'L1', display_form: 'popup', ...W }));
    expect(calls).toBe(0);
  });
});
