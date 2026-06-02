import { describe, it, expect, beforeEach } from 'vitest';
import { OverlayLayer } from '../../src/overlays/OverlayLayer';
import type { MessagingLaneEntry } from '../../src/overlays/types';

const entry = (over: Partial<MessagingLaneEntry> & Pick<MessagingLaneEntry, 'lane_id'>): MessagingLaneEntry => ({
  lane_id: over.lane_id,
  text: over.text ?? 'hello',
  display_form: over.display_form ?? 'banner',
  dwell_ms: over.dwell_ms ?? 8000,
  valid_from: over.valid_from ?? '2026-06-01T00:00:00.000Z',
  valid_until: over.valid_until ?? '2026-06-01T01:00:00.000Z',
  receivedAt: over.receivedAt ?? new Date(),
});

describe('OverlayLayer DOM shape', () => {
  let layer: OverlayLayer;
  beforeEach(() => {
    layer = new OverlayLayer();
  });

  it('builds one .cdq-overlay child per display_form, each starting hidden', () => {
    const root = layer.element();
    expect(root.className).toBe('crowdaq-overlay-layer');
    expect(root.getAttribute('data-suppressed')).toBe('false');
    const forms = [...root.querySelectorAll<HTMLElement>('.cdq-overlay')].map((el) => el.dataset['form']);
    expect(forms).toEqual(['banner', 'ticker', 'toast']);
    expect([...root.querySelectorAll<HTMLElement>('.cdq-overlay')].every((el) => el.hidden)).toBe(true);
  });

  it('renders text as textContent (no HTML interpretation) and stamps data-lane-id', () => {
    layer.render(entry({ lane_id: 'L1', text: '<b>x</b> & y', display_form: 'banner' }), 'banner');
    const span = layer.element().querySelector<HTMLElement>('.cdq-overlay[data-form="banner"] .cdq-overlay-text')!;
    expect(span.textContent).toBe('<b>x</b> & y');
    expect(span.querySelector('b')).toBeNull();
    expect(span.dataset['laneId']).toBe('L1');
  });

  it('shows the form container when given an entry and hides it when given null', () => {
    const banner = (): HTMLElement => layer.element().querySelector<HTMLElement>('.cdq-overlay[data-form="banner"]')!;
    layer.render(entry({ lane_id: 'L1' }), 'banner');
    expect(banner().hidden).toBe(false);
    layer.render(null, 'banner');
    expect(banner().hidden).toBe(true);
  });

  it('mutates text in place without toggling hidden when the same form re-renders', () => {
    const banner = (): HTMLElement => layer.element().querySelector<HTMLElement>('.cdq-overlay[data-form="banner"]')!;
    layer.render(entry({ lane_id: 'L1', text: 'first' }), 'banner');
    const wasVisible = banner().hidden === false;
    layer.render(entry({ lane_id: 'L1', text: 'second' }), 'banner');
    const span = banner().querySelector<HTMLElement>('.cdq-overlay-text')!;
    expect({ wasVisible, text: span.textContent, stillVisible: banner().hidden === false }).toEqual({
      wasVisible: true,
      text: 'second',
      stillVisible: true,
    });
  });

  it('flips data-suppressed on the layer container', () => {
    layer.setSuppressed(true);
    expect(layer.element().getAttribute('data-suppressed')).toBe('true');
    layer.setSuppressed(false);
    expect(layer.element().getAttribute('data-suppressed')).toBe('false');
  });
});
