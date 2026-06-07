/**
 * SPEC-CRWDQ-034 / D-GRH-73 — live bar-timezone broadcast for the fixtures
 * board(s).
 *
 * The fixtures adapters evaluate the bar timezone lazily at `mount` (a thunk),
 * which fixes the cold-boot freeze where the pre-ConfigPush 'UTC' fallback was
 * baked into every render. That alone re-formats correctly on the NEXT mount.
 * But a bar-preference EDIT (a `replaced` ConfigPush carrying a new `timezone`)
 * must visibly re-format the ALREADY-MOUNTED board WITHOUT waiting for a
 * remount — the operator's "guaranteed handling of time for every bar".
 *
 * This is the seam for that. A mounted fixtures instance `subscribe`s a
 * reformat callback (its `applyPending({ timezone })`); the composition root
 * calls `broadcast(timezone)` whenever a ConfigPush changes the bar's zone. It
 * is deliberately INDEPENDENT of the SPEC-014 single pending-apply slot (which
 * the activator drains for the theme swap at a dwell boundary) so the two never
 * race over a single-slot read — the timezone reformat is idempotent and may
 * fire immediately, while the theme swap stays gated to the dwell boundary.
 *
 * `subscribe` returns an unsubscribe the instance calls from `detach()` so a
 * superseded board never receives a reformat for DOM it no longer owns.
 */

/** A live reformat sink — typically a fixtures instance's `applyPending`. */
export type TimezoneReformat = (timezone: string) => void;

export class FixturesTimezoneBroadcast {
  private readonly sinks = new Set<TimezoneReformat>();

  /** Register a live board's reformat sink; returns an unsubscribe for detach. */
  subscribe(sink: TimezoneReformat): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  /** Re-format every currently-subscribed board under the new bar timezone. */
  broadcast(timezone: string): void {
    for (const sink of this.sinks) sink(timezone);
  }

  /** Whether any live board is currently subscribed (test/observability read). */
  get size(): number {
    return this.sinks.size;
  }
}
