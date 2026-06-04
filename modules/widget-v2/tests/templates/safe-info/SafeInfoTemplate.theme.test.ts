/**
 * SPEC-CRWDQ-052 (part 2) — the dedicated SPEC-CRWDQ-023 three-state theme
 * distinctness proof for the safe_info render, plus the source-level motion
 * negative part 1 deferred.
 *
 * Part 1 rendered `data-theme` and proved the `{state:'default'}` case only;
 * the spec's AC1 names `ctx.theme` as the three-state `ResolvedTheme`, so this
 * suite proves `set` / `default` / `unset` render to three DISTINCT
 * `data-theme` attribute values (the sentinel distinction a theme stylesheet /
 * test relies on — a bar that chose "no override" is `unset`, not `default`).
 *
 * Part 1 asserted no INLINE motion on the body and noted that jsdom cannot
 * compute stylesheet CSS; the complementary negative here reads the shipped
 * `safe-info.css` SOURCE and proves it declares ZERO `animation` /
 * `transition` / `@keyframes` rules (AC6 / D-GRH-31 anti-flash). Together the
 * two assertions cover both the inline and the stylesheet motion surfaces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SafeInfoTemplate,
  type SafeInfoContext,
} from '../../../src/templates/safe-info/SafeInfoTemplate';
import {
  THEME_ATTR_DEFAULT,
  THEME_ATTR_UNSET,
  type ResolvedTheme,
} from '../../../src/render/ThemeResolver';
import type { SafeBarPreferences } from '../../../src/templates/safe-info/SafeInfoTemplate';
import { makeAssetStore } from './support';

const prefs = (): SafeBarPreferences => ({
  bar_id: 'bar-007',
  theme: { state: 'default' },
  sports: [],
  leagues: [],
  region: null,
  state: null,
  city: null,
  timezone: 'America/Chicago',
  business_hours: [],
  local_team_list: [],
  fallback_mode_order: [],
});

function mountWithTheme(theme: ResolvedTheme): HTMLElement {
  const host = document.createElement('div');
  const { store } = makeAssetStore();
  const ctx: SafeInfoContext = {
    programSlot: null,
    theme,
    barPreferences: prefs(),
    assetManifestStore: store,
    source: { kind: 'backend_planned', reason: 'scheduled' },
  };
  new SafeInfoTemplate().mount(host, ctx);
  return host.querySelector<HTMLElement>('.crowdaq-safe-info')!;
}

describe('SafeInfoTemplate three-state theme rendering (SPEC-CRWDQ-052 part 2, AC1)', () => {
  it('renders data-theme distinctly for set / default / unset', () => {
    const set = mountWithTheme({ state: 'set', id: 'sunset-bar' });
    const def = mountWithTheme({ state: 'default' });
    const unset = mountWithTheme({ state: 'unset' });

    expect(set.dataset['theme']).toBe('sunset-bar');
    expect(def.dataset['theme']).toBe(THEME_ATTR_DEFAULT);
    expect(unset.dataset['theme']).toBe(THEME_ATTR_UNSET);

    // The three states must be pairwise DISTINCT (unset is NOT default).
    const values = [set.dataset['theme'], def.dataset['theme'], unset.dataset['theme']];
    expect(new Set(values).size).toBe(3);
  });

  it('a set theme carries the bar-chosen id verbatim (no sentinel collision)', () => {
    // A real theme id must never equal a sentinel, else the distinction breaks.
    for (const id of ['neon', 'classic', 'high-contrast']) {
      const root = mountWithTheme({ state: 'set', id });
      expect(root.dataset['theme']).toBe(id);
      expect(root.dataset['theme']).not.toBe(THEME_ATTR_DEFAULT);
      expect(root.dataset['theme']).not.toBe(THEME_ATTR_UNSET);
    }
  });
});

describe('safe-info.css declares zero motion (SPEC-CRWDQ-052 part 2, AC6 stylesheet negative)', () => {
  // The suite runs under jsdom, where `import.meta.url` is not a file URL, so
  // resolve from the package root (vitest's cwd) instead.
  const cssPath = resolve(process.cwd(), 'src/templates/safe-info/safe-info.css');
  const css = readFileSync(cssPath, 'utf8');

  // Strip block + line comments so prose mentioning "animation"/"transition"
  // in the file header is not mistaken for a declared rule.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('declares no animation / transition properties and no @keyframes', () => {
    expect(code).not.toMatch(/\banimation(-[a-z]+)?\s*:/i);
    expect(code).not.toMatch(/\btransition(-[a-z]+)?\s*:/i);
    expect(code).not.toMatch(/@keyframes/i);
  });

  it('still ships real layout rules (the strip did not empty the sheet)', () => {
    // Guard the negative above: prove the sheet is non-trivial so the test
    // cannot pass merely because the file was blanked.
    expect(code).toMatch(/\.crowdaq-safe-info\s*\{/);
    expect(code).toMatch(/\.cdq-safe-body\s*\{/);
  });
});
