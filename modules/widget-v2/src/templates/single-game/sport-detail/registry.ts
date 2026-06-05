/**
 * SPEC-CRWDQ-084 — sport-detail panel registry for the single_game template.
 *
 * The single_game SHELL (league strap, team blocks, big score, clock pill,
 * excitement meter, GOAL banner) is sport-agnostic and unchanged. This registry
 * adds a SWAPPABLE, sport-specific DETAIL panel below/beside the shell that
 * surfaces the rich data each sport carries (a soccer event timeline + half/
 * clock; a baseball line-score grid + count + bases diamond).
 *
 * Adding a sport = register one `SportDetailPanel` here + its CSS. The default
 * (no registered panel) renders nothing — the shell still shows, so an unknown
 * sport degrades gracefully (never a broken panel).
 */
import type { GameState } from '../../../render/types';

/**
 * A per-sport detail panel. `mount` builds the panel DOM into `host` ONCE and
 * returns an `update(state)` the template calls on every applied GameState (so
 * the panel re-paints in place, no remount). `dispose` is optional cleanup.
 *
 * A panel reads ONLY off `state` (`state.timeline`, `state.sport_context.detail`,
 * scores) — it never reaches into the shell, so the two stay decoupled.
 */
export interface SportDetailInstance {
  update(state: GameState | null): void;
  dispose?(): void;
}

export interface SportDetailPanel {
  /** Mount the panel DOM into `host` and return its in-place updater. */
  mount(host: HTMLElement): SportDetailInstance;
}

/** The registry: sport enum → panel factory. */
const REGISTRY = new Map<string, SportDetailPanel>();

/** Register (or override) the detail panel for a sport. */
export function registerSportDetail(sport: string, panel: SportDetailPanel): void {
  REGISTRY.set(sport, panel);
}

/** Resolve the registered panel for a sport, or null (→ minimal/no detail). */
export function sportDetailPanel(sport: string | undefined): SportDetailPanel | null {
  if (!sport) return null;
  return REGISTRY.get(sport) ?? null;
}

/** The sports that currently have a rich detail panel (for tests / docs). */
export function registeredSports(): string[] {
  return [...REGISTRY.keys()].sort();
}
