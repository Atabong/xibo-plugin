/**
 * SPEC-CRWDQ-053 (#59 part 2) — consolidated end-to-end coverage matrix for the
 * `ambient` template, completing the cells that #58 part 1 only proved at the
 * AmbientTemplate / AmbientPlaylist unit seam. Every case here drives the REAL
 * shared SPEC-CRWDQ-023 `PlannedStateActivator` over the live FrameDispatcher
 * with the REAL ProgramSlotResolver, DwellTimer, TransitionExecutor,
 * AssetManifestStore, AmbientPlaylist, and SPEC-CRWDQ-052 SafeInfoTemplate
 * (INV-FACTORY-16 — no internal mocks). Only the clock (fake timers) and the
 * animation player are substituted (INV-FACTORY-17); the `<link rel="preload">`
 * fetch is never asserted on the network, only that the link elements exist with
 * the right href.
 *
 * Part 1 already covers (and is NOT duplicated here): happy mount, empty-slot
 * resolution + slot buffering, single-rotation pace, empty-manifest fallback,
 * all-video fallback, theme swap at the dwell boundary, and supersede teardown,
 * all through this same activator; plus wrap-around / mixed video-filter /
 * playlist-refresh / preload-window / indefinite-dwell at the template unit
 * seam. This file lifts those last five to the integration seam — the matrix
 * cells that had no end-to-end proof — so the full part-1 + part-2 matrix is
 * green at both altitudes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProgramSlotFrame } from '../../../src/wire';
import {
  makeAmbientHarness,
  applyManifest,
  image,
  video,
  ambientState,
  ambientSlot,
  ambientSection,
  ambientImg,
  ambientPreloadHrefs,
} from './support';

const DWELL_MS = 5_000;

/** Mount an ambient state with the given creatives and settle the transition. */
async function mountAmbient(specs: ReturnType<typeof image>[], dwellMs = DWELL_MS) {
  const h = makeAmbientHarness();
  applyManifest(h.assetStore, specs);
  h.dispatcher.dispatch(ambientSlot());
  await h.dispatcher.dispatch(ambientState({ dwell_target_ms: dwellMs }));
  await vi.advanceTimersByTimeAsync(0);
  return h;
}

describe('ambient end-to-end coverage matrix (SPEC-CRWDQ-053 #59 part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-02T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps around to index 0 through the activator after the last creative', async () => {
    const h = await mountAmbient([image('ambient:001'), image('ambient:002'), image('ambient:003')]);

    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:001');
    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> 002
    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> 003
    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> wrap to 001

    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:001');
    const advanced = h.journal.typesOf('ambient_creative_advanced');
    expect(advanced).toHaveLength(3);
    // The wrap boundary reports the modulo index and the from/to swap.
    expect(advanced[2]).toMatchObject({ from: 'ambient:003', to: 'ambient:001', index: 0, total: 3 });
  });

  it('rotates only the image creatives, skipping the interleaved video, through the activator', async () => {
    // Mixed playlist: part 1 only proved all-video -> fallback at this seam.
    const h = await mountAmbient([
      image('ambient:001'),
      video('ambient:002') as ReturnType<typeof image>,
      image('ambient:003'),
    ]);

    expect(ambientSection(h.host)).not.toBeNull();
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:001');
    // The video is deferred on every resolve. At mount the adapter resolves once
    // to test emptiness and the template resolves again to build the playlist, so
    // the deferral is journaled (the exact count is an end-to-end detail of the
    // two real resolves — assert the skipped payload, not a fragile count).
    const deferred = h.journal.typesOf('ambient_video_deferred');
    expect(deferred.length).toBeGreaterThanOrEqual(1);
    expect(deferred.every((e) => Array.isArray(e['skipped']) && (e['skipped'] as string[]).includes('ambient:002'))).toBe(true);

    await vi.advanceTimersByTimeAsync(DWELL_MS);
    // ambient:002 (video) is absent from the playlist -> index 1 is ambient:003.
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:003');
    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:001');
  });

  it('picks up a mid-mount AssetManifest push at the next boundary, restarting at index 0', async () => {
    const h = await mountAmbient([image('ambient:001'), image('ambient:002')]);

    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> index 1 (ambient:002)
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:002');

    // Operator updates ambient branding mid-mount on the SAME real store.
    applyManifest(h.assetStore, [image('ambient:aaa'), image('ambient:bbb'), image('ambient:ccc')], 'v2');
    // No flicker: the active creative holds until the next boundary.
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:002');

    await vi.advanceTimersByTimeAsync(DWELL_MS);
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:aaa');
    expect(ambientSection(h.host)!.querySelector<HTMLElement>('.cdq-ambient-stage')!.dataset['activeIndex']).toBe('0');
    expect(h.journal.typesOf('ambient_playlist_refreshed')).toHaveLength(1);
  });

  it('injects and refreshes the preload window through the activator', async () => {
    const h = await mountAmbient([
      image('ambient:001'),
      image('ambient:002'),
      image('ambient:003'),
      image('ambient:004'),
    ]);

    // At mount the next-3 after index 0 are 002, 003, 004.
    expect(ambientPreloadHrefs(h.host)).toEqual([
      'https://cdn.example/ambient:002.png',
      'https://cdn.example/ambient:003.png',
      'https://cdn.example/ambient:004.png',
    ]);

    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> index 1
    // Window wraps: next-3 after index 1 are 003, 004, 001.
    expect(ambientPreloadHrefs(h.host)).toEqual([
      'https://cdn.example/ambient:003.png',
      'https://cdn.example/ambient:004.png',
      'https://cdn.example/ambient:001.png',
    ]);
  });

  it('rotates indefinitely through the activator without auto-detaching (no PlannedState change)', async () => {
    const h = await mountAmbient([image('ambient:001'), image('ambient:002'), image('ambient:003')]);

    for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(DWELL_MS);

    expect(ambientSection(h.host)).not.toBeNull();
    expect(h.journal.typesOf('ambient_creative_advanced')).toHaveLength(10);
    // Index landed on 10 mod 3 = 1.
    expect(ambientImg(h.host).dataset['assetId']).toBe('ambient:002');
  });

  it('supersede mid-rotation cancels the ambient timer with no zombie advance after wrap', async () => {
    const h = await mountAmbient([image('ambient:001'), image('ambient:002'), image('ambient:003')]);

    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> index 1
    await vi.advanceTimersByTimeAsync(DWELL_MS); // -> index 2
    const advancedBefore = h.journal.typesOf('ambient_creative_advanced').length;
    expect(advancedBefore).toBe(2);

    // New PlannedState supersedes ambient mid-cycle.
    h.dispatcher.dispatch({
      message_type: 'ProgramSlot',
      program_slot_id: 'slot-2',
      primary_game_id: 'g2',
    } as unknown as ProgramSlotFrame);
    await h.dispatcher.dispatch(
      ambientState({ state_id: 'st-2', business_mode: 'single_game', program_slot_id: 'slot-2' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(ambientSection(h.host)).toBeNull();
    // No rotation fires after detach even across several would-be boundaries.
    await vi.advanceTimersByTimeAsync(DWELL_MS * 4);
    expect(h.journal.typesOf('ambient_creative_advanced')).toHaveLength(advancedBefore);
  });
});
