/**
 * SPEC-CRWDQ-053 — the ambient playlist resolver (D-GRH-26 + D-GRH-27).
 *
 * Pulls the gap-filling sponsor / branding / neutral creatives the ambient
 * template rotates straight out of the SPEC-CRWDQ-064 `AssetManifestStore`: the
 * playlist is every `ambient:`-prefixed entry in the applied manifest, ordered
 * by `asset_id` lexical (issue #58 AC — the SPEC-CRWDQ-064 `AssetEntry` carries
 * no `ambient_seq` field the spec's draft interface assumed, so lexical id order
 * is the only deterministic order the entry shape supports).
 *
 * Phase-1 is image-only (D-GRH-27): a `video/*` entry is dropped and the batch
 * of skipped ids is journaled `ambient_video_deferred` once per resolve so the
 * backend can detect that video creatives are being authored ahead of player
 * support. `resolve()` reads the LIVE applied set every call, so the ambient
 * template can re-resolve at a dwell boundary to pick up a mid-mount manifest
 * push (D-GRH-27 "re-fetches at the next safe dwell window") without this
 * resolver holding any cached snapshot of its own.
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { RenderJournal } from '../../render/RenderJournal';

/** The `asset_id` prefix that marks an ambient creative (D-GRH-27). */
const AMBIENT_PREFIX = 'ambient:';

/** One resolved ambient creative the template paints into the stage. */
export interface AmbientCreative {
  asset_id: string;
  /** Fully-qualified asset url (D-GRH-74) the `<img src>` resolves from. */
  url: string;
  /** Phase-1 is always `image`; `video` entries never reach this list. */
  content_type: 'image';
}

export interface AmbientPlaylistDeps {
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
}

export class AmbientPlaylist {
  private readonly assetManifestStore: AssetManifestStore;
  private readonly journal: RenderJournal;

  constructor(deps: AmbientPlaylistDeps) {
    this.assetManifestStore = deps.assetManifestStore;
    this.journal = deps.journal;
  }

  /**
   * Resolve the current ambient playlist from the applied manifest: every
   * `ambient:` entry, image-category only, ordered by `asset_id` lexical. Video
   * entries are dropped with one `ambient_video_deferred` journaled when any was
   * skipped. An empty result is a valid playlist — the caller routes it to the
   * safe_info fallback (D-GRH-27).
   */
  resolve(): AmbientCreative[] {
    const ambient = this.assetManifestStore
      .manifestEntries()
      .filter((e) => e.asset_id.startsWith(AMBIENT_PREFIX));

    const deferred: string[] = [];
    const creatives: AmbientCreative[] = [];
    for (const entry of ambient) {
      if (isImage(entry.content_type)) {
        creatives.push({ asset_id: entry.asset_id, url: entry.url, content_type: 'image' });
      } else {
        deferred.push(entry.asset_id);
      }
    }

    if (deferred.length > 0) {
      this.journal.record({ type: 'ambient_video_deferred', skipped: deferred.sort() });
    }

    creatives.sort((a, b) => (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0));
    return creatives;
  }
}

/** True for an `image/*` content type (phase-1 keeps only these). */
function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}
