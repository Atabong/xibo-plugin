/**
 * SPEC-CRWDQ-023 — theme resolution (D-GRH-51, AC8).
 *
 * Resolves the theme a PlannedState should render in, with a single
 * fall-through rule:
 *
 *   1. A non-empty `PlannedStatePayload.theme_id` wins → `{ state: 'set', id }`.
 *   2. A null/empty `theme_id` falls through to the bar-wide
 *      `ThemeChoiceWire` applied by the most recent ConfigPush.
 *   3. No ConfigPush applied yet (bar theme unknown) → `{ state: 'default' }`.
 *
 * `ThemeChoiceWire` is a THREE-state union (D-GRH-51): `set` carries an id,
 * `default` and `unset` carry none and are DISTINCT (a bar that explicitly
 * chose "no theme override" is `unset`, not `default`). The `data-theme`
 * attribute encodes the distinction with sentinel values so a stylesheet /
 * test can tell them apart.
 */
import type { ThemeChoiceWire } from '../wire';

/** The widget's resolution OUTPUT — the same three-state shape as the wire. */
export type ResolvedTheme = ThemeChoiceWire;

/** Sentinel `data-theme` value for an explicit-default theme. */
export const THEME_ATTR_DEFAULT = '__default__';
/** Sentinel `data-theme` value for an explicit-unset theme. */
export const THEME_ATTR_UNSET = '__unset__';

/**
 * Read-only port over the applied bar-wide theme. Returns the
 * `ThemeChoiceWire` from the most recent ConfigPush, or null when no
 * ConfigPush has been applied. A narrow seam (INV-FACTORY-19) so the resolver
 * never reaches into ConfigPushHandler / PreferenceStore internals.
 */
export interface BarThemeSource {
  currentBarTheme(): ThemeChoiceWire | null;
}

/** Resolve the effective theme for a PlannedState's `theme_id`. */
export function resolveTheme(
  stateThemeId: string | null,
  barThemeSource: BarThemeSource,
): ResolvedTheme {
  if (stateThemeId !== null && stateThemeId.length > 0) {
    return { state: 'set', id: stateThemeId };
  }
  const barTheme = barThemeSource.currentBarTheme();
  if (barTheme !== null) {
    return barTheme;
  }
  return { state: 'default' };
}

/** Map a resolved theme to its `data-theme` attribute value. */
export function themeAttr(theme: ResolvedTheme): string {
  switch (theme.state) {
    case 'set':
      return theme.id;
    case 'unset':
      return THEME_ATTR_UNSET;
    case 'default':
      return THEME_ATTR_DEFAULT;
  }
}
