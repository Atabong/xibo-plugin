/**
 * SPEC-CRWDQ-063 #62 (part 2) — canned-overlay render failure is journal-only
 * (D-GRH-76 runtime_reason).
 *
 * A render failure of the canned overlay is a PLAYER-RUNTIME safe, not a
 * backend-planned one: it journals `runtime_reason: 'render_error'` and NEVER
 * surfaces that enum value — nor a "render_error" / "unavailable" string, nor
 * any enum-specific copy — on screen. Patron-facing copy is owned by the next
 * valid frame.
 *
 * The failure is driven through the REAL {@link OverrideOverlayRenderer} and a
 * REAL {@link OverrideInjectionHandler} (INV-FACTORY-16 — no mock of the
 * renderer, dispatcher, suppression, or overlay). The only thing made to fail
 * is the DOM mount point itself: a real host element whose `appendChild`
 * raises, the same way a detached / hostile container would in the browser.
 * That is a genuine DOM condition, not a stubbed collaborator.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrameDispatcher } from '../../src/transport/Dispatcher';
import type { ServerFrame } from '../../src/transport/types';
import { WritableOverrideSuppressionState } from '../../src/overrides/OverrideSuppressionState';
import { OverrideOverlayRenderer } from '../../src/overrides/OverrideOverlayRenderer';
import { OverrideInjectionHandler } from '../../src/overrides/OverrideInjectionHandler';
import { RecordingOverrideJournal, overrideFrame, inertGames, inertRequester } from './support';

const NOW = '2026-06-01T00:30:00.000Z';

/**
 * A real host whose `appendChild` throws — a genuine DOM failure condition (a
 * detached or otherwise hostile mount point), NOT a renderer mock. The real
 * renderer still constructs and styles the overlay element; the failure is the
 * DOM insertion, exactly as it would surface in the browser.
 */
function hostileHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.appendChild = () => {
    throw new DOMException('append blocked', 'HierarchyRequestError');
  };
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('runtime_reason render failure is journal-only (D-GRH-76)', () => {
  it('journals runtime_reason: render_error when the real renderer cannot mount', () => {
    const host = hostileHost();
    const journal = new RecordingOverrideJournal();
    const dispatcher = new FrameDispatcher(inertRequester, inertGames);
    new OverrideInjectionHandler({
      dispatcher,
      suppression: new WritableOverrideSuppressionState(),
      renderer: new OverrideOverlayRenderer(), // REAL renderer (INV-16)
      journal,
      host,
      now: () => Date.now(),
    });

    dispatcher.dispatch(overrideFrame({ override_id: 'o1', override_class: 'emergency_safety' }) as ServerFrame);

    const err = journal.ofType('override_render_error')[0];
    expect(err?.runtime_reason).toBe('render_error');
  });

  it('never renders render_error, unavailable, or any enum-specific copy on screen', () => {
    const host = hostileHost();
    const journal = new RecordingOverrideJournal();
    const dispatcher = new FrameDispatcher(inertRequester, inertGames);
    new OverrideInjectionHandler({
      dispatcher,
      suppression: new WritableOverrideSuppressionState(),
      renderer: new OverrideOverlayRenderer(),
      journal,
      host,
      now: () => Date.now(),
    });

    dispatcher.dispatch(overrideFrame({ override_id: 'o1', override_class: 'system_maintenance' }) as ServerFrame);

    // Nothing patron-facing is mounted, and the enum / runtime markers are
    // never on screen — neither in the failed host nor anywhere in the document.
    expect(host.querySelector('.cdq-override-overlay')).toBeNull();
    const onScreen = document.body.textContent ?? '';
    expect(onScreen).not.toContain('render_error');
    expect(onScreen.toLowerCase()).not.toContain('unavailable');
    expect(onScreen.toLowerCase()).not.toContain('runtime_reason');
  });

  it('does not leave a dangling auto-clear timer when the render fails', () => {
    const host = hostileHost();
    const journal = new RecordingOverrideJournal();
    const dispatcher = new FrameDispatcher(inertRequester, inertGames);
    new OverrideInjectionHandler({
      dispatcher,
      suppression: new WritableOverrideSuppressionState(),
      renderer: new OverrideOverlayRenderer(),
      journal,
      host,
      now: () => Date.now(),
    });

    dispatcher.dispatch(
      overrideFrame({ override_id: 'o1', override_class: 'operator_alert', valid_to: '2026-06-01T00:30:10.000Z' }) as ServerFrame,
    );

    // Advancing past valid_to must not journal a phantom resolve — the failed
    // activation never armed a window timer.
    vi.advanceTimersByTime(20_000);
    expect(journal.ofType('override_resolved')).toHaveLength(0);
    expect(journal.types()).toContain('override_render_error');
  });

  it('lets a subsequent override activate normally after a render failure', () => {
    // The next valid frame owns patron-facing copy: a failed override must not
    // wedge the single active slot. Use a fresh, healthy host for the recovery.
    const failingHost = hostileHost();
    const goodHost = document.createElement('div');
    document.body.appendChild(goodHost);
    const journal = new RecordingOverrideJournal();
    const suppression = new WritableOverrideSuppressionState();
    const dispatcher = new FrameDispatcher(inertRequester, inertGames);
    const renderer = new OverrideOverlayRenderer();

    // First handler fails to mount into the hostile host.
    new OverrideInjectionHandler({
      dispatcher,
      suppression,
      renderer,
      journal,
      host: failingHost,
      now: () => Date.now(),
    });
    dispatcher.dispatch(overrideFrame({ override_id: 'bad', override_class: 'operator_alert' }) as ServerFrame);
    expect(journal.types()).toContain('override_render_error');

    // A second, independent handler over a healthy host activates cleanly —
    // the failure did not poison the renderer or the suppression token.
    const dispatcher2 = new FrameDispatcher(inertRequester, inertGames);
    new OverrideInjectionHandler({
      dispatcher: dispatcher2,
      suppression: new WritableOverrideSuppressionState(),
      renderer,
      journal: new RecordingOverrideJournal(),
      host: goodHost,
      now: () => Date.now(),
    });
    dispatcher2.dispatch(overrideFrame({ override_id: 'good', override_class: 'scoreboard_correction' }) as ServerFrame);
    expect(goodHost.querySelector('.cdq-override-overlay')?.textContent).toBe('Scoreboard under review');
  });
});
