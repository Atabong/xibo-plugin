// @vitest-environment jsdom
/**
 * SPEC-CRWDQ-S58 — the NEVER-BLANK guarantee (D-SAFE-01).
 *
 * Production incident: an operator pinned `business_mode =
 * multiple_games_with_ads` with `ad_slot_id = NULL` and ZERO ad_slots configured.
 * The widget received that PlannedState, journaled
 * `template_input_invalid`/`missing_ad_slot`, and rendered NOTHING — the bar went
 * fully BLANK.
 *
 * The fix wires the `PlannedStateActivator`'s single mount choke-point to the
 * `SafeStateController` (Path C) via the `escalateToSafe` seam — EXACTLY as
 * `bootstrap.ts` does in production. ANY content adapter that DECLINES (returns
 * null) or THROWS while mounting now escalates to the calm CROWDAQ safe_info
 * panel, so the host is NEVER left empty.
 *
 * Each test drives a bad-input PlannedState through the REAL activator + REAL
 * SafeStateController and asserts the rendered DOM is non-empty — specifically
 * that the `safe-info-root` is present and carries the `CROWDAQ` wordmark — not
 * a blank host.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PlannedStateActivator,
  type PendingThemeApply,
  type TemplateAdapter,
} from '../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock, type DwellClock } from '../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../src/render/TransitionExecutor';
import type { RenderJournal, RenderJournalEntry } from '../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../src/render/ThemeResolver';
import { SafeStateController } from '../../src/render/SafeStateController';
import { SafeInfoTemplate, SAFE_INFO_TESTID } from '../../src/templates/safe-info/SafeInfoTemplate';
import { makeSafeAdapter } from '../../src/templates/safe-info/SafeAdapter';
import { MultiGameTemplate } from '../../src/templates/multi-game/MultiGameTemplate';
import { MultiGameWithAdsTemplate } from '../../src/templates/with-ads/MultiGameWithAdsTemplate';
import {
  makeMultiGameWithAdsAdapter,
  SnapshottingDwellTimer,
  type AdSlotResolver,
} from '../../src/templates/with-ads/WithAdsAdapter';
import { AssetManifestStore } from '../../src/render/AssetManifestStore';
import type { AssetCache } from '../../src/render/AssetCache';
import type { AssetFetcher } from '../../src/render/AssetFetcher';
import type { CachedAsset } from '../../src/render/AssetTypes';
import { noopCardTransitions } from '../../src/templates/multi-game/CardSet';
import type {
  ThemeChoiceWire,
  BarPreferencesWire,
  PlannedStateFrame,
  ProgramSlotFrame,
} from '../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../src/transport/types';

// --- minimal real-ish boundaries -------------------------------------------

/**
 * A multi-surface in-memory recorder — like the production `ConsoleJournalSink`
 * it implements every journal surface (render + manifest) so the same instance
 * can back the activator AND the AssetManifestStore. `record` accepts any entry
 * with a string `type`.
 */
class RecordingJournal {
  readonly entries: Array<{ type: string; [k: string]: unknown }> = [];
  record(e: { type: string; [k: string]: unknown }): void {
    this.entries.push(e);
  }
  typesOf(t: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === t) as RenderJournalEntry[];
  }
}
class InstantPlayer implements TransitionPlayer {
  async play(_d: TransitionDefinition): Promise<void> {}
}
class NoopStyleSheets implements StyleSheetRegistry {
  applyTheme(): void {}
}
class NullBarTheme implements BarThemeSource {
  currentBarTheme(): ThemeChoiceWire | null {
    return null;
  }
}
class NoPendingApply implements PendingThemeApply {
  takePending(): BarPreferencesWire | null {
    return null;
  }
}
class EmptyCache implements AssetCache {
  async read(): Promise<CachedAsset | null> {
    return null;
  }
  async write(): Promise<void> {}
  async delete(): Promise<void> {}
  async enumerate(): Promise<never[]> {
    return [];
  }
}
class NoFetch implements AssetFetcher {
  async fetch(): Promise<CachedAsset> {
    throw new Error('no fetch in this test');
  }
}
/** Empty resolver — `resolve` always returns null (the incident: no ad_slots). */
class EmptyAdSlots implements AdSlotResolver {
  resolve(): null {
    return null;
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

const withAdsState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-bad-ads',
    business_mode: 'multiple_games_with_ads',
    program_slot_id: 'slot-1',
    ad_slot_id: null, // the incident: NULL ad_slot
    dwell_target_ms: 30_000,
    transition: { animation_id: 'cut', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (over: Partial<Record<string, unknown>> = {}): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: 'slot-1',
    primary_game_id: 'g1',
    game_ids: ['g1', 'g2'],
    ...over,
  }) as unknown as ProgramSlotFrame;

/**
 * Wire the activator + SafeStateController exactly as `bootstrap.ts` does (the
 * `escalateToSafe` + `onActivated` seams late-bound to the controller), plus a
 * registered `multiple_games_with_ads` adapter over an EMPTY ad-slot resolver.
 */
function makeHarness(clock: DwellClock = systemDwellClock) {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  const assets = new AssetManifestStore({ cache: new EmptyCache(), fetcher: new NoFetch(), journal });
  const dwell = new SnapshottingDwellTimer(clock);
  const transitions = new TransitionExecutor({
    catalog: new Map<string, unknown>([
      ['cut', {}],
      ['fade_scale_up', {}],
      ['fade_scale_down', {}],
    ]),
    assets,
    player: new InstantPlayer(),
    journal,
  });

  // eslint-disable-next-line prefer-const
  let safeController: SafeStateController;

  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell,
    template: new MultiGameTemplate() as never, // single_game unused in these tests
    journal,
    styleSheets: new NoopStyleSheets(),
    barTheme: new NullBarTheme(),
    pendingApply: new NoPendingApply(),
    clock,
    onActivated: (mode) => safeController.notePlannedState(mode),
    // The fix under test — wired EXACTLY as bootstrap.ts.
    escalateToSafe: (reason) => safeController.escalateFromTemplate(reason),
  });

  safeController = new SafeStateController({
    activator,
    gameStateStore: store,
    ws: { on: () => {} },
    clock,
    slots,
    barPreferences: () => null,
    assetManifestStore: assets,
    lastThemeId: () => null,
  });
  activator.registerTemplate(
    'safe_info',
    makeSafeAdapter({ template: new SafeInfoTemplate(), controller: safeController }),
  );
  activator.registerTemplate(
    'multiple_games_with_ads',
    makeMultiGameWithAdsAdapter({
      template: new MultiGameWithAdsTemplate(new MultiGameTemplate()),
      journal,
      cardTransitions: noopCardTransitions,
      assetManifestStore: assets,
      adSlots: new EmptyAdSlots(),
      dwell,
    }),
  );

  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  safeController.start();
  return { host, activator, dispatcher, journal, safeController };
}

/** A throwing adapter to exercise the mount-threw escalation path. */
const throwingAdapter: TemplateAdapter = {
  mount() {
    throw new Error('boom — template mount failed');
  },
};

function safeInfoRendered(host: HTMLElement): boolean {
  const root = host.querySelector(`[data-testid="${SAFE_INFO_TESTID.root}"]`);
  if (root === null) return false;
  return (root.textContent ?? '').includes('CROWDAQ');
}

describe('SPEC-CRWDQ-S58 — the player NEVER blanks; bad PlannedState degrades to safe_info', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a multiple_games_with_ads state with a NULL/missing ad_slot renders safe_info (NOT blank)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(withAdsState({ ad_slot_id: null }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // The host is NON-EMPTY and shows the CROWDAQ safe panel.
    expect(h.host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(h.host.childElementCount).toBeGreaterThan(0);
    expect(safeInfoRendered(h.host)).toBe(true);

    // The decision is auditable: the with-ads decline + the escalation.
    expect(h.journal.typesOf('template_input_invalid')).not.toHaveLength(0);
    expect(h.journal.typesOf('template_escalated_to_safe')).not.toHaveLength(0);
    expect(h.safeController.state().inSafe).toBe(true);
  });

  it('a with-ads state whose ad_slot_id points at a NON-EXISTENT slot renders safe_info (NOT blank)', async () => {
    const h = makeHarness();
    h.dispatcher.dispatch(programSlot());
    // ad_slot_id is set but the (empty) resolver returns null — unsatisfiable.
    await h.dispatcher.dispatch(withAdsState({ ad_slot_id: 'ad-does-not-exist' }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.querySelector('section.crowdaq-with-ads')).toBeNull();
    expect(safeInfoRendered(h.host)).toBe(true);
    expect(h.safeController.state().inSafe).toBe(true);
  });

  it('a template that THROWS while mounting clears the host and renders safe_info (NOT blank)', async () => {
    const h = makeHarness();
    // Replace the registered adapter with one that throws mid-mount.
    h.activator.registerTemplate('multiple_games_with_ads', throwingAdapter);
    h.dispatcher.dispatch(programSlot());
    await h.dispatcher.dispatch(withAdsState({ ad_slot_id: null }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(safeInfoRendered(h.host)).toBe(true);
    expect(h.journal.typesOf('template_mount_threw')).not.toHaveLength(0);
    expect(h.journal.typesOf('template_escalated_to_safe')).not.toHaveLength(0);
  });

  it('a malformed PlannedState (no program_slot, missing ad_slot) renders safe_info (NOT blank)', async () => {
    const h = makeHarness();
    // No ProgramSlot dispatched; program_slot_id null -> activator renders the
    // missing-slot fallback into the with-ads adapter, which declines (no ad
    // slot) -> escalate.
    await h.dispatcher.dispatch(
      withAdsState({ state_id: 'st-malformed', program_slot_id: null, ad_slot_id: null }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.host.childElementCount).toBeGreaterThan(0);
    expect(safeInfoRendered(h.host)).toBe(true);
  });
});
