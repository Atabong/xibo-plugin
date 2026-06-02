/**
 * SPEC-CRWDQ-063 — self-contained canned-overlay renderer.
 *
 * Mounts the built-in overlay for an {@link OverrideTreatment} into a host and
 * returns a detach handle. Copy is bundled/canned (set via `textContent`, so
 * any stray markup renders inert — no operator content is on the wire in
 * phase-1). The `data-form` attribute (`fullscreen` | `top-banner`) and the
 * `.cdq-override-overlay` class carry the visual treatment; styling is owned by
 * the host stylesheet, not this module.
 *
 * This renderer is deliberately isolated: it does NOT touch
 * `PlannedStateActivator`, `ProgramSlotResolver`, `AssetManifestStore`, or any
 * template family — the override overlay is its own thing (D-GRH-58 top of the
 * priority stack).
 */
import type { OverrideTreatment } from './overrideClassTreatment';

export class OverrideOverlayRenderer {
  /**
   * Mount the canned overlay for `treatment` into `host`. Returns a detach
   * handle that removes the overlay; calling it more than once is a no-op.
   */
  mount(treatment: OverrideTreatment, host: HTMLElement): () => void {
    const el = document.createElement('div');
    el.className = 'cdq-override-overlay';
    el.dataset['form'] = treatment.form;
    el.textContent = treatment.cannedCopy;
    host.appendChild(el);

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      el.remove();
    };
  }
}
