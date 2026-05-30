import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlannedStateActivator } from '../../../src/render/PlannedStateActivator';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import { GameStateStore } from '../../../src/render/GameStateStore';
import { DwellTimer, systemDwellClock } from '../../../src/render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from '../../../src/render/TransitionExecutor';
import { AssetManifestStore } from '../../../src/render/AssetManifestStore';
import {
  SingleGameTemplate,
  type SingleGameContext,
  type SingleGameInstance,
} from '../../../src/templates/single-game/SingleGameTemplate';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { StyleSheetRegistry } from '../../../src/render/StyleSheetRegistry';
import type { BarThemeSource } from '../../../src/render/ThemeResolver';
import type { PendingThemeApply, SingleGameTemplateLike } from '../../../src/render/PlannedStateActivator';
import type { TemplateReconcileEvent } from '../../../src/render/TemplateInstance';
import type { PlannedStateFrame, ProgramSlotFrame } from '../../../src/wire';
import { FrameDispatcher, type ActiveGames } from '../../../src/transport/Dispatcher';
import type { GameStateRequester } from '../../../src/transport/types';
import {
  MapAssetCache,
  FakeAssetFetcher,
  RecordingJournal as ManifestRecordingJournal,
} from '../../render/asset-manifest/support';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
  typesOf(type: string): RenderJournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}

class RecordingPlayer implements TransitionPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(definition: TransitionDefinition): Promise<void> {
    this.played.push(definition);
  }
}

class RecordingStyleSheets implements StyleSheetRegistry {
  applyTheme(): void {}
}

class FixedBarTheme implements BarThemeSource {
  currentBarTheme() {
    return null;
  }
}

class FakePendingApply implements PendingThemeApply {
  takePending() {
    return null;
  }
}

/**
 * A reconcile-capable template variant (the role SPEC-CRWDQ-065's composite
 * fills). Records the events its instance reconciles + the order it settles
 * them in, so the activator's serialization is observable at the seam.
 */
class ReconcileCapableTemplate implements SingleGameTemplateLike {
  readonly reconciled: TemplateReconcileEvent[] = [];
  readonly settleOrder: string[] = [];
  /** Gate that holds each reconcile open until released, to prove serialization. */
  private resolvers: Array<() => void> = [];

  mount(host: HTMLElement, ctx: SingleGameContext): SingleGameInstance {
    const inner = new SingleGameTemplate().mount(host, ctx);
    const self = this;
    return {
      detach: () => inner.detach(),
      reconcile(event: TemplateReconcileEvent): Promise<void> {
        self.reconciled.push(event);
        return new Promise<void>((resolve) => {
          self.resolvers.push(() => {
            self.settleOrder.push(event.kind);
            resolve();
          });
        });
      },
    };
  }

  releaseNext(): void {
    const r = this.resolvers.shift();
    if (r) r();
  }
}

const noopRequester: GameStateRequester = { requestForGap: () => {}, resolve: () => {} };
const noActive: ActiveGames = { isActive: () => false };

const plannedState = (over: Partial<Record<string, unknown>> = {}): PlannedStateFrame =>
  ({
    message_type: 'PlannedState',
    state_id: 'st-1',
    business_mode: 'single_game',
    program_slot_id: 'slot-1',
    ad_slot_id: null,
    dwell_target_ms: 30_000,
    transition: { animation_id: 'fade_scale_up', duration_ms: 0 },
    theme_id: null,
    ...over,
  }) as unknown as PlannedStateFrame;

const programSlot = (id: string, primaryGameId: string | null): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
  }) as unknown as ProgramSlotFrame;

interface Harness {
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  store: GameStateStore;
  journal: RecordingJournal;
  template: ReconcileCapableTemplate;
}

function makeHarness(template: SingleGameTemplateLike): {
  activator: PlannedStateActivator;
  dispatcher: FrameDispatcher;
  store: GameStateStore;
  journal: RecordingJournal;
} {
  const host = document.createElement('div');
  const slots = new ProgramSlotResolver();
  const journal = new RecordingJournal();
  const store = new GameStateStore(journal);
  const transitions = new TransitionExecutor({
    catalog: new Map([
      ['fade_scale_up', {}],
      ['fade_scale_down', {}],
    ]),
    assets: new AssetManifestStore({
      cache: new MapAssetCache(),
      fetcher: new FakeAssetFetcher(),
      journal: new ManifestRecordingJournal(),
    }),
    player: new RecordingPlayer(),
    journal,
  });
  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore: store,
    transitions,
    dwell: new DwellTimer(systemDwellClock),
    template,
    journal,
    styleSheets: new RecordingStyleSheets(),
    barTheme: new FixedBarTheme(),
    pendingApply: new FakePendingApply(),
    clock: systemDwellClock,
  });
  const dispatcher = new FrameDispatcher(noopRequester, noActive);
  activator.registerWith(dispatcher);
  return { activator, dispatcher, store, journal };
}

function makeReconcileHarness(): Harness {
  const template = new ReconcileCapableTemplate();
  const base = makeHarness(template);
  return { ...base, template };
}

describe('PlannedStateActivator.reconcile gate + dispatch (AC4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function activate(h: Harness): Promise<void> {
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1, home_team: 'Lions' });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);
  }

  /** Flush the pending microtask queue (the reconcile chain hop). */
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it('drops a reconcile with no active instance, journaling no_active_instance', async () => {
    const h = makeReconcileHarness();
    await h.activator.reconcile({ kind: 'program_slot', slot: { program_slot_id: 'slot-1', primary_game_id: 'g1' } });
    const dropped = h.journal.typesOf('template_reconcile_dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.['reason']).toBe('no_active_instance');
  });

  it('dispatches a program_slot reconcile for the active slot to the instance hook', async () => {
    const h = makeReconcileHarness();
    await activate(h);
    const p = h.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'g1' },
    });
    await flush();
    h.template.releaseNext();
    await p;
    expect(h.template.reconciled.map((e) => e.kind)).toEqual(['program_slot']);
    const dispatched = h.journal.typesOf('template_reconcile_dispatched');
    expect(dispatched[0]).toMatchObject({ kind: 'program_slot', state_id: 'st-1' });
  });

  it('no-ops a program_slot reconcile for a non-active slot (no journal)', async () => {
    const h = makeReconcileHarness();
    await activate(h);
    await h.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-OTHER', primary_game_id: 'g9' },
    });
    expect(h.template.reconciled).toHaveLength(0);
    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(0);
    expect(h.journal.typesOf('template_reconcile_skipped')).toHaveLength(0);
    expect(h.journal.typesOf('template_reconcile_dropped')).toHaveLength(0);
  });

  it('dispatches a game_state_revision for a subscribed game', async () => {
    const h = makeReconcileHarness();
    await activate(h);
    const p = h.activator.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 5 } });
    await flush();
    h.template.releaseNext();
    await p;
    expect(h.template.reconciled.map((e) => e.kind)).toEqual(['game_state_revision']);
  });

  it('no-ops a game_state_revision for a non-subscribed game', async () => {
    const h = makeReconcileHarness();
    await activate(h);
    await h.activator.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g-other', seq: 5 } });
    expect(h.template.reconciled).toHaveLength(0);
    expect(h.journal.typesOf('template_reconcile_dispatched')).toHaveLength(0);
  });

  it('dispatches an ad_slot reconcile only when the active state has the matching ad_slot_id', async () => {
    const h = makeReconcileHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ ad_slot_id: 'ad-1' }));
    await vi.advanceTimersByTimeAsync(0);

    // Non-matching ad slot: no-op.
    await h.activator.reconcile({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'ad-OTHER', ad_class: 'b', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    expect(h.template.reconciled).toHaveLength(0);

    // Matching ad slot: dispatched.
    const p = h.activator.reconcile({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'ad-1', ad_class: 'b', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    await flush();
    h.template.releaseNext();
    await p;
    expect(h.template.reconciled.map((e) => e.kind)).toEqual(['ad_slot']);
  });
});

describe('PlannedStateActivator.reconcile skip + serialize (AC4/AC5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('journals hook_not_implemented when the active instance has no reconcile? hook', async () => {
    // Real bare single_game template: no reconcile? hook (AC3).
    const base = makeHarness(new SingleGameTemplate());
    base.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    base.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await base.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    await base.activator.reconcile({
      kind: 'program_slot',
      slot: { program_slot_id: 'slot-1', primary_game_id: 'g1' },
    });
    const skipped = base.journal.typesOf('template_reconcile_skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.['reason']).toBe('hook_not_implemented');
  });

  it('serializes overlapping reconciles: the second hook runs only after the first settles', async () => {
    const h = makeReconcileHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState());
    await vi.advanceTimersByTimeAsync(0);

    const first = h.activator.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 2 } });
    const second = h.activator.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 3 } });
    await vi.advanceTimersByTimeAsync(0);

    // Only the first hook has started; the second is queued behind its settle.
    expect(h.template.reconciled).toHaveLength(1);

    h.template.releaseNext();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    // First settled -> second now starts.
    expect(h.template.reconciled).toHaveLength(2);
    h.template.releaseNext();
    await second;
    expect(h.template.settleOrder).toEqual(['game_state_revision', 'game_state_revision']);
  });

  it('does not reset the dwell mid-slot: the boundary still fires at the original target (AC5)', async () => {
    const h = makeReconcileHarness();
    h.store.upsertSnapshot({ game_id: 'g1', seq: 1 });
    h.dispatcher.dispatch(programSlot('slot-1', 'g1'));
    await h.dispatcher.dispatch(plannedState({ dwell_target_ms: 5000 }));
    await vi.advanceTimersByTimeAsync(0);

    // Part-way through the dwell, a reconcile lands and settles.
    await vi.advanceTimersByTimeAsync(2000);
    const p = h.activator.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g1', seq: 2 } });
    await vi.advanceTimersByTimeAsync(0);
    h.template.releaseNext();
    await p;

    // No boundary yet (only 2s elapsed); reconcile must not have re-armed dwell.
    expect(h.journal.typesOf('dwell_boundary_reached')).toHaveLength(0);

    // The remaining 3s of the ORIGINAL 5s target fires the one and only boundary.
    await vi.advanceTimersByTimeAsync(3000);
    const boundary = h.journal.typesOf('dwell_boundary_reached');
    expect(boundary).toHaveLength(1);
    expect(boundary[0]?.['actualDwellMs']).toBe(5000);
  });
});
