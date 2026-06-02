/**
 * SPEC-CRWDQ-066 (part 2) — the composite renders the SPEC-CRWDQ-023 three-state
 * `ResolvedTheme` distinctly on the section's `data-theme` attribute.
 *
 * The wire theme is a THREE-state union (D-GRH-51): an explicit `set` carries an
 * id; `default` (no ConfigPush applied yet) and `unset` (the bar explicitly chose
 * "no theme override") are DISTINCT sentinels, NOT collapsed. Part 1 only ever
 * mounted with the `default` state; this fixes the three states are each visible
 * on the rendered `<section data-theme>` so a stylesheet / probe can tell them
 * apart. Every collaborator is the real instance (INV-FACTORY-16); only the
 * journal sink + asset fetch are substituted (INV-FACTORY-17).
 */
import { describe, it, expect } from 'vitest';
import { FixturesWithLiveGameTemplate } from '../../../src/templates/mixed-state/FixturesWithLiveGameTemplate';
import {
  resolveTheme,
  THEME_ATTR_DEFAULT,
  THEME_ATTR_UNSET,
  type BarThemeSource,
  type ResolvedTheme,
} from '../../../src/render/ThemeResolver';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import type { ProgramSlotPayload } from '../../../src/render/types';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyBadgeManifest,
  makeGameStateStore,
  seedGame,
  fixture,
  fixtureFrame,
} from './support';

const NOW = (): number => Date.parse('2026-06-01T18:00:00Z');

/** A bar theme source that always reports the supplied (or absent) choice. */
const barTheme = (choice: ResolvedTheme | null): BarThemeSource => ({
  currentBarTheme: () => choice,
});

function mountWithTheme(theme: ResolvedTheme): HTMLElement {
  const journal = new RecordingJournal();
  const fixtures = new FixtureListStore();
  fixtures.applyList(
    fixtureFrame([
      fixture('fA', { feedStatus: 'live' }),
      fixture('fB', { feedStatus: 'scheduled' }),
    ]),
  );
  const games = makeGameStateStore(journal);
  seedGame(games, 'fA', { home_score: 1, away_score: 0, sport_context: { period_clock: 'P1' } });
  const { store: assets } = makeAssetStore();
  applyBadgeManifest(assets, []);
  const host = document.createElement('div');

  const slot: ProgramSlotPayload = {
    program_slot_id: 'slot-1',
    primary_game_id: 'fA',
    game_ids: [],
    fixture_ids: ['fA', 'fB'],
  };

  new FixturesWithLiveGameTemplate().mount(host, {
    programSlot: slot,
    theme,
    timezone: 'America/Chicago',
    fixtureListStore: fixtures,
    assetManifestStore: assets,
    gameStateStore: games,
    journal,
    cardTransitions: new RecordingCardTransitions(),
    now: NOW,
    pendingApply: null,
  });

  return host.querySelector<HTMLElement>('section.crowdaq-fixtures-with-live-game')!;
}

describe('FixturesWithLiveGameTemplate theme (SPEC-CRWDQ-066 part 2)', () => {
  it('stamps the explicit theme id on data-theme when the state carries a theme_id', () => {
    const theme = resolveTheme('night-mode', barTheme(null));
    expect(mountWithTheme(theme).dataset['theme']).toBe('night-mode');
  });

  it('stamps the __default__ sentinel when no ConfigPush has applied a bar theme', () => {
    const theme = resolveTheme(null, barTheme(null));
    expect(mountWithTheme(theme).dataset['theme']).toBe(THEME_ATTR_DEFAULT);
  });

  it('stamps the __unset__ sentinel — distinct from __default__ — when the bar explicitly chose no override', () => {
    const theme = resolveTheme(null, barTheme({ state: 'unset' }));
    expect(mountWithTheme(theme).dataset['theme']).toBe(THEME_ATTR_UNSET);
    // The two no-id states MUST be distinguishable on the rendered attribute.
    expect(THEME_ATTR_UNSET).not.toBe(THEME_ATTR_DEFAULT);
  });
});
