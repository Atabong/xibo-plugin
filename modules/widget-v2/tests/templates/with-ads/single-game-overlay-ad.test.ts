/**
 * SPEC-CRWDQ-065 (#64) — the single_game overlay-ad creative seam.
 *
 * The composite SHELL (`<section class="crowdaq-single-game-composite">`, the
 * `.cdq-content` / `.cdq-ad-overlay` hosts, the activator branch on
 * `ad_slot_id`, the ProgramSlot/AdSlot buffer, the chained detach + supersede
 * transition) is owned by the already-merged SPEC-CRWDQ-023 part-2
 * `mountOverlayComposite` (`src/templates/single-game/SingleGameOverlay.ts`).
 * This spec OWNS the `SingleGameOverlayAd` seam that part-2 delegates the
 * overlay creative to: it paints exactly one static `AdPanel` creative into the
 * overlay host, declines (empty overlay) on a cache miss so the bare content
 * survives (D-GRH-16), fires `ad_slot_rendered` on the image `load`, and
 * journals `ad_slot_completed` at detach.
 *
 * Per INV-FACTORY-16/-17 the children are REAL: the real `AdPanel`, a real
 * `AssetManifestStore` driven through a substituted `AssetFetcher`, and a real
 * in-memory journal. The only substituted boundaries are the asset fetch and
 * the image `load` event ({@link withSyncImageLoad}). Where it exercises the
 * full activation path it drives the REAL `PlannedStateActivator` +
 * `mountOverlayComposite` + `SingleGameTemplate` so the seam is verified as a
 * consumer wires it, not in isolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SingleGameOverlayAd } from '../../../src/templates/with-ads/SingleGameOverlayAd';
import { PlannedStateActivator } from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import { OVERLAY_TESTID, type AdSlotResolver } from '../../../src/templates/single-game/SingleGameOverlay';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource, ResolvedTheme } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply } from '../../../src/render/PlannedStateActivator';
import type { SingleGameContext } from '../../../src/templates/single-game/SingleGameTemplate';
import type { AdSlotPayload } from '../../../src/render/types';
import type { PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  RecordingJournal,
  makeAssetStore,
  applyAndWarmAdManifest,
  applyColdAdManifest,
  adSlot,
  withSyncImageLoad,
} from './support';

const DEFAULT_THEME: ResolvedTheme = { state: 'default' };

/** A bare SingleGameContext bound to a resolved slot + store. */
function context(store: GameStateStore, primaryGameId: string | null): SingleGameContext {
  return {
    programSlot: { program_slot_id: 'slot-1', primary_game_id: primaryGameId, game_ids: [] },
    theme: DEFAULT_THEME,
    gameStateStore: store,
  };
}

// ---- direct-seam harness: paint into a standalone overlay host -------------

describe('SingleGameOverlayAd.mount — creative paint (AC2)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
  });
  afterEach(() => {
    host.remove();
  });

  it('paints one static <img class="cdq-ad-creative"> with the manifest-resolved url into the overlay host', async () => {
    const { store } = makeAssetStore();
    const urls = await applyAndWarmAdManifest(store, ['creative-1']);
    const gameStore = new GameStateStore(new RecordingJournal());
    const journal = new RecordingJournal();

    new SingleGameOverlayAd({ assetManifestStore: store, journal }).mount(host, {
      ...context(gameStore, 'g1'),
      adSlot: adSlot({ ad_ref: 'creative-1' }),
    });

    const imgs = host.querySelectorAll('img.cdq-ad-creative');
    expect(imgs).toHaveLength(1);
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe(urls['creative-1']);
  });
});
