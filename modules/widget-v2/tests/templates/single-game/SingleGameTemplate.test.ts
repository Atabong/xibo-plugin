import { describe, it, expect } from 'vitest';
import { SingleGameTemplate, TESTID } from '../../../src/templates/single-game/SingleGameTemplate';
import { GameStateStore } from '../../../src/render/GameStateStore';
import type { RenderJournal, RenderJournalEntry } from '../../../src/render/RenderJournal';
import type { GameState, ProgramSlotPayload } from '../../../src/render/types';
import type { ResolvedTheme } from '../../../src/render/ThemeResolver';

class RecordingJournal implements RenderJournal {
  readonly entries: RenderJournalEntry[] = [];
  record(entry: RenderJournalEntry): void {
    this.entries.push(entry);
  }
}

const slot = (primaryGameId: string | null): ProgramSlotPayload => ({
  program_slot_id: 'slot-1',
  primary_game_id: primaryGameId,
});

const baseState = (over: Partial<GameState> = {}): GameState => ({
  game_id: 'g1',
  seq: 1,
  home_team: 'Lions',
  away_team: 'Bears',
  home_score: 2,
  away_score: 1,
  sport_context: { sport: 'soccer', league: 'EPL', period_clock: "45'" },
  ...over,
});

function setup(opts: { primaryGameId: string | null; theme?: ResolvedTheme }): {
  host: HTMLElement;
  store: GameStateStore;
  template: SingleGameTemplate;
} {
  const host = document.createElement('div');
  const store = new GameStateStore(new RecordingJournal());
  const template = new SingleGameTemplate();
  void opts;
  return { host, store, template };
}

const byTestId = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

describe('SingleGameTemplate.mount DOM (AC1)', () => {
  it('renders a crowdaq-single-game section with all sub-region test ids', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'set', id: 'midnight' },
      gameStateStore: store,
    });
    const section = host.querySelector('section.crowdaq-single-game');
    expect(section).not.toBeNull();
    for (const id of [TESTID.sportContext, TESTID.score, TESTID.homeTeam, TESTID.awayTeam, TESTID.clock, TESTID.overlay]) {
      expect(byTestId(host, id)).not.toBeNull();
    }
  });

  it('renders home/away score and the period clock from the current GameState', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('Lions');
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('2');
    expect(byTestId(host, TESTID.awayTeam)?.textContent).toContain('Bears');
    expect(byTestId(host, TESTID.clock)?.textContent).toBe("45'");
  });

  it('shows the last-moment overlay only when last_moment is non-empty', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState({ last_moment: '' }));
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    const overlay = byTestId(host, TESTID.overlay) as HTMLElement;
    expect(overlay.hidden).toBe(true);

    store.applyEvent({ game_id: 'g1', seq: 2, last_moment: 'GOAL! Lions 3-1' });
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toBe('GOAL! Lions 3-1');
  });

  it('reflects the resolved theme on the data-theme attribute', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'set', id: 'midnight' },
      gameStateStore: store,
    });
    expect((byTestId(host, TESTID.root) as HTMLElement).dataset['theme']).toBe('midnight');
  });
});

describe('SingleGameTemplate live re-render', () => {
  it('re-renders the score in place when a GameEvent is applied', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    store.applyEvent({ game_id: 'g1', seq: 2, home_score: 3 });
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('3');
  });
});

describe('SingleGameTemplate AC7 (primary_game_id from ProgramSlot)', () => {
  it('subscribes to the ProgramSlot primary_game_id, not any PlannedState field', () => {
    const { host, store, template } = setup({ primaryGameId: 'from-slot' });
    store.upsertSnapshot(baseState({ game_id: 'from-slot', home_team: 'SlotTeam' }));
    template.mount(host, {
      programSlot: slot('from-slot'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    expect(byTestId(host, TESTID.homeTeam)?.textContent).toContain('SlotTeam');
  });

  it('renders the no-live-game placeholder when the slot primary_game_id is null', () => {
    const { host, store, template } = setup({ primaryGameId: null });
    template.mount(host, {
      programSlot: slot(null),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    expect(byTestId(host, TESTID.placeholder)).not.toBeNull();
  });
});

describe('SingleGameTemplate scope (no other-template DOM)', () => {
  it('renders none of the multi-game grid, ad panel, or fixture card classes', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    expect(host.querySelector('.cdq-card-grid')).toBeNull();
    expect(host.querySelector('.cdq-ad-panel')).toBeNull();
    expect(host.querySelector('.cdq-fixture-card')).toBeNull();
  });
});

describe('SingleGameTemplate detach', () => {
  it('unsubscribes on detach so later events do not mutate the detached node', () => {
    const { host, store, template } = setup({ primaryGameId: 'g1' });
    store.upsertSnapshot(baseState());
    const instance = template.mount(host, {
      programSlot: slot('g1'),
      theme: { state: 'default' },
      gameStateStore: store,
    });
    const node = instance.detach();
    store.applyEvent({ game_id: 'g1', seq: 2, home_score: 9 });
    expect(byTestId(node, TESTID.homeTeam)?.textContent).not.toContain('9');
    expect(host.querySelector('section.crowdaq-single-game')).toBeNull();
  });
});
