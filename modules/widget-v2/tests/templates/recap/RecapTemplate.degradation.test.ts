/**
 * SPEC-CRWDQ-046 (part 1) — graceful degradation + the no-mount journal paths.
 *
 * The recap degrades IN PLACE for a FixtureList miss (Home/Away placeholders),
 * a badge-cache miss (empty badge slot), and a premature (non-final) status.
 * It falls through to safe — declining the mount (null return) after a journal —
 * only for a null `primary_game_id` (`template_input_invalid`) or a GameState
 * cache miss (`recap_no_gamestate`). Stores are REAL; only the asset-fetch
 * boundary is substituted (INV-FACTORY-16/-17).
 */
import { describe, it, expect } from 'vitest';
import { RecapTemplate } from '../../../src/templates/recap/RecapTemplate';
import { badgeAssetId } from '../../../src/templates/fixtures/badgeAssetId';
import { finalGame, fixture, fixtureFrame, makeRecapHarness, recapSlot, warmAsset } from './support';

const sel = (root: ParentNode, s: string): HTMLElement | null => root.querySelector(s);

describe('RecapTemplate.mount — degradation + journal paths (SPEC-CRWDQ-046 part 1)', () => {
  it('falls back to Home/Away placeholders on a FixtureList miss without error', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    // No fixture applied for g1 -> resolve() returns null.

    const instance = new RecapTemplate().mount(h.host, h.ctx);

    expect(instance).not.toBeNull();
    const section = sel(h.host, 'section.crowdaq-recap')!;
    expect(sel(section, '.cdq-team-home .cdq-team-name')!.textContent).toBe('Home');
    expect(sel(section, '.cdq-team-away .cdq-team-name')!.textContent).toBe('Away');
  });

  it('paints the sport/league badge when the AssetManifest has it warm', async () => {
    const assetId = badgeAssetId('football', 'Premier League');
    const h = makeRecapHarness({ slot: recapSlot('g1'), badgeAssetIds: [assetId] });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));
    await warmAsset(h.assetStore, assetId);

    new RecapTemplate().mount(h.host, h.ctx);

    const img = sel(h.host, '.cdq-sport-context img')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(`blob:${assetId}`);
  });

  it('leaves the badge slot empty on a badge-cache miss without error', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1'), badgeAssetIds: [] });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    const badge = sel(h.host, '.cdq-sport-context')!;
    expect(badge.querySelector('img')).toBeNull();
    expect(badge.childElementCount).toBe(0);
  });

  it('journals template_input_invalid and does not mount when primary_game_id is null', () => {
    const h = makeRecapHarness({ slot: recapSlot(null) });

    const instance = new RecapTemplate().mount(h.host, h.ctx);

    expect(instance).toBeNull();
    expect(h.host.querySelector('section.crowdaq-recap')).toBeNull();
    expect(h.journal.typesOf('template_input_invalid')).toHaveLength(1);
  });

  it('journals recap_no_gamestate and does not mount on a GameState cache miss', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    // GameStateStore is empty for g1.

    const instance = new RecapTemplate().mount(h.host, h.ctx);

    expect(instance).toBeNull();
    expect(h.host.querySelector('section.crowdaq-recap')).toBeNull();
    expect(h.journal.typesOf('recap_no_gamestate')).toHaveLength(1);
    expect(h.journal.typesOf('recap_no_gamestate')[0]).toMatchObject({ game_id: 'g1' });
  });

  it('journals recap_premature but mounts with available data on a non-final status', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1') });
    h.gameStateStore.upsertSnapshot(finalGame('g1', { status: 'live', home_score: 1, away_score: 0 }));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    const instance = new RecapTemplate().mount(h.host, h.ctx);

    expect(instance).not.toBeNull();
    const section = sel(h.host, 'section.crowdaq-recap')!;
    expect(section.dataset['winner']).toBe('home');
    expect(sel(section, '.cdq-team-home .cdq-team-score')!.textContent).toBe('1');
    expect(h.journal.typesOf('recap_premature')).toHaveLength(1);
  });
});
