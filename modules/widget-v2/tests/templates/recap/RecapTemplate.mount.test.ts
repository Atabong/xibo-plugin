/**
 * SPEC-CRWDQ-046 (part 1) — the bare `RecapTemplate.mount` composition.
 *
 * The recap is the frozen closing image (D-GRH-68): a FULL TIME header, the
 * final score with team NAMES joined from the cached FixtureList (GameState
 * carries no team identity), the derived winner, and an optional single
 * headline moment. These tests drive the template directly through its public
 * `mount(host, ctx)` interface (the activation-through-the-shared-activator
 * wiring is SPEC-CRWDQ-046 part 2). Stores are REAL (INV-FACTORY-16); only the
 * SPEC-CRWDQ-064 asset-fetch boundary is substituted (INV-FACTORY-17).
 */
import { describe, it, expect } from 'vitest';
import { RecapTemplate } from '../../../src/templates/recap/RecapTemplate';
import { badgeAssetId } from '../../../src/templates/fixtures/badgeAssetId';
import {
  finalGame,
  fixture,
  fixtureFrame,
  makeRecapHarness,
  recapSlot,
} from './support';

const sel = (root: ParentNode, s: string): HTMLElement | null => root.querySelector(s);

describe('RecapTemplate.mount — final composition (SPEC-CRWDQ-046 part 1)', () => {
  it('renders FULL TIME, the final score with FixtureList team names, and data-winner=home', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 3, away_score: 1 }));
    h.fixtureListStore.applyList(
      fixtureFrame([fixture('g1', { homeTeam: 'Arsenal', awayTeam: 'Chelsea' })]),
    );

    new RecapTemplate().mount(h.host, h.ctx);

    const section = sel(h.host, 'section.crowdaq-recap')!;
    expect(section).not.toBeNull();
    expect(section.dataset['gameId']).toBe('g1');
    expect(section.dataset['winner']).toBe('home');

    expect(sel(section, '.cdq-recap-label')!.textContent).toBe('FULL TIME');

    const home = sel(section, '.cdq-team-home')!;
    const away = sel(section, '.cdq-team-away')!;
    expect(sel(home, '.cdq-team-name')!.textContent).toBe('Arsenal');
    expect(sel(home, '.cdq-team-score')!.textContent).toBe('3');
    expect(sel(away, '.cdq-team-name')!.textContent).toBe('Chelsea');
    expect(sel(away, '.cdq-team-score')!.textContent).toBe('1');
  });

  it('renders the data-theme attribute from the resolved theme', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1'), theme: { state: 'set', id: 'midnight' } });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    expect(sel(h.host, 'section.crowdaq-recap')!.dataset['theme']).toBe('midnight');
  });

  it('derives data-winner=away when the away score is higher', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 0, away_score: 2 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    expect(sel(h.host, 'section.crowdaq-recap')!.dataset['winner']).toBe('away');
  });

  it('derives data-winner=draw when the scores are equal', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 2, away_score: 2 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    expect(sel(h.host, 'section.crowdaq-recap')!.dataset['winner']).toBe('draw');
  });

  it('renders no per-team logo and no data-team-id (no wire team_id)', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    const section = sel(h.host, 'section.crowdaq-recap')!;
    expect(section.querySelector('[data-team-id]')).toBeNull();
    expect(section.querySelector('.cdq-final-score img')).toBeNull();
  });
});
