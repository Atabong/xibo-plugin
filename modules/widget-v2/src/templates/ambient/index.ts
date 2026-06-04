/**
 * SPEC-CRWDQ-053 — ambient template barrel (D-GRH-30 mode #9).
 *
 * The AssetManifest-driven `ambient` template, its playlist resolver, and the
 * activator adapter (with the D-GRH-27 empty-manifest fallback to safe_info).
 * The adapter plugs into the SHARED SPEC-CRWDQ-023 activator — never a forked
 * orchestration (INV-FACTORY-19).
 */
export { AmbientTemplate } from './AmbientTemplate';
export type { AmbientContext, AmbientInstance } from './AmbientTemplate';
export { AmbientPlaylist } from './AmbientPlaylist';
export type { AmbientCreative, AmbientPlaylistDeps } from './AmbientPlaylist';
export { makeAmbientAdapter } from './AmbientAdapter';
export type { AmbientAdapterDeps } from './AmbientAdapter';
