/**
 * SPEC-CRWDQ-023 — named-animation transition executor (D-GRH-28/-31, AC9).
 *
 * `run({ animation_id, duration_ms }, host)` resolves the animation definition
 * in a fixed precedence and plays it, resolving when the transition completes:
 *
 *   1. pre-baked catalog (D-GRH-28) — animations compiled into the player;
 *   2. AssetManifest asset cache (D-GRH-31) — an animation-definition file
 *      delivered as an asset, read SYNCHRONOUSLY from the warm hot map;
 *   3. default fade (D-GRH-31) — when both miss.
 *
 * A catalog miss is journaled `transition_catalog_miss` (so backend can detect
 * authoring drift) but is NOT fatal: resolution falls through and the
 * transition always completes. Animation playback timing is a substitutable
 * boundary (INV-FACTORY-17): the {@link TransitionPlayer} is injected; the real
 * timing surface is exercised in SPEC-CRWDQ-027 e2e.
 */
import type { AssetManifestStore } from './AssetManifestStore';
import type { RenderJournal } from './RenderJournal';
import type { TransitionSpec } from './types';

/** Where a resolved animation definition came from (for the player + tests). */
export type TransitionSource = 'catalog' | 'asset_cache' | 'default';

/** A resolved, playable transition definition. */
export interface TransitionDefinition {
  animation_id: string;
  source: TransitionSource;
  /** Catalog/asset keyframes, or the synthesized default-fade descriptor. */
  keyframes: unknown;
}

/**
 * The substitutable animation-playback seam. Production plays the definition
 * over `durationMs` against `host` (Web Animations API); tests resolve
 * immediately and record what was played.
 */
export interface TransitionPlayer {
  play(definition: TransitionDefinition, host: HTMLElement, durationMs: number): Promise<void>;
}

/** Synthesized fallback when neither the catalog nor the asset cache resolves. */
export const DEFAULT_FADE: Readonly<{ animation_id: string; keyframes: unknown }> = Object.freeze({
  animation_id: 'fade',
  keyframes: { opacity: [0, 1] },
});

export interface TransitionExecutorDeps {
  /** Pre-baked animation catalog: animation_id -> keyframes (D-GRH-28). */
  catalog: ReadonlyMap<string, unknown>;
  assets: AssetManifestStore;
  player: TransitionPlayer;
  journal: RenderJournal;
}

export class TransitionExecutor {
  private readonly catalog: ReadonlyMap<string, unknown>;
  private readonly assets: AssetManifestStore;
  private readonly player: TransitionPlayer;
  private readonly journal: RenderJournal;

  constructor(deps: TransitionExecutorDeps) {
    this.catalog = deps.catalog;
    this.assets = deps.assets;
    this.player = deps.player;
    this.journal = deps.journal;
  }

  /** Resolve and play the transition; resolves when it completes. */
  async run(transition: TransitionSpec, host: HTMLElement): Promise<void> {
    const definition = this.resolve(transition.animation_id);
    await this.player.play(definition, host, transition.duration_ms);
  }

  private resolve(animationId: string): TransitionDefinition {
    const fromCatalog = this.catalog.get(animationId);
    if (fromCatalog !== undefined) {
      return { animation_id: animationId, source: 'catalog', keyframes: fromCatalog };
    }

    // Catalog miss — journal the drift, then fall through (non-fatal).
    this.journal.record({ type: 'transition_catalog_miss', animation_id: animationId });

    const cached = this.assets.get(animationId);
    if (cached !== null) {
      return { animation_id: animationId, source: 'asset_cache', keyframes: cached };
    }

    return {
      animation_id: DEFAULT_FADE.animation_id,
      source: 'default',
      keyframes: DEFAULT_FADE.keyframes,
    };
  }
}
