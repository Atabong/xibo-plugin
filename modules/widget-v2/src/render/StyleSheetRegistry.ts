/**
 * SPEC-CRWDQ-023 — theme stylesheet swap seam (D-GRH-51).
 *
 * The activator swaps the active theme stylesheet at a dwell boundary when a
 * preference apply is pending (AC8). The real `<link rel="stylesheet">`
 * injection is a system boundary covered by SPEC-CRWDQ-027 e2e; here it is an
 * injected port so unit tests record the applied `theme_id` without touching a
 * real document head. A `default` / `unset` resolved theme passes `null`.
 */
export interface StyleSheetRegistry {
  /** Apply the stylesheet for `themeId`, or clear the override when null. */
  applyTheme(themeId: string | null): void;
}
