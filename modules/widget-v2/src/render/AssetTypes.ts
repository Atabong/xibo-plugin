/**
 * SPEC-CRWDQ-064 — wire-adjacent asset types owned by this spec.
 *
 * The SPEC-CRWDQ-017 wire barrel exports `AssetManifestFrame` only as a marker
 * (`message_type: 'AssetManifest'`); it does NOT own the payload shape. THIS
 * spec owns `AssetManifestPayload` + the asset-entry shape, so they live here
 * and the frame is modelled as `Envelope<AssetManifestPayload>`.
 */

/** Generic control-frame envelope carrying a typed payload. */
export interface Envelope<P> {
  message_type: string;
  payload: P;
}

/** The `AssetManifest` frame: an envelope around an {@link AssetManifestPayload}. */
export type AssetManifestFrame = Envelope<AssetManifestPayload> & {
  message_type: 'AssetManifest';
};

/** The manifest body: a version stamp plus the full asset set. */
export interface AssetManifestPayload {
  version: string;
  assets: AssetEntry[];
}

/** One asset's descriptor (per D-GRH-23, D-GRH-31, D-GRH-55, D-GRH-74). */
export interface AssetEntry {
  asset_id: string;
  /** `sha256:<hex>` — verified against fetched bytes. */
  content_hash: string;
  /** Fully qualified per D-GRH-74 (R2). The store does not synthesize URLs. */
  url: string;
  content_type: string;
  /** Manifest-level version this entry belongs to. */
  version: string;
  /** ISO 8601 UTC soft pre-fetch deadline, or null (no eager pre-fetch). */
  needed_by: string | null;
}

/** A cached asset's bytes plus the metadata needed to render it. */
export interface CachedAsset {
  asset_id: string;
  content_hash: string;
  /** Object/data URL resolvable from `<img src>`, `<link href>`, etc. */
  url: string;
  content_type: string;
  /** Raw bytes for callers that need them (e.g. JSON animation defs). */
  bytes: ArrayBuffer;
}

/** Raised when an `ensure()` fetch fails (network, retry-exhausted, or hash). */
export class AssetFetchError extends Error {
  constructor(
    public readonly entry: AssetEntry,
    public readonly cause: unknown,
  ) {
    super(`AssetFetchError: ${entry.asset_id} (${entry.url})`);
    this.name = 'AssetFetchError';
  }
}
