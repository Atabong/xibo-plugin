/**
 * SPEC-CRWDQ-046 (part 1) — the recap is a frozen closing image (D-GRH-68).
 *
 * A late `GameEvent` for the recap's game after mount (e.g. a post-final score
 * correction) is journaled `recap_late_event` for backend diagnostics but does
 * NOT mutate the DOM. A revision for a DIFFERENT game, or a non-game revision
 * kind, is a silent no-op — the recap holds no live subscription, so `detach()`
 * has nothing to unwind beyond removing the root.
 */
import { describe, it, expect } from 'vitest';
import { RecapTemplate } from '../../../src/templates/recap/RecapTemplate';
import type { RecapInstance } from '../../../src/templates/recap/RecapTemplate';
import { finalGame, fixture, fixtureFrame, makeRecapHarness, recapSlot } from './support';

function mountRecap(): { instance: RecapInstance; host: HTMLElement; journal: ReturnType<typeof makeRecapHarness>['journal'] } {
  const h = makeRecapHarness({ slot: recapSlot('g1') });
  h.gameStateStore.upsertSnapshot(finalGame('g1', { home_score: 2, away_score: 1 }));
  h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));
  const instance = new RecapTemplate().mount(h.host, h.ctx)!;
  return { instance, host: h.host, journal: h.journal };
}

describe('RecapTemplate — late events do not mutate the frozen image (SPEC-CRWDQ-046 part 1)', () => {
  it('journals recap_late_event and does NOT re-render on a late same-game revision', async () => {
    const { instance, host, journal } = mountRecap();
    const before = host.querySelector<HTMLElement>('section.crowdaq-recap')!.outerHTML;

    await instance.reconcile({
      kind: 'game_state_revision',
      gameState: { game_id: 'g1', seq: 99, home_score: 5, away_score: 0 },
    });

    expect(journal.typesOf('recap_late_event')).toHaveLength(1);
    expect(journal.typesOf('recap_late_event')[0]).toMatchObject({ game_id: 'g1', seq: 99 });
    // The closing image is unchanged — scores stay 2/1, winner stays home.
    expect(host.querySelector<HTMLElement>('section.crowdaq-recap')!.outerHTML).toBe(before);
  });

  it('ignores a revision for a different game', async () => {
    const { instance, journal } = mountRecap();

    await instance.reconcile({
      kind: 'game_state_revision',
      gameState: { game_id: 'other', seq: 3 },
    });

    expect(journal.typesOf('recap_late_event')).toHaveLength(0);
  });

  it('detach removes the root and returns it (no subscription to unwind)', () => {
    const { instance, host } = mountRecap();

    const returned = instance.detach();

    expect(returned.classList.contains('crowdaq-recap')).toBe(true);
    expect(host.querySelector('section.crowdaq-recap')).toBeNull();
  });
});
