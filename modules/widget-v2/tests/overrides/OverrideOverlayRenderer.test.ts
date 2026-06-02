import { describe, it, expect, afterEach } from 'vitest';
import { OverrideOverlayRenderer } from '../../src/overrides/OverrideOverlayRenderer';
import { OVERRIDE_CLASS_TREATMENT } from '../../src/overrides/overrideClassTreatment';

afterEach(() => {
  document.body.innerHTML = '';
});

const host = (): HTMLElement => {
  const h = document.createElement('div');
  document.body.appendChild(h);
  return h;
};

const overlay = (h: HTMLElement): HTMLElement | null =>
  h.querySelector<HTMLElement>('.cdq-override-overlay');

describe('OverrideOverlayRenderer.mount', () => {
  it('mounts a fullscreen overlay carrying the canned copy for a fullscreen class', () => {
    const h = host();
    new OverrideOverlayRenderer().mount(OVERRIDE_CLASS_TREATMENT.emergency_safety, h);
    const el = overlay(h)!;
    expect(el).not.toBeNull();
    expect(el.dataset['form']).toBe('fullscreen');
    expect(el.textContent).toBe(OVERRIDE_CLASS_TREATMENT.emergency_safety.cannedCopy);
  });

  it('mounts a top-banner overlay for a top-banner class', () => {
    const h = host();
    new OverrideOverlayRenderer().mount(OVERRIDE_CLASS_TREATMENT.scoreboard_correction, h);
    const el = overlay(h)!;
    expect(el.dataset['form']).toBe('top-banner');
    expect(el.textContent).toBe('Scoreboard under review');
  });

  it('renders copy via textContent only (no markup injection)', () => {
    const h = host();
    new OverrideOverlayRenderer().mount(
      { form: 'top-banner', visualPriority: 0, cannedCopy: '<b>x</b>' },
      h,
    );
    const el = overlay(h)!;
    expect(el.innerHTML).not.toContain('<b>');
    expect(el.textContent).toBe('<b>x</b>');
  });

  it('returns a detach handle that removes the overlay from the host', () => {
    const h = host();
    const detach = new OverrideOverlayRenderer().mount(OVERRIDE_CLASS_TREATMENT.operator_alert, h);
    expect(overlay(h)).not.toBeNull();
    detach();
    expect(overlay(h)).toBeNull();
  });

  it('a second detach call is a harmless no-op', () => {
    const h = host();
    const detach = new OverrideOverlayRenderer().mount(OVERRIDE_CLASS_TREATMENT.operator_alert, h);
    detach();
    expect(() => detach()).not.toThrow();
    expect(overlay(h)).toBeNull();
  });
});
