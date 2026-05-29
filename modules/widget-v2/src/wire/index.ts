/**
 * SPEC-CRWDQ-017 wire-protocol module barrel (local twin).
 *
 * This is the single import surface for the wire contract. The transport
 * module imports types and the `parseLine` / `buildEnvelope` / `serialize`
 * helpers from here only — it holds no hand-rolled duplicates. When the
 * backend ships the generated TS twin, re-point these re-exports at it.
 */
export * from './types';
export * from './errors';
export * from './codec';
