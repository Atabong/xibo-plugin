/**
 * SPEC-CRWDQ-034 / D-GRH-73 — wire a mounted fixtures-bearing instance to the
 * live {@link FixturesTimezoneBroadcast} so a bar-timezone EDIT re-formats the
 * already-mounted board immediately (no remount), and detaches its subscription
 * on supersede.
 *
 * Shared by the three fixtures-bearing adapters (`fixtures`,
 * `fixtures_with_live_game`, `fixtures_with_ads`). Each exposes an
 * `applyPending({ timezone })` that re-formats every rendered card under a new
 * zone; this helper subscribes that to the broadcast and wraps the instance's
 * `detach()` so the sink is removed when the board is torn down — a superseded
 * board never receives a reformat for DOM it no longer owns.
 */
import type { TemplateInstance } from '../../render/TemplateInstance';
import type { FixturesTimezoneBroadcast } from '../../render/FixturesTimezoneBroadcast';

/** The optional reformat surface a fixtures-bearing instance exposes. */
interface MaybeReformatable {
  applyPending?(pending: { timezone?: string }): void;
}

/**
 * Subscribe `instance.applyPending` to `broadcast` (when one is provided) and
 * return the instance with its `detach()` wrapped to unsubscribe. A no-op
 * pass-through when no broadcast is wired (a deployment without live tz edits)
 * or when the instance exposes no `applyPending` (it opted out of reformat).
 */
export function subscribeTimezoneReformat<T extends TemplateInstance>(
  instance: T,
  broadcast: FixturesTimezoneBroadcast | undefined,
): T {
  const reformatable = instance as T & MaybeReformatable;
  if (broadcast === undefined || reformatable.applyPending === undefined) return instance;

  const unsubscribe = broadcast.subscribe((timezone) => {
    reformatable.applyPending?.({ timezone });
  });

  const originalDetach = instance.detach.bind(instance);
  instance.detach = (): HTMLElement => {
    unsubscribe();
    return originalDetach();
  };
  return instance;
}
