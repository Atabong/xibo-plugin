/*
 * ESLint config for the CROWDAQ Xibo plugin onRender JS.
 *
 * Target runtime: the Xibo Player's Chromium (>= 60), so ES2019 source
 * level is safe. The onRender CDATA block is extracted into a temp
 * file by scripts/extract-onrender.mjs before lint; see .github/workflows/ci.yml.
 *
 * Pins: eslint 8.57.1 (committed in .github/workflows/ci.yml install step).
 */
module.exports = {
    root: true,
    env: {
        browser: true,
        es2019: true,
    },
    parserOptions: {
        ecmaVersion: 2019,
        sourceType: 'script',
    },
    globals: {
        // Xibo CMS injects jQuery ($) into the player's Chromium at
        // render time. The renderer IIFE also receives `id`, `target`,
        // `items`, `properties` as parameters via the manifest's
        // wrapping function, but when the block is extracted for lint
        // those are not declared — mark them known.
        id: 'readonly',
        target: 'readonly',
        items: 'readonly',
        properties: 'readonly',
        $: 'readonly',
        // xiboIC is the Xibo Interactive Control global exposed by the
        // player's Chromium runtime (from the `xibo-interactive-control`
        // npm package, bundled by Xibo into modules/src/player_bundle.js).
        // Used here to call xiboIC.info() for multi-bar targeting via
        // display:<field> property resolution — see docs/TARGETING.md.
        xiboIC: 'readonly',
    },
    rules: {
        'no-unused-vars': ['error', { args: 'none' }],
        'no-undef': 'error',
        'no-redeclare': 'error',
        eqeqeq: ['error', 'smart'],
        'no-var': 'off',
        'no-console': 'warn',
    },
};
