import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // SPEC-CRWDQ-014 AC10 runs the config suite under jsdom so the
    // PreferenceStore round-trips against a real WHATWG LocalStorage.
    // SPEC-CRWDQ-023 template tests mount real DOM, so the single-game suite
    // also runs under jsdom. SPEC-CRWDQ-049 overlay tests mount the overlay
    // layer into a real DOM, so the overlays suite runs under jsdom too.
    // SPEC-CRWDQ-063 mounts the canned override overlay into real DOM, so the
    // overrides suite runs under jsdom as well. Other suites stay on node (no
    // behavioural change).
    // SPEC-CRWDQ-S58 never-blank escalation tests mount real DOM through the
    // activator + SafeStateController, so the render suite runs under jsdom too.
    environmentMatchGlobs: [
      ['tests/config/**', 'jsdom'],
      ['tests/templates/**', 'jsdom'],
      ['tests/overlays/**', 'jsdom'],
      ['tests/overrides/**', 'jsdom'],
      ['tests/render/**', 'jsdom'],
    ],
  },
});
