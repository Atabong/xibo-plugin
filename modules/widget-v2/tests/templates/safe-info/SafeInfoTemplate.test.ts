/**
 * SPEC-CRWDQ-052 (part 1) — the `safe_info` template's render contract, tested
 * through its public `mount(host, ctx)` surface (INV-FACTORY-16).
 *
 * Covers AC1 (DOM shape), AC2 (venue-brand fallback chain), AC7 (footer
 * source/reason map), AC6 (no motion on the body), and AC9 (offline-safe: no
 * fetch, asset read synchronously from AssetManifestStore.get). The render is
 * a pure function of its context, so no clock or activator is needed here —
 * the activation-path wiring is exercised in the controller suite.
 */
import { describe, it, expect } from 'vitest';
import {
  SafeInfoTemplate,
  SAFE_INFO_TESTID,
  venueBrandAssetId,
  type SafeInfoContext,
  type SafeSource,
} from '../../../src/templates/safe-info/SafeInfoTemplate';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { SafeBarPreferences } from '../../../src/templates/safe-info/SafeInfoTemplate';
import { makeAssetStore, seedVenueBrand } from './support';

const theme: ResolvedTheme = { state: 'default' };

const prefs = (over: Partial<SafeBarPreferences> = {}): SafeBarPreferences => ({
  bar_id: 'bar-007',
  theme: { state: 'default' },
  sports: [],
  leagues: [],
  region: null,
  state: 'IL',
  city: 'Chicago',
  timezone: 'America/Chicago',
  business_hours: [],
  local_team_list: [],
  fallback_mode_order: [],
  ...over,
});

function mountCtx(over: Partial<SafeInfoContext> = {}): {
  host: HTMLElement;
  ctx: SafeInfoContext;
} {
  const host = document.createElement('div');
  const { store } = makeAssetStore();
  const ctx: SafeInfoContext = {
    programSlot: null,
    theme,
    barPreferences: prefs(),
    assetManifestStore: store,
    source: { kind: 'backend_planned', reason: 'scheduled' },
    ...over,
  };
  return { host, ctx };
}

const root = (host: HTMLElement): HTMLElement =>
  host.querySelector<HTMLElement>('.crowdaq-safe-info')!;

describe('SafeInfoTemplate render (SPEC-CRWDQ-052 part 1)', () => {
  it('renders the section/header/body/footer skeleton with data attributes (AC1)', () => {
    const { host, ctx } = mountCtx();
    new SafeInfoTemplate().mount(host, ctx);

    const section = root(host);
    expect(section).not.toBeNull();
    expect(section.dataset['source']).toBe('backend_planned');
    expect(section.dataset['reason']).toBe('scheduled');
    expect(section.dataset['theme']).toBe('__default__');

    expect(section.querySelector(`[data-testid="${SAFE_INFO_TESTID.header}"]`)).not.toBeNull();
    expect(section.querySelector(`[data-testid="${SAFE_INFO_TESTID.body}"]`)).not.toBeNull();
    expect(section.querySelector(`[data-testid="${SAFE_INFO_TESTID.footer}"]`)).not.toBeNull();

    const title = section.querySelector<HTMLElement>(`[data-testid="${SAFE_INFO_TESTID.title}"]`)!;
    expect(title.textContent).toBe('CROWDAQ');
    const tagline = section.querySelector<HTMLElement>(
      `[data-testid="${SAFE_INFO_TESTID.tagline}"]`,
    )!;
    expect(tagline.textContent).toBe('Live sports excitement');
  });

  describe('venue-brand fallback chain (AC2)', () => {
    it('rung 1: a cached venue-brand asset renders an <img>, not text', async () => {
      const { host, ctx } = mountCtx();
      await seedVenueBrand(ctx.assetManifestStore, venueBrandAssetId('bar-007'));

      new SafeInfoTemplate().mount(host, ctx);

      const brand = root(host).querySelector<HTMLElement>(
        `[data-testid="${SAFE_INFO_TESTID.venue}"]`,
      )!;
      const img = brand.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('blob:venue_brand:bar-007');
      expect(brand.textContent).toBe('');
    });

    it('rung 2: asset miss + city/state present renders uppercased text', () => {
      const { host, ctx } = mountCtx();
      new SafeInfoTemplate().mount(host, ctx);

      const brand = root(host).querySelector<HTMLElement>(
        `[data-testid="${SAFE_INFO_TESTID.venue}"]`,
      )!;
      expect(brand.querySelector('img')).toBeNull();
      expect(brand.textContent).toBe('CHICAGO, IL');
    });

    it('rung 3: asset miss + empty city/state falls back to the wordmark only', () => {
      const { host, ctx } = mountCtx({ barPreferences: prefs({ city: null, state: null }) });
      new SafeInfoTemplate().mount(host, ctx);

      const brand = root(host).querySelector<HTMLElement>(
        `[data-testid="${SAFE_INFO_TESTID.venue}"]`,
      )!;
      expect(brand.querySelector('img')).toBeNull();
      expect(brand.textContent).toBe('');
    });

    it('rung 3: null barPreferences resolves to the wordmark only', () => {
      const { host, ctx } = mountCtx({ barPreferences: null });
      new SafeInfoTemplate().mount(host, ctx);

      const brand = root(host).querySelector<HTMLElement>(
        `[data-testid="${SAFE_INFO_TESTID.venue}"]`,
      )!;
      expect(brand.querySelector('img')).toBeNull();
      expect(brand.textContent).toBe('');
    });
  });

  describe('footer status text matches the source/reason map exactly (AC7)', () => {
    const cases: Array<[SafeSource, string]> = [
      [{ kind: 'backend_planned', reason: 'scheduled' }, ''],
      [{ kind: 'backend_planned', reason: 'no_content' }, ''],
      [{ kind: 'backend_planned', reason: 'maintenance' }, 'Brief pause'],
      [{ kind: 'player_fallback', reason: 'control_channel_lost' }, 'Reconnecting…'],
      [{ kind: 'player_fallback', reason: 'data_stale' }, 'Refreshing…'],
      [{ kind: 'player_fallback', reason: 'no_recent_state' }, 'Loading…'],
      [{ kind: 'template_escalation', reason: 'template_input_invalid' }, 'Loading…'],
      [{ kind: 'template_escalation', reason: 'template_buffer_timeout' }, 'Loading…'],
    ];

    it.each(cases)('%o -> %j', (source, expected) => {
      const { host, ctx } = mountCtx({ source });
      new SafeInfoTemplate().mount(host, ctx);

      const section = root(host);
      expect(section.dataset['source']).toBe(source.kind);
      expect(section.dataset['reason']).toBe(source.reason);
      const status = section.querySelector<HTMLElement>(
        `[data-testid="${SAFE_INFO_TESTID.status}"]`,
      )!;
      expect(status.textContent).toBe(expected);
    });
  });

  it('applies no animation/transition CSS to any .cdq-safe-body descendant (AC6)', () => {
    const { host, ctx } = mountCtx();
    new SafeInfoTemplate().mount(host, ctx);

    const body = root(host).querySelector<HTMLElement>('.cdq-safe-body')!;
    const descendants = [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))];
    for (const el of descendants) {
      const style = el.getAttribute('style') ?? '';
      expect(style).not.toMatch(/animation/i);
      expect(style).not.toMatch(/transition/i);
      // No inline keyframe-driven animation-name is set on any body node.
      expect(el.style.animationName === '' || el.style.animationName === 'none').toBe(true);
    }
  });

  it('is offline-safe: mounting drives NO asset fetch (AC9)', async () => {
    const { host, ctx } = mountCtx();
    const { store, fetcher } = makeAssetStore();
    await seedVenueBrand(store, venueBrandAssetId('bar-007'));
    const fetchedBefore = fetcher.fetched.length;
    ctx.assetManifestStore = store;

    new SafeInfoTemplate().mount(host, ctx);

    // mount() reads only via the synchronous get(); it never calls ensure().
    expect(fetcher.fetched.length).toBe(fetchedBefore);
  });

  it('detach() returns the root and removes it from the host', () => {
    const { host, ctx } = mountCtx();
    const instance = new SafeInfoTemplate().mount(host, ctx);
    expect(root(host)).not.toBeNull();

    const detached = instance.detach();
    expect(detached.classList.contains('crowdaq-safe-info')).toBe(true);
    expect(host.querySelector('.crowdaq-safe-info')).toBeNull();
  });
});
