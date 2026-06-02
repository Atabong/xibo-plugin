/**
 * SPEC-CRWDQ-053 — the `ambient` business-mode template (D-GRH-30 mode #9).
 *
 * A single-slot, AssetManifest-driven rotation of sponsor / branding / neutral
 * creatives (D-GRH-26 + D-GRH-27). No `ProgramSlot`, no `AdSlot`, no game data —
 * the whole playlist comes from {@link AmbientPlaylist} over the SPEC-CRWDQ-064
 * asset cache. One creative is visible at a time inside `.cdq-ambient-stage`;
 * rotation swaps the `<img src>` + `data-asset-id` on each dwell boundary.
 *
 * The dwell is INDEFINITE (D-GRH-26): the template re-arms its own
 * {@link DwellTimer} after every boundary and never auto-detaches — it runs
 * until the activator supersedes it with a new `PlannedState`, at which point
 * `detach()` cancels the rotation timer (the activator separately cancels its
 * own PlannedState-level dwell on supersede, AC10).
 *
 * On each boundary the playlist is RE-RESOLVED so a mid-mount `AssetManifest`
 * push (D-GRH-27) is picked up without flicker: the active creative holds until
 * the boundary, then a changed playlist restarts at index 0 and journals
 * `ambient_playlist_refreshed`; an unchanged playlist advances modulo and
 * journals `ambient_creative_advanced`. The empty-playlist / video-only fallback
 * to `SafeInfoTemplate` is the adapter's concern (D-GRH-27) — this template is
 * only ever mounted with a non-empty playlist.
 *
 * Time is the only substituted boundary (INV-FACTORY-17): the {@link DwellTimer}
 * the caller injects carries the clock seam. The `<link rel="preload">` network
 * fetch is fire-and-forget; nothing here awaits it.
 */
import type { DwellTimer } from '../../render/DwellTimer';
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateInstance } from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { AmbientCreative, AmbientPlaylist } from './AmbientPlaylist';

/** How many upcoming creatives to keep warm via `<link rel="preload">` (AC7). */
const PRELOAD_AHEAD = 3;

export interface AmbientContext {
  /** SPEC-CRWDQ-023 three-state resolved theme (set/default/unset). */
  theme: ResolvedTheme;
  /** Per-creative rotation pace (D-GRH-26 — total dwell is indefinite). */
  dwellTargetMs: number;
  /** The live ambient playlist resolver (re-resolved on each boundary). */
  playlist: AmbientPlaylist;
  /** The shared rotation timer (carries the injected clock boundary). */
  dwell: DwellTimer;
  journal: RenderJournal;
}

/** The mounted ambient instance: a bare {@link TemplateInstance} (no reconcile). */
export type AmbientInstance = TemplateInstance;

export class AmbientTemplate {
  /**
   * Mount the ambient stage and arm the indefinite rotation. The caller must
   * pass a non-empty playlist; the empty / video-only fallback to safe_info is
   * the adapter's responsibility (D-GRH-27).
   */
  mount(host: HTMLElement, ctx: AmbientContext): AmbientInstance {
    return new AmbientLoop(host, ctx).start();
  }
}

/**
 * One mounted ambient render: owns the stage DOM, the active playlist + index,
 * and the self-re-arming rotation. Split out so the per-mount mutable state is
 * encapsulated and `detach()` can cancel cleanly (INV-FACTORY-19 deep module).
 */
class AmbientLoop implements AmbientInstance {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly img: HTMLImageElement;
  private playlist: AmbientCreative[];
  private activeIndex = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly ctx: AmbientContext,
  ) {
    this.playlist = ctx.playlist.resolve();
    this.root = document.createElement('section');
    this.root.className = 'crowdaq-ambient';
    this.root.dataset['theme'] = themeAttr(ctx.theme);

    this.stage = document.createElement('div');
    this.stage.className = 'cdq-ambient-stage';

    this.img = document.createElement('img');
    this.img.className = 'cdq-ambient-creative';
    this.img.alt = '';

    this.stage.append(this.img);
    this.root.append(this.stage);
  }

  /** Paint the first creative, prime the preload window, and arm the rotation. */
  start(): AmbientInstance {
    this.paintActive();
    this.host.append(this.root);
    this.refreshPreload();
    this.armRotation();
    return this;
  }

  /** Supersede teardown (AC10): cancel rotation, detach the root, hand it back. */
  detach(): HTMLElement {
    this.ctx.dwell.cancel();
    this.root.remove();
    return this.root;
  }

  /** Arm the next indefinite-dwell boundary; the boundary re-arms itself. */
  private armRotation(): void {
    this.ctx.dwell.arm(this.ctx.dwellTargetMs, () => this.onBoundary());
  }

  /**
   * One rotation boundary. Re-resolve the playlist so a mid-mount manifest push
   * is picked up: a changed playlist restarts at index 0 (`ambient_playlist_refreshed`),
   * an unchanged one advances modulo (`ambient_creative_advanced`). Either way
   * the preload window is refreshed and the rotation re-armed (indefinite dwell).
   */
  private onBoundary(): void {
    const fresh = this.ctx.playlist.resolve();
    if (playlistChanged(this.playlist, fresh)) {
      this.playlist = fresh;
      this.activeIndex = 0;
      this.paintActive();
      this.ctx.journal.record({
        type: 'ambient_playlist_refreshed',
        to: this.currentAssetId(),
        total: this.playlist.length,
      });
    } else {
      const from = this.currentAssetId();
      this.activeIndex = (this.activeIndex + 1) % this.playlist.length;
      this.paintActive();
      this.ctx.journal.record({
        type: 'ambient_creative_advanced',
        from,
        to: this.currentAssetId(),
        index: this.activeIndex,
        total: this.playlist.length,
      });
    }

    this.refreshPreload();
    this.armRotation();
  }

  /** Reflect the active creative onto the stage + `<img>` (AC1/AC4). */
  private paintActive(): void {
    const creative = this.playlist[this.activeIndex]!;
    this.stage.dataset['activeIndex'] = String(this.activeIndex);
    this.img.dataset['assetId'] = creative.asset_id;
    this.img.src = creative.url;
  }

  /**
   * Refresh the `<link rel="preload">` window to the next {@link PRELOAD_AHEAD}
   * creatives after the active index (wrapping). Replacing the links each time
   * keeps a long playlist from accumulating stale preloads (AC7 throttle).
   */
  private refreshPreload(): void {
    for (const link of Array.from(
      this.root.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'),
    )) {
      link.remove();
    }
    const total = this.playlist.length;
    const ahead = Math.min(PRELOAD_AHEAD, total - 1);
    for (let i = 1; i <= ahead; i += 1) {
      const creative = this.playlist[(this.activeIndex + i) % total]!;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.setAttribute('as', 'image');
      link.href = creative.url;
      this.root.append(link);
    }
  }

  private currentAssetId(): string {
    return this.playlist[this.activeIndex]!.asset_id;
  }
}

/** A playlist differs when its ordered asset-id sequence is not identical. */
function playlistChanged(prev: readonly AmbientCreative[], next: readonly AmbientCreative[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]!.asset_id !== next[i]!.asset_id) return true;
  }
  return false;
}
