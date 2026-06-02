import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import type { GameStateRequester, ServerFrame } from '../../src/transport/types';
import { MessagingLaneStore } from '../../src/overlays/MessagingLaneStore';
import { MessagingLaneOverlay } from '../../src/overlays/MessagingLaneOverlay';
import { RecordingJournal, FakeSuppressionState, laneFrame } from './support';

/** A no-op active-game set / requester — the overlay never drives game seq. */
const inertGames: ActiveGames = { isActive: () => false };
const inertRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };

const NOW = '2026-06-01T00:30:00.000Z';
const WINDOW = { valid_from: '2026-06-01T00:00:00.000Z', valid_until: '2026-06-01T01:00:00.000Z' };

interface Harness {
  host: HTMLElement;
  store: MessagingLaneStore;
  journal: RecordingJournal;
  suppression: FakeSuppressionState;
  dispatcher: FrameDispatcher;
  unmount: () => void;
}

function setup(initialSuppressed = false): Harness {
  const journal = new RecordingJournal();
  const store = new MessagingLaneStore(journal);
  const suppression = new FakeSuppressionState(initialSuppressed);
  const dispatcher = new FrameDispatcher(inertRequester, inertGames);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const overlay = new MessagingLaneOverlay();
  const unmount = overlay.mount(host, { store, overrideSuppressionState: suppression, journal, dispatcher });
  return { host, store, journal, suppression, dispatcher, unmount };
}

const form = (host: HTMLElement, f: string): HTMLElement =>
  host.querySelector<HTMLElement>(`.cdq-overlay[data-form="${f}"]`)!;
const textOf = (host: HTMLElement, f: string): string | null =>
  form(host, f).querySelector<HTMLElement>('.cdq-overlay-text')!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('MessagingLaneOverlay.mount', () => {
  it('mounts the layer with one hidden form container per display_form', () => {
    const { host, unmount } = setup();
    const layer = host.querySelector<HTMLElement>('.crowdaq-overlay-layer')!;
    expect(Array.from(layer.querySelectorAll<HTMLElement>('.cdq-overlay')).map((el) => el.dataset['form'])).toEqual([
      'banner',
      'ticker',
      'toast',
    ]);
    expect(Array.from(layer.querySelectorAll<HTMLElement>('.cdq-overlay')).every((el) => el.hidden)).toBe(true);
    unmount();
  });
});

describe('MessagingLaneOverlay dispatch + render', () => {
  it('renders a dispatched MessagingLane frame into its form container', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'L1', text: 'Happy Hour', display_form: 'banner', ...WINDOW }) as ServerFrame);
    expect(form(host, 'banner').hidden).toBe(false);
    expect(textOf(host, 'banner')).toBe('Happy Hour');
    expect(form(host, 'banner').querySelector<HTMLElement>('.cdq-overlay-text')!.dataset['laneId']).toBe('L1');
    unmount();
  });

  it('mutates text in place when the same lane_id is replaced, without hiding the form', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'L1', text: 'first', ...WINDOW }) as ServerFrame);
    const spanBefore = form(host, 'banner').querySelector('.cdq-overlay-text');
    dispatcher.dispatch(laneFrame({ lane_id: 'L1', text: 'second', ...WINDOW }) as ServerFrame);
    const spanAfter = form(host, 'banner').querySelector('.cdq-overlay-text');
    expect({ same: spanBefore === spanAfter, text: textOf(host, 'banner'), hidden: form(host, 'banner').hidden }).toEqual({
      same: true,
      text: 'second',
      hidden: false,
    });
    unmount();
  });

  it('renders entries on different forms simultaneously', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'B', display_form: 'banner', text: 'b', ...WINDOW }) as ServerFrame);
    dispatcher.dispatch(laneFrame({ lane_id: 'T', display_form: 'ticker', text: 't', ...WINDOW }) as ServerFrame);
    expect({ banner: form(host, 'banner').hidden, ticker: form(host, 'ticker').hidden }).toEqual({
      banner: false,
      ticker: false,
    });
    unmount();
  });

  it('keeps a single active entry shown continuously across ticks (cycle of one)', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'L1', text: 'solo', dwell_ms: 8000, ...WINDOW }) as ServerFrame);
    vi.advanceTimersByTime(30000);
    expect(textOf(host, 'banner')).toBe('solo');
    expect(form(host, 'banner').hidden).toBe(false);
    unmount();
  });

  it('does not render or store a frame with an unknown display_form (defense in depth)', () => {
    const { host, dispatcher, journal, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'X', display_form: 'popup', ...WINDOW }) as ServerFrame);
    expect([form(host, 'banner').hidden, form(host, 'ticker').hidden, form(host, 'toast').hidden]).toEqual([
      true,
      true,
      true,
    ]);
    expect(journal.types()).toEqual(['schema_violation_received']);
    unmount();
  });
});

describe('MessagingLaneOverlay cycling (multiple active entries, same form)', () => {
  it('cycles each entry for its own dwell_ms then loops', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'A', text: 'A', display_form: 'banner', dwell_ms: 8000, ...WINDOW }) as ServerFrame);
    dispatcher.dispatch(laneFrame({ lane_id: 'B', text: 'B', display_form: 'banner', dwell_ms: 8000, ...WINDOW }) as ServerFrame);
    // First entry shown immediately.
    expect(textOf(host, 'banner')).toBe('A');
    vi.advanceTimersByTime(8000);
    expect(textOf(host, 'banner')).toBe('B');
    vi.advanceTimersByTime(8000);
    expect(textOf(host, 'banner')).toBe('A'); // looped
    unmount();
  });
});

describe('MessagingLaneOverlay validity (outside window + expiry)', () => {
  it('does not render an entry whose valid_from is still in the future, then shows it when reached', () => {
    const { host, dispatcher, unmount } = setup();
    dispatcher.dispatch(
      laneFrame({ lane_id: 'F', text: 'future', valid_from: '2026-06-01T00:45:00.000Z', valid_until: '2026-06-01T01:30:00.000Z' }) as ServerFrame,
    );
    expect(form(host, 'banner').hidden).toBe(true);
    vi.setSystemTime(new Date('2026-06-01T00:46:00.000Z'));
    vi.advanceTimersByTime(1000);
    expect(textOf(host, 'banner')).toBe('future');
    expect(form(host, 'banner').hidden).toBe(false);
    unmount();
  });

  it('hides the form and journals messaging_lane_expired when valid_until passes', () => {
    const { host, dispatcher, journal, unmount } = setup();
    dispatcher.dispatch(
      laneFrame({ lane_id: 'E', text: 'soon', valid_from: '2026-06-01T00:00:00.000Z', valid_until: '2026-06-01T00:30:05.000Z' }) as ServerFrame,
    );
    expect(form(host, 'banner').hidden).toBe(false);
    vi.setSystemTime(new Date('2026-06-01T00:30:06.000Z'));
    vi.advanceTimersByTime(1000);
    expect(form(host, 'banner').hidden).toBe(true);
    expect(journal.entries.filter((e) => e.type === 'messaging_lane_expired').map((e) => e.lane_id)).toEqual(['E']);
    unmount();
  });
});

describe('MessagingLaneOverlay override suppression (D-GRH-58)', () => {
  it('flips data-suppressed and hides all forms while active, restores on release', () => {
    const { host, dispatcher, suppression, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'L1', text: 'x', display_form: 'banner', ...WINDOW }) as ServerFrame);
    const layer = host.querySelector<HTMLElement>('.crowdaq-overlay-layer')!;

    suppression.setActive(true);
    expect(layer.getAttribute('data-suppressed')).toBe('true');
    expect(form(host, 'banner').hidden).toBe(true);

    suppression.setActive(false);
    expect(layer.getAttribute('data-suppressed')).toBe('false');
    expect(form(host, 'banner').hidden).toBe(false);
    unmount();
  });

  it('journals messaging_lane_resumed per form with an active entry on release', () => {
    const { dispatcher, suppression, journal, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'B', display_form: 'banner', text: 'b', ...WINDOW }) as ServerFrame);
    dispatcher.dispatch(laneFrame({ lane_id: 'T', display_form: 'ticker', text: 't', ...WINDOW }) as ServerFrame);
    suppression.setActive(true);
    suppression.setActive(false);
    const resumedForms = journal.entries
      .filter((e) => e.type === 'messaging_lane_resumed')
      .map((e) => e['display_form'])
      .sort();
    expect(resumedForms).toEqual(['banner', 'ticker']);
    unmount();
  });

  it('resumes the freshest active entry per form after suppression', () => {
    const { host, dispatcher, suppression, unmount } = setup();
    dispatcher.dispatch(laneFrame({ lane_id: 'A', display_form: 'banner', text: 'A', dwell_ms: 8000, ...WINDOW }) as ServerFrame);
    dispatcher.dispatch(laneFrame({ lane_id: 'B', display_form: 'banner', text: 'B', dwell_ms: 8000, ...WINDOW }) as ServerFrame);
    suppression.setActive(true);
    suppression.setActive(false);
    expect(textOf(host, 'banner')).toBe('B'); // freshest (most recently upserted)
    unmount();
  });

  it('evicts an entry that expires during suppression and does not show it on resume', () => {
    const { host, dispatcher, suppression, journal, unmount } = setup();
    dispatcher.dispatch(
      laneFrame({ lane_id: 'E', display_form: 'banner', text: 'expiring', valid_from: '2026-06-01T00:00:00.000Z', valid_until: '2026-06-01T00:30:05.000Z' }) as ServerFrame,
    );
    suppression.setActive(true);
    vi.setSystemTime(new Date('2026-06-01T00:30:06.000Z'));
    vi.advanceTimersByTime(1000); // expiry tick during suppression
    suppression.setActive(false);
    expect(form(host, 'banner').hidden).toBe(true);
    expect(journal.types()).toContain('messaging_lane_expired_during_suppression');
    expect(journal.types()).not.toContain('messaging_lane_expired');
    unmount();
  });
});
