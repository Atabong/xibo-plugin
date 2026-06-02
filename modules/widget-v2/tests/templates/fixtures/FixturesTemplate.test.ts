import { describe, it, expect } from 'vitest';
import {
  FixturesTemplate,
  type FixturesInstance,
} from '../../../src/templates/fixtures/FixturesTemplate';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import { TransitionExecutor } from '../../../src/render/TransitionExecutor';
import type { TransitionDefinition } from '../../../src/render/TransitionExecutor';
import type { ProgramSlotPayload, TransitionSpec } from '../../../src/render/types';
import type { TemplateReconcileEvent } from '../../../src/render/TemplateInstance';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyBadgeManifest,
  fixture,
  fixtureFrame,
} from './support';

const NOW = Date.parse('2026-06-01T18:00:00Z');
const TZ = 'America/Chicago';
const CUT: TransitionSpec = { animation_id: 'cut', duration_ms: 0 };

/** A recording TransitionPlayer (the substitutable PlannedState-level seam). */
class RecordingPlayer {
  readonly played: TransitionDefinition[] = [];
  async play(definition: TransitionDefinition): Promise<void> {
    this.played.push(definition);
  }
}

const slot = (
  fixtureIds: string[],
  programSlotId = 'slot-1',
): ProgramSlotPayload => ({
  program_slot_id: programSlotId,
  primary_game_id: null,
  game_ids: [],
  fixture_ids: fixtureIds,
});

const programSlotEvent = (s: ProgramSlotPayload): TemplateReconcileEvent => ({
  kind: 'program_slot',
  slot: s,
});

interface Harness {
  host: HTMLElement;
  instance: FixturesInstance;
  store: FixtureListStore;
  journal: RecordingJournal;
  transitions: RecordingCardTransitions;
  player: RecordingPlayer;
}

function mount(
  fixtureIds: string[],
  opts: { transition?: TransitionSpec; badges?: string[]; pendingTimezone?: string } = {},
): Omit<Harness, 'instance'> & { instance: FixturesInstance | null } {
  const host = document.createElement('div');
  const store = new FixtureListStore();
  store.applyList(fixtureFrame(fixtureIds.map((id) => fixture(id))));
  const journal = new RecordingJournal();
  const transitions = new RecordingCardTransitions();
  const player = new RecordingPlayer();
  const { store: assetStore } = makeAssetStore();
  applyBadgeManifest(assetStore, opts.badges ?? []);
  const executor = new TransitionExecutor({
    catalog: new Map([['cut', { opacity: [1, 1] }]]),
    assets: assetStore,
    player,
    journal,
  });

  const instance = new FixturesTemplate().mount(host, {
    programSlot: slot(fixtureIds),
    theme: { state: 'default' },
    timezone: TZ,
    fixtureListStore: store,
    assetManifestStore: assetStore,
    transitionExecutor: executor,
    transition: opts.transition ?? CUT,
    cardTransitions: transitions,
    journal,
    now: () => NOW,
    pendingApply: opts.pendingTimezone ? { timezone: opts.pendingTimezone } : null,
  });
  return { host, instance, store, journal, transitions, player };
}

function mountOk(fixtureIds: string[], opts: Parameters<typeof mount>[1] = {}): Harness {
  const m = mount(fixtureIds, opts);
  if (m.instance === null) throw new Error('expected a mounted instance');
  return { ...m, instance: m.instance };
}

const cardEls = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.cdq-fixture-card'));
const order = (root: ParentNode): string[] =>
  cardEls(root).map((c) => c.dataset['eventId'] ?? '');

describe('FixturesTemplate.mount (AC1)', () => {
  it('renders a crowdaq-fixtures section with one card per fixture id in order', () => {
    const h = mountOk(['eA', 'eB', 'eC']);
    const section = h.host.querySelector<HTMLElement>('.crowdaq-fixtures');
    expect(section).not.toBeNull();
    expect(section?.dataset['cardCount']).toBe('3');
    expect(order(h.host)).toEqual(['eA', 'eB', 'eC']);
    expect(h.host.querySelector('.cdq-fixture-list')).not.toBeNull();
  });

  it('stamps data-theme from the resolved theme', () => {
    const h = mountOk(['eA']);
    expect(h.host.querySelector<HTMLElement>('.crowdaq-fixtures')?.dataset['theme']).toBe(
      '__default__',
    );
  });
});

describe('FixturesTemplate.mount empty fixture_ids (AC6 defensive)', () => {
  it('journals template_input_invalid and does not mount', () => {
    const r = mount([]);
    expect(r.instance).toBeNull();
    expect(r.host.querySelector('.crowdaq-fixtures')).toBeNull();
    const invalid = r.journal.typesOf('template_input_invalid');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ program_slot_id: 'slot-1' });
  });
});

describe('FixturesTemplate.mount transition (AC7)', () => {
  it('runs the PlannedState-level transition on mount, no card-level transitions', () => {
    const h = mountOk(['eA', 'eB']);
    expect(h.player.played).toHaveLength(1);
    expect(h.player.played[0]?.animation_id).toBe('cut');
    // No card_slide_in/out on mount.
    expect(h.transitions.played).toHaveLength(0);
  });
});

describe('FixturesTemplate detach', () => {
  it('returns the root and unsubscribes every card (no in-place update after detach)', () => {
    const h = mountOk(['eA']);
    const card = cardEls(h.host)[0]!;
    const root = h.instance.detach();
    expect(root.classList.contains('crowdaq-fixtures')).toBe(true);
    // A re-push after detach does not mutate the detached card.
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'live' })]));
    expect(card.dataset['status']).toBe('scheduled');
  });
});

describe('FixturesInstance.reconcile add (AC11)', () => {
  it('adds a new card with card_slide_in, no dwell reset, journals added', async () => {
    const h = mountOk(['eA', 'eB']);
    h.store.applyList(fixtureFrame([fixture('eA'), fixture('eB'), fixture('eC')]));
    await h.instance.reconcile(programSlotEvent(slot(['eA', 'eB', 'eC'])));
    expect(order(h.host)).toEqual(['eA', 'eB', 'eC']);
    expect(h.transitions.phasesFor('eC')).toEqual(['enter']);
    expect(h.host.querySelector<HTMLElement>('.crowdaq-fixtures')?.dataset['cardCount']).toBe('3');
    const rec = h.journal.typesOf('fixtures_reconciled');
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ added: ['eC'], removed: [], reordered: [] });
  });
});

describe('FixturesInstance.reconcile remove (AC11)', () => {
  it('removes a card with card_slide_out, repositions survivors, journals removed+reordered', async () => {
    const h = mountOk(['eA', 'eB', 'eC']);
    h.store.applyList(fixtureFrame([fixture('eA'), fixture('eC')]));
    await h.instance.reconcile(programSlotEvent(slot(['eA', 'eC'])));
    expect(order(h.host)).toEqual(['eA', 'eC']);
    expect(h.transitions.phasesFor('eB')).toEqual(['exit']);
    const rec = h.journal.typesOf('fixtures_reconciled');
    expect(rec[0]).toMatchObject({ removed: ['eB'], added: [], reordered: ['eC'] });
  });
});

describe('FixturesInstance.reconcile no-op (AC11)', () => {
  it('emits no journal when the fixture_ids set and order are unchanged', async () => {
    const h = mountOk(['eA', 'eB']);
    await h.instance.reconcile(programSlotEvent(slot(['eA', 'eB'])));
    expect(h.journal.typesOf('fixtures_reconciled')).toHaveLength(0);
  });

  it('treats ad_slot and game_state_revision events as no-ops', async () => {
    const h = mountOk(['eA', 'eB']);
    await h.instance.reconcile({
      kind: 'ad_slot',
      adSlot: { ad_slot_id: 'a', ad_class: 'b', ad_ref: 'r', ad_ref_type: 'asset_id', policy: {} },
    });
    await h.instance.reconcile({ kind: 'game_state_revision', gameState: { game_id: 'g', seq: 1 } });
    expect(order(h.host)).toEqual(['eA', 'eB']);
    expect(h.journal.typesOf('fixtures_reconciled')).toHaveLength(0);
    expect(h.transitions.played).toHaveLength(0);
  });
});

describe('FixturesInstance pendingApply timezone (AC12)', () => {
  it('re-formats all cards and journals template_locale_refresh when applied at the boundary', () => {
    const h = mountOk(['eA']);
    const when = h.host.querySelector<HTMLElement>('[data-testid="cdq-fixture-when"]')!;
    expect(when.textContent).toMatch(/7:30/); // Chicago

    h.instance.applyPending({ timezone: 'America/New_York' });
    expect(when.textContent).toMatch(/8:30/); // New York (EDT)
    expect(h.journal.typesOf('template_locale_refresh')).toHaveLength(1);
  });

  it('applies a pending timezone present at mount time', () => {
    const h = mountOk(['eA'], { pendingTimezone: 'America/New_York' });
    const when = h.host.querySelector<HTMLElement>('[data-testid="cdq-fixture-when"]')!;
    expect(when.textContent).toMatch(/8:30/);
    expect(h.journal.typesOf('template_locale_refresh')).toHaveLength(1);
  });
});
