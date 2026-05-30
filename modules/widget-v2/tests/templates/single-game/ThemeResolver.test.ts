import { describe, it, expect } from 'vitest';
import {
  resolveTheme,
  themeAttr,
  THEME_ATTR_DEFAULT,
  THEME_ATTR_UNSET,
  type BarThemeSource,
} from '../../../src/render/ThemeResolver';
import type { ThemeChoiceWire } from '../../../src/wire';

/** A real bar-theme source over a fixed applied theme (or none). */
class FixedBarTheme implements BarThemeSource {
  constructor(private readonly theme: ThemeChoiceWire | null) {}
  currentBarTheme(): ThemeChoiceWire | null {
    return this.theme;
  }
}

describe('resolveTheme', () => {
  it('uses a non-empty PlannedState theme_id as the set theme', () => {
    expect(resolveTheme('midnight', new FixedBarTheme(null))).toEqual({
      state: 'set',
      id: 'midnight',
    });
  });

  it('falls through to the bar-wide theme when theme_id is null', () => {
    const bar = new FixedBarTheme({ state: 'set', id: 'bar-dark' });
    expect(resolveTheme(null, bar)).toEqual({ state: 'set', id: 'bar-dark' });
  });

  it('resolves to default when theme_id is null and no ConfigPush applied', () => {
    expect(resolveTheme(null, new FixedBarTheme(null))).toEqual({ state: 'default' });
  });

  it('preserves an explicit bar-wide unset distinct from default', () => {
    expect(resolveTheme(null, new FixedBarTheme({ state: 'unset' }))).toEqual({ state: 'unset' });
  });
});

describe('themeAttr', () => {
  it('encodes a set theme as its id', () => {
    expect(themeAttr({ state: 'set', id: 'midnight' })).toBe('midnight');
  });

  it('encodes default and unset as distinct sentinels', () => {
    expect(themeAttr({ state: 'default' })).toBe(THEME_ATTR_DEFAULT);
    expect(themeAttr({ state: 'unset' })).toBe(THEME_ATTR_UNSET);
    expect(THEME_ATTR_DEFAULT).not.toBe(THEME_ATTR_UNSET);
  });
});
