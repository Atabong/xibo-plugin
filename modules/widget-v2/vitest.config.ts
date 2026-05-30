import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // SPEC-CRWDQ-014 AC10 runs the config suite under jsdom so the
    // PreferenceStore round-trips against a real WHATWG LocalStorage. Other
    // suites stay on node (no behavioural change).
    environmentMatchGlobs: [['tests/config/**', 'jsdom']],
  },
});
