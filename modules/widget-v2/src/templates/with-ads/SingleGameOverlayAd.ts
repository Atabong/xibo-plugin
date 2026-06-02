/**
 * SPEC-CRWDQ-065 (#64) — the single_game overlay-ad creative seam.
 *
 * The single_game overlay-ad COMPOSITE shell is owned by the already-merged
 * SPEC-CRWDQ-023 part-2 `mountOverlayComposite`
 * (`src/templates/single-game/SingleGameOverlay.ts`): it builds the
 * `<section class="crowdaq-single-game-composite">`, the full-surface
 * `.cdq-content` host (the unmodified `SingleGameTemplate` output) and the
 * absolutely-positioned `.cdq-ad-overlay` host, branches the activator on a
 * non-null `ad_slot_id`, buffers until the ProgramSlot + AdSlot resolve, and
 * chains the children's detach on supersede. It DELEGATES the overlay creative
 * to the `SingleGameOverlayAd` seam — which is this module.
 *
 * This seam is intentionally a thin composition over the SPEC-CRWDQ-041
 * {@link AdPanel} primitive (INV-FACTORY-19 — compose, don't fork): it paints
 * exactly ONE static creative (D-GRH-62 — the player has no ad-progression
 * logic; no rotation, no cadence, no video, no click), positioned `top` so the
 * overlay floats above the score render without re-flowing it (D-GRH-15/16).
 * On a creative cache MISS `AdPanel` declines (returns null, journals
 * `ad_asset_cache_miss`, warms via `ensure`) and this seam leaves the overlay
 * EMPTY so the composite's full-surface content is preserved untouched.
 *
 * `ad_slot_rendered` fires on the image `load` event (owned by `AdPanel`).
 * `ad_slot_completed` is journaled at `detach()` with the slot identity and the
 * dwell read from the shared `DwellTimer` boundary supplied at construction.
 *
 * The creative is bound to the AdSlot for the slot's lifetime: a different ad
 * arrives as a NEW `PlannedState` (a normal supersede), never an in-place
 * mutation — so this instance has no reconcile concern of its own (the merged
 * composite forwards a `program_slot` revision into `.cdq-content`; the overlay
 * `<img>` is `AdSlot`-bound and never re-renders, D-GRH-13).
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type {
  SingleGameOverlayContext,
  SingleGameOverlayInstance,
  SingleGameOverlayAd as SingleGameOverlayAdSeam,
} from '../../templates/single-game/SingleGameOverlay';
import { AdPanel } from './AdPanel';

/** The deployment-wide collaborators the overlay-ad seam is built with. */
export interface SingleGameOverlayAdDeps {
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
  /**
   * Reads the actual dwell from the shared `DwellTimer` at supersede, filled
   * into `ad_slot_completed` (D-GRH-29). The activator owns the timer; this seam
   * only reads it at detach. Defaults to 0 when the host deployment has no dwell
   * wiring (e.g. a unit mount with no activator) — the merged part-2 seam
   * context does not yet thread a dwell reader through, so production currently
   * reads 0 until SPEC-CRWDQ-023's seam context carries it (DISCLOSED).
   */
  dwellActualMs?: () => number;
  /**
   * The `state_id` for the ad journals. The merged part-2 seam context
   * (`SingleGameContext & { adSlot }`) does not carry the PlannedState's
   * `state_id`, so production resolves it through this hook; absent, the
   * journals carry an empty `state_id` (DISCLOSED).
   */
  stateId?: () => string;
}

/**
 * Paints the single_game overlay ad. Satisfies the merged SPEC-CRWDQ-023
 * `SingleGameOverlayAd` seam so the part-2 composite can delegate to it.
 */
export class SingleGameOverlayAd implements SingleGameOverlayAdSeam {
  private readonly deps: SingleGameOverlayAdDeps;

  constructor(deps: SingleGameOverlayAdDeps) {
    this.deps = deps;
  }

  /**
   * Paint the overlay creative into `host` (the composite's `.cdq-ad-overlay`).
   * A cache miss leaves the overlay empty (`AdPanel` journaled the miss + warmed
   * the cache); content is preserved by the composite (D-GRH-16).
   */
  mount(host: HTMLElement, ctx: SingleGameOverlayContext): SingleGameOverlayInstance {
    const stateId = this.deps.stateId?.() ?? '';
    const panel = new AdPanel().mount(host, {
      adSlot: ctx.adSlot,
      assetManifestStore: this.deps.assetManifestStore,
      journal: this.deps.journal,
      stateId,
      positionClass: 'top',
    });

    const journal = this.deps.journal;
    const dwellActualMs = this.deps.dwellActualMs;
    const adSlot = ctx.adSlot;
    return {
      detach(): void {
        journal.record({
          type: 'ad_slot_completed',
          ad_slot_id: adSlot.ad_slot_id,
          ad_ref: adSlot.ad_ref,
          state_id: stateId,
          dwell_actual_ms: dwellActualMs?.() ?? 0,
        });
        panel?.detach();
      },
    };
  }
}
