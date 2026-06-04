/**
 * SPEC-CRWDQ-S11 — resolve a team's crest image URL from the AssetManifest.
 *
 * The backend AssetManifest publishes one entry per team crest with
 * `kind: 'crest'` and `ref: <team name_key>` (the lower-cased, space-collapsed
 * display name — matching the backend `teamNameKey`). A template that knows a
 * team's display name asks this resolver for a ready-to-use `<img src>` URL:
 *
 *   1. normalise the display name → name_key (must match the backend exactly),
 *   2. find the crest manifest entry whose `ref` === name_key,
 *   3. read its bytes from the `AssetManifestStore` hot cache (warmed eagerly
 *      on manifest receipt) and return the object/data URL.
 *
 * A miss (no manifest entry, or bytes not yet warmed) returns `null` so the
 * caller renders its existing colour-block fallback — NEVER a broken image and
 * never a fabricated crest. On a hot-cache miss the resolver kicks an async
 * `ensure()` so the NEXT render finds the bytes warm.
 */
import type { AssetManifestStore, AssetEntry } from './AssetManifestStore';

/**
 * Normalise a team display name to the manifest `ref` key. MUST match the
 * backend `teamNameKey` (src/catalog/team-brand-seed.ts):
 * `name.trim().toLowerCase().replace(/\s+/g, ' ')`.
 */
export function teamNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class CrestResolver {
  /** Built lazily + rebuilt on each manifest apply: name_key → asset_id. */
  private crestByRef = new Map<string, string>();
  /** asset_ids we've already kicked a warm-fetch for this manifest version, so
   *  a per-frame render never re-fires a fetch (and a failed/unreachable crest
   *  never churns the network). Cleared on each manifest apply. */
  private warmAttempted = new Set<string>();

  /** Listeners notified when a crest's bytes become available (warmed), so a
   *  mounted template can re-paint and swap the badge in. */
  private readonly readyListeners = new Set<() => void>();

  constructor(private readonly store: AssetManifestStore) {
    this.rebuildIndex();
    // Rebuild the ref→asset_id index whenever a new manifest is applied.
    this.store.subscribeManifest(() => this.rebuildIndex());
  }

  /**
   * Subscribe to "a crest just warmed" — fired after a best-effort `ensure()`
   * resolves so a mounted scoreboard can re-paint and swap the real badge in
   * (the operator requirement: render immediately, swap the crest in WHEN it
   * loads). Returns an unsubscribe fn. The callback must be cheap + must not
   * throw (a re-paint).
   */
  onCrestReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private notifyReady(): void {
    for (const l of this.readyListeners) {
      try {
        l();
      } catch {
        /* a re-paint listener must never break the resolver. */
      }
    }
  }

  private rebuildIndex(): void {
    const next = new Map<string, string>();
    for (const entry of this.store.manifestEntries() as readonly AssetEntry[]) {
      const e = entry as AssetEntry & { kind?: string; ref?: string };
      if (e.kind === 'crest' && typeof e.ref === 'string' && e.ref.length > 0) {
        next.set(e.ref, e.asset_id);
      }
    }
    this.crestByRef = next;
    // A new manifest may carry fresh bytes / fixed URLs — allow one warm
    // attempt per id again.
    this.warmAttempted = new Set<string>();
  }

  /** The crest asset_id for a team display name, or null when none is published. */
  assetIdForTeam(teamName: string | undefined): string | null {
    if (!teamName) return null;
    return this.crestByRef.get(teamNameKey(teamName)) ?? null;
  }

  /**
   * A ready `<img src>` URL for the team's crest, or null on a miss (caller
   * falls back to the colour block). Reads synchronously from the hot cache; on
   * a cold-cache hit-but-not-warmed it returns null AND warms for next time.
   */
  crestUrlForTeam(teamName: string | undefined): string | null {
    const assetId = this.assetIdForTeam(teamName);
    if (assetId === null) return null;
    const cached = this.store.get(assetId);
    if (cached) return cached.url;
    // Bytes not warm yet — kick ONE best-effort warm-fetch (fire-and-forget,
    // never awaited by the render path) so a LATER render can swap the badge
    // in. Guarded by `warmAttempted` so a per-frame render of an unreachable /
    // slow crest never re-fires the fetch (no churn). Always returns null here
    // so the caller renders its colour-block fallback IMMEDIATELY — the render
    // NEVER blocks or hangs on a crest. The CrestResolver does not even hold the
    // bytes; it only reads what AssetManifestStore has already cached.
    if (!this.warmAttempted.has(assetId)) {
      this.warmAttempted.add(assetId);
      void this.store
        .ensure(assetId)
        .then(() => {
          // Bytes are now warm — tell mounted templates to re-paint so the
          // real badge swaps in over the colour block.
          this.notifyReady();
        })
        .catch(() => {
          /* unreachable/slow/hash-mismatch crest — stay on the colour block. */
        });
    }
    return null;
  }
}
