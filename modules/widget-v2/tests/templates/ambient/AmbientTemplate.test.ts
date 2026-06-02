/**
 * SPEC-CRWDQ-053 (#58 part 1) — AmbientTemplate.mount renders the ambient stage
 * and runs the indefinite, dwell-paced rotation loop directly against the REAL
 * shared DwellTimer + AssetManifestStore + AmbientPlaylist (INV-FACTORY-16). The
 * only substituted boundary is the clock (vitest fake timers, INV-FACTORY-17);
 * the `<link rel="preload">` network fetch is never asserted on, only that the
 * link elements are inserted with the right href.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AmbientTemplate } from '../../../src/templates/ambient/AmbientTemplate';
import { AmbientPlaylist } from '../../../src/templates/ambient/AmbientPlaylist';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';
import { RecordingJournal, makeAssetStore, applyManifest, image, video } from './support';

const DWELL_MS = 5_000;
const DEFAULT_THEME: ResolvedTheme = { state: 'default' };

function mountAmbient(opts: {
  specs?: Array<ReturnType<typeof image>>;
  theme?: ResolvedTheme;
  dwellTargetMs?: number;
} = {}) {
  const host = document.createElement('div');
  const journal = new RecordingJournal();
  const store = makeAssetStore();
  applyManifest(store, opts.specs ?? [image('ambient:001'), image('ambient:002'), image('ambient:003')]);
  const playlist = new AmbientPlaylist({ assetManifestStore: store, journal });
  const template = new AmbientTemplate();
  const instance = template.mount(host, {
    theme: opts.theme ?? DEFAULT_THEME,
    dwellTargetMs: opts.dwellTargetMs ?? DWELL_MS,
    playlist,
    dwell: new DwellTimer(systemDwellClock),
    journal,
  });
  return { host, journal, store, instance };
}

const section = (host: ParentNode): HTMLElement | null =>
  host.querySelector<HTMLElement>('section.crowdaq-ambient');
const stage = (host: ParentNode): HTMLElement =>
  host.querySelector<HTMLElement>('.cdq-ambient-stage')!;
const creativeImg = (host: ParentNode): HTMLImageElement =>
  host.querySelector<HTMLImageElement>('img.cdq-ambient-creative')!;
const preloadHrefs = (host: ParentNode): string[] =>
  Array.from(host.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')).map(
    (l) => l.getAttribute('href') ?? '',
  );

describe('AmbientTemplate.mount + rotation (SPEC-CRWDQ-053 #58)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-02T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the ambient section with the first creative at index 0 (AC1)', () => {
    const { host } = mountAmbient();

    const root = section(host)!;
    expect(root).not.toBeNull();
    expect(root.dataset['theme']).toBe('__default__');
    expect(stage(host).dataset['activeIndex']).toBe('0');

    const img = creativeImg(host);
    expect(img.dataset['assetId']).toBe('ambient:001');
    expect(img.getAttribute('src')).toBe('https://cdn.example/ambient:001.png');
  });

  it('preloads the next 3 creatives at mount (AC7)', () => {
    const { host } = mountAmbient({
      specs: [image('ambient:001'), image('ambient:002'), image('ambient:003'), image('ambient:004'), image('ambient:005')],
    });
    // next-3 after the active index 0 -> entries 1,2,3.
    expect(preloadHrefs(host)).toEqual([
      'https://cdn.example/ambient:002.png',
      'https://cdn.example/ambient:003.png',
      'https://cdn.example/ambient:004.png',
    ]);
  });

  it('advances the active index modulo on each dwell boundary, swapping src + data-asset-id (AC4)', () => {
    const { host, journal } = mountAmbient();

    vi.advanceTimersByTime(DWELL_MS);
    expect(stage(host).dataset['activeIndex']).toBe('1');
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:002');
    expect(creativeImg(host).getAttribute('src')).toBe('https://cdn.example/ambient:002.png');

    const advanced = journal.typesOf('ambient_creative_advanced');
    expect(advanced).toHaveLength(1);
    expect(advanced[0]).toMatchObject({
      from: 'ambient:001',
      to: 'ambient:002',
      index: 1,
      total: 3,
    });
  });

  it('wraps around to index 0 after the last creative (AC4)', () => {
    const { host } = mountAmbient();
    vi.advanceTimersByTime(DWELL_MS); // -> 1
    vi.advanceTimersByTime(DWELL_MS); // -> 2
    vi.advanceTimersByTime(DWELL_MS); // -> 0 (wrap)
    expect(stage(host).dataset['activeIndex']).toBe('0');
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:001');
  });

  it('refreshes the preload window after each rotation (AC7)', () => {
    const { host } = mountAmbient({
      specs: [image('ambient:001'), image('ambient:002'), image('ambient:003'), image('ambient:004')],
    });
    vi.advanceTimersByTime(DWELL_MS); // active -> index 1 (ambient:002)
    // next-3 after index 1 wrap: 2,3,0 -> ambient:003, ambient:004, ambient:001.
    expect(preloadHrefs(host)).toEqual([
      'https://cdn.example/ambient:003.png',
      'https://cdn.example/ambient:004.png',
      'https://cdn.example/ambient:001.png',
    ]);
  });

  it('continues rotating indefinitely without auto-detaching (AC9)', () => {
    const { host, journal } = mountAmbient();
    for (let i = 0; i < 10; i += 1) vi.advanceTimersByTime(DWELL_MS);
    expect(section(host)).not.toBeNull();
    expect(journal.typesOf('ambient_creative_advanced')).toHaveLength(10);
  });

  it('picks up a mid-mount manifest update on the next boundary, restarting at index 0 (AC5)', () => {
    const { host, journal, store } = mountAmbient({
      specs: [image('ambient:001'), image('ambient:002')],
    });
    vi.advanceTimersByTime(DWELL_MS); // index -> 1 (ambient:002)
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:002');

    // Operator pushes new ambient branding mid-mount.
    applyManifest(store, [image('ambient:aaa'), image('ambient:bbb'), image('ambient:ccc')], 'v2');

    // Still showing the prior creative until the next boundary (no flicker).
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:002');

    vi.advanceTimersByTime(DWELL_MS);
    // New playlist starts at index 0.
    expect(stage(host).dataset['activeIndex']).toBe('0');
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:aaa');
    expect(journal.typesOf('ambient_playlist_refreshed')).toHaveLength(1);
  });

  it('does not advance for a single-creative playlist but stays mounted', () => {
    const { host, journal } = mountAmbient({ specs: [image('ambient:solo')] });
    vi.advanceTimersByTime(DWELL_MS);
    expect(stage(host).dataset['activeIndex']).toBe('0');
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:solo');
    expect(section(host)).not.toBeNull();
    // One creative still journals an advance (index wraps to itself) per AC4 modulo.
    expect(journal.typesOf('ambient_creative_advanced')).toHaveLength(1);
  });

  it('cancels the rotation timer on detach (AC10) and returns the root node', () => {
    const { host, journal, instance } = mountAmbient();
    const node = instance.detach();
    expect(node.classList.contains('crowdaq-ambient')).toBe(true);
    expect(section(host)).toBeNull();

    // No further rotations fire after detach.
    const before = journal.typesOf('ambient_creative_advanced').length;
    vi.advanceTimersByTime(DWELL_MS * 3);
    expect(journal.typesOf('ambient_creative_advanced')).toHaveLength(before);
  });

  it('filters video creatives out of the rotation (AC2 phase-1 image-only)', () => {
    const { host } = mountAmbient({
      specs: [image('ambient:001'), video('ambient:002') as ReturnType<typeof image>, image('ambient:003')],
    });
    vi.advanceTimersByTime(DWELL_MS);
    // ambient:002 (video) is skipped: index 1 is ambient:003.
    expect(creativeImg(host).dataset['assetId']).toBe('ambient:003');
  });
});
