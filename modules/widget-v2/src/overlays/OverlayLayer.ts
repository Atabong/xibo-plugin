/**
 * SPEC-CRWDQ-049 — the persistent overlay DOM layer.
 *
 * Builds the `crowdaq-overlay-layer` container once at mount, with exactly one
 * `.cdq-overlay` child per closed-enum `display_form` (`banner`, `ticker`,
 * `toast`), each starting `hidden`. `render(entry, form)` mutates the form's
 * text IN PLACE — a same-form re-render never toggles `hidden`, so a
 * replace-by-`lane_id` produces no hide/show flicker. The layer is
 * `position: absolute; inset: 0; pointer-events: none` (see messaging-lane.css)
 * so it never reflows the `PlannedState` template underneath.
 *
 * Text is set via `textContent` only — no `innerHTML`, no asset/media — so the
 * markup-free `text` (SPEC-CRWDQ-047 rejects `<`, `>`, `&`) renders inert.
 */
import { DISPLAY_FORMS, type DisplayForm, type MessagingLaneEntry } from './types';

export class OverlayLayer {
  private readonly root: HTMLElement;
  private readonly forms = new Map<DisplayForm, HTMLElement>();
  private readonly texts = new Map<DisplayForm, HTMLElement>();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'crowdaq-overlay-layer';
    this.root.setAttribute('data-suppressed', 'false');

    for (const form of DISPLAY_FORMS) {
      const container = document.createElement('div');
      container.className = 'cdq-overlay';
      container.dataset['form'] = form;
      container.hidden = true;

      const text = document.createElement('span');
      text.className = 'cdq-overlay-text';

      container.appendChild(text);
      this.root.appendChild(container);
      this.forms.set(form, container);
      this.texts.set(form, text);
    }
  }

  /** The layer container — appended once to the root host by the controller. */
  element(): HTMLElement {
    return this.root;
  }

  /**
   * Render `entry` into `form`'s container, or hide the container when `entry`
   * is null. Mutates text in place; only `hidden` and the text change.
   */
  render(entry: MessagingLaneEntry | null, form: DisplayForm): void {
    const container = this.forms.get(form);
    const text = this.texts.get(form);
    if (!container || !text) return;

    if (entry === null) {
      container.hidden = true;
      return;
    }

    if (text.dataset['laneId'] !== entry.lane_id) {
      text.dataset['laneId'] = entry.lane_id;
    }
    if (text.textContent !== entry.text) {
      text.textContent = entry.text;
    }
    container.hidden = false;
  }

  /** Flip the layer's `data-suppressed` attribute (D-GRH-58 binary suppress). */
  setSuppressed(suppressed: boolean): void {
    this.root.setAttribute('data-suppressed', String(suppressed));
  }
}
