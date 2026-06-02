import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrameDispatcher } from '../../src/transport/Dispatcher';
import type { ServerFrame } from '../../src/transport/types';
import { WritableOverrideSuppressionState } from '../../src/overrides/OverrideSuppressionState';
import { OverrideOverlayRenderer } from '../../src/overrides/OverrideOverlayRenderer';
import { OverrideInjectionHandler } from '../../src/overrides/OverrideInjectionHandler';
import { MessagingLaneOverlay } from '../../src/overlays/MessagingLaneOverlay';
import { MessagingLaneStore } from '../../src/overlays/MessagingLaneStore';
import type { OverlayJournal, OverlayJournalEntry } from '../../src/overlays/types';
import {
  RecordingOverrideJournal,
  overrideFrame,
  inertGames,
  inertRequester,
} from './support';

const NOW = '2026-06-01T00:30:00.000Z'; // inside the default [00:00, 01:00] window

interface Harness {
  host: HTMLElement;
  dispatcher: FrameDispatcher;
  suppression: WritableOverrideSuppressionState;
  renderer: OverrideOverlayRenderer;
  journal: RecordingOverrideJournal;
  handler: OverrideInjectionHandler;
}

function setup(): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispatcher = new FrameDispatcher(inertRequester, inertGames);
  const suppression = new WritableOverrideSuppressionState();
  const renderer = new OverrideOverlayRenderer();
  const journal = new RecordingOverrideJournal();
  const handler = new OverrideInjectionHandler({
    dispatcher,
    suppression,
    renderer,
    journal,
    host,
    now: () => Date.now(),
  });
  return { host, dispatcher, suppression, renderer, journal, handler };
}

const overlay = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('.cdq-override-overlay');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('OverrideInjectionHandler registration', () => {
  it('registers as the dispatcher OverrideInjection handler and activates on dispatch', () => {
    const { host, dispatcher, suppression, journal } = setup();
    dispatcher.dispatch(overrideFrame({ override_id: 'o1', override_class: 'emergency_safety' }) as ServerFrame);
    expect(overlay(host)).not.toBeNull();
    expect(suppression.isActive).toBe(true);
    expect(journal.types()).toContain('override_activated');
  });
});

describe('class -> canned-overlay treatment', () => {
  it('renders fullscreen for emergency_safety / system_maintenance and top-banner for the rest', () => {
    for (const [cls, form, copy] of [
      ['emergency_safety', 'fullscreen', undefined],
      ['system_maintenance', 'fullscreen', undefined],
      ['scoreboard_correction', 'top-banner', 'Scoreboard under review'],
      ['operator_alert', 'top-banner', 'Notice'],
    ] as const) {
      const { host, dispatcher } = setup();
      dispatcher.dispatch(overrideFrame({ override_id: `o-${cls}`, override_class: cls }) as ServerFrame);
      const el = overlay(host)!;
      expect(el.dataset['form']).toBe(form);
      if (copy) expect(el.textContent).toBe(copy);
      document.body.innerHTML = '';
    }
  });
});

describe('suppression integration with SPEC-CRWDQ-049 overlay layer', () => {
  it('flips data-suppressed=true synchronously on activation and back on clear', () => {
    const { host, dispatcher, suppression, journal } = setup();
    // Mount the REAL MessagingLaneOverlay against the SAME suppression token.
    const laneJournal: OverlayJournal = { record: (_e: OverlayJournalEntry) => {} };
    const laneOverlay = new MessagingLaneOverlay();
    const laneStore = new MessagingLaneStore(laneJournal);
    const laneHost = document.createElement('div');
    document.body.appendChild(laneHost);
    const unmount = laneOverlay.mount(laneHost, {
      store: laneStore,
      overrideSuppressionState: suppression,
      journal: laneJournal,
      dispatcher: new FrameDispatcher(inertRequester, inertGames),
    });
    const layer = () => laneHost.querySelector<HTMLElement>('.crowdaq-overlay-layer')!;

    expect(layer().getAttribute('data-suppressed')).toBe('false');
    dispatcher.dispatch(overrideFrame({ override_id: 'o1', valid_to: '2026-06-01T00:30:10.000Z' }) as ServerFrame);
    expect(layer().getAttribute('data-suppressed')).toBe('true');

    vi.advanceTimersByTime(10_000); // past valid_to
    expect(suppression.isActive).toBe(false);
    expect(layer().getAttribute('data-suppressed')).toBe('false');
    expect(journal.ofType('override_resolved')[0]?.resolved_by).toBe('window');
    expect(overlay(host)).toBeNull();
    unmount();
  });
});

describe('dwell bypass (D-GRH-24)', () => {
  it('activates immediately on arrival without any dwell wait', () => {
    const { host, dispatcher } = setup();
    dispatcher.dispatch(overrideFrame({ override_id: 'o1' }) as ServerFrame);
    // No timer advance — the overlay is up the same tick.
    expect(overlay(host)).not.toBeNull();
  });
});

describe('in-window activation latency (< 250 ms)', () => {
  it('mounts the canned overlay well within 250 ms of arrival (real clock)', () => {
    // Real timers here so wall-clock elapsed is meaningful; the handler does no
    // async work on the activation path, so dispatch→DOM is synchronous.
    vi.useRealTimers();
    const { host, dispatcher } = setup();
    const start = performance.now();
    dispatcher.dispatch(
      overrideFrame({ override_id: 'o1', override_class: 'emergency_safety', valid_to: null }) as ServerFrame,
    );
    const elapsed = performance.now() - start;
    expect(overlay(host)).not.toBeNull();
    expect(elapsed).toBeLessThan(250);
  });
});

describe('window handling', () => {
  it('drops an override already expired on arrival without rendering or suppressing', () => {
    const { host, dispatcher, suppression, journal } = setup();
    dispatcher.dispatch(
      overrideFrame({
        override_id: 'o1',
        valid_from: '2026-06-01T00:00:00.000Z',
        valid_to: '2026-06-01T00:10:00.000Z', // before NOW (00:30)
      }) as ServerFrame,
    );
    expect(overlay(host)).toBeNull();
    expect(suppression.isActive).toBe(false);
    expect(journal.types()).toEqual(['override_expired_on_arrival']);
  });

  it('arms a wall-clock timer for a future override and activates at valid_from', () => {
    const { host, dispatcher, suppression } = setup();
    dispatcher.dispatch(
      overrideFrame({
        override_id: 'o1',
        valid_from: '2026-06-01T00:31:00.000Z', // 60s in the future
        valid_to: '2026-06-01T01:00:00.000Z',
      }) as ServerFrame,
    );
    expect(overlay(host)).toBeNull();
    expect(suppression.isActive).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(overlay(host)).not.toBeNull();
    expect(suppression.isActive).toBe(true);
  });
});

describe('auto-clear', () => {
  it('clears at valid_to via a single wall-clock timer and journals resolved_by window', () => {
    const { host, dispatcher, suppression, journal } = setup();
    dispatcher.dispatch(
      overrideFrame({ override_id: 'o1', valid_to: '2026-06-01T00:30:10.000Z' }) as ServerFrame,
    );
    expect(suppression.isActive).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(suppression.isActive).toBe(true); // not yet
    vi.advanceTimersByTime(1);
    expect(overlay(host)).toBeNull();
    expect(suppression.isActive).toBe(false);
    expect(journal.ofType('override_resolved')[0]?.resolved_by).toBe('window');
  });
});

describe('indefinite override (valid_to === null)', () => {
  it('activates, holds with no expiry timer, and journals override_indefinite', () => {
    const { host, dispatcher, suppression, journal } = setup();
    dispatcher.dispatch(overrideFrame({ override_id: 'o1', valid_to: null }) as ServerFrame);
    expect(suppression.isActive).toBe(true);
    expect(journal.types()).toContain('override_indefinite');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000); // a day later — still up
    expect(overlay(host)).not.toBeNull();
    expect(suppression.isActive).toBe(true);
  });
});

describe('precedence supersede (single active slot)', () => {
  it('higher precedence supersedes; prior journals resolved_by supersede; suppression never flaps', () => {
    const { host, dispatcher, suppression, journal } = setup();
    const flaps: boolean[] = [];
    suppression.subscribe((a) => flaps.push(a));
    dispatcher.dispatch(
      overrideFrame({ override_id: 'low', override_class: 'operator_alert', precedence: 0, valid_to: null }) as ServerFrame,
    );
    dispatcher.dispatch(
      overrideFrame({ override_id: 'high', override_class: 'emergency_safety', precedence: 1, valid_to: null }) as ServerFrame,
    );
    expect(overlay(host)!.dataset['form']).toBe('fullscreen'); // emergency_safety active
    expect(suppression.isActive).toBe(true);
    expect(flaps).toEqual([true]); // only the first activation — no flap to false
    const resolved = journal.ofType('override_resolved');
    expect(resolved.some((e) => e.override_id === 'low' && e.resolved_by === 'supersede')).toBe(true);
  });

  it('equal precedence is last-write-wins', () => {
    const { host, dispatcher, journal } = setup();
    dispatcher.dispatch(
      overrideFrame({ override_id: 'a', override_class: 'operator_alert', precedence: 0, valid_to: null }) as ServerFrame,
    );
    dispatcher.dispatch(
      overrideFrame({ override_id: 'b', override_class: 'scoreboard_correction', precedence: 0, valid_to: null }) as ServerFrame,
    );
    expect(overlay(host)!.textContent).toBe('Scoreboard under review'); // b active
    expect(journal.ofType('override_resolved').some((e) => e.override_id === 'a' && e.resolved_by === 'supersede')).toBe(true);
  });

  it('strictly-lower precedence is ignored while the active holds', () => {
    const { host, dispatcher, journal } = setup();
    dispatcher.dispatch(
      overrideFrame({ override_id: 'high', override_class: 'emergency_safety', precedence: 1, valid_to: null }) as ServerFrame,
    );
    dispatcher.dispatch(
      overrideFrame({ override_id: 'low', override_class: 'operator_alert', precedence: 0, valid_to: null }) as ServerFrame,
    );
    expect(overlay(host)!.dataset['form']).toBe('fullscreen'); // still emergency_safety
    expect(journal.ofType('override_suppressed_lower_precedence')[0]?.override_id).toBe('low');
  });
});

describe('idempotent re-push', () => {
  it('same override_id is a no-op: one mount, one activation journal, no duplicates', () => {
    const { host, dispatcher, suppression, journal } = setup();
    const flaps: boolean[] = [];
    suppression.subscribe((a) => flaps.push(a));
    const frame = overrideFrame({ override_id: 'o1', valid_to: null }) as ServerFrame;
    dispatcher.dispatch(frame);
    dispatcher.dispatch(frame);
    expect(host.querySelectorAll('.cdq-override-overlay')).toHaveLength(1);
    expect(flaps).toEqual([true]);
    expect(journal.ofType('override_activated')).toHaveLength(1);
  });
});

describe('forward-compat non-null payload_ref', () => {
  it('falls back to the canned overlay for override_class without crashing', () => {
    const { host, dispatcher } = setup();
    dispatcher.dispatch(
      overrideFrame({ override_id: 'o1', override_class: 'scoreboard_correction', payload_ref: 'ref-123' }) as ServerFrame,
    );
    expect(overlay(host)!.textContent).toBe('Scoreboard under review');
  });
});

// The runtime_reason render-failure path (D-GRH-76) is covered through the REAL
// OverrideOverlayRenderer driven by a genuine DOM mount failure in
// OverrideRenderFailure.test.ts (INV-FACTORY-16 — no mock of the renderer).
