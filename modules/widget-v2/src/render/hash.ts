/**
 * SHA-256 of raw bytes, returned as a lowercase hex string.
 *
 * Uses the platform `crypto.subtle.digest` (WebCrypto) — available globally in
 * Node 20 and in the browser/jsdom. This is the only place the store touches
 * the crypto boundary; the content-hash verifier in AssetManifestStore calls
 * here so the SHA-256 implementation itself is real in tests (per the spec
 * test strategy: "real SHA-256 from crypto.subtle.digest").
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const b of view) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
