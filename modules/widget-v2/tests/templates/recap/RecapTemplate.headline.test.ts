/**
 * SPEC-CRWDQ-046 (part 1) — the single optional headline-moment block.
 *
 * The recap renders the ONE backend-supplied `HeadlineMoment` from the
 * PlannedState render-hint (SPEC-CRWDQ-045) when present, omitting the block
 * entirely when null. It does NOT reconstruct a moment history from GameEvent
 * deltas — there is exactly one moment, or none.
 */
import { describe, it, expect } from 'vitest';
import { RecapTemplate } from '../../../src/templates/recap/RecapTemplate';
import { finalGame, fixture, fixtureFrame, makeRecapHarness, recapSlot } from './support';

const moment = (root: ParentNode): HTMLElement | null => root.querySelector('.cdq-headline-moment');

describe('RecapTemplate.mount — headline moment (SPEC-CRWDQ-046 part 1)', () => {
  it('renders the single headline moment with data-moment-kind and its text', () => {
    const h = makeRecapHarness({
      slot: recapSlot('g1'),
      headlineMoment: { kind: 'goal', atClock: "90'+3", detail: { scorer: 'Saka' } },
    });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    const block = moment(h.host)!;
    expect(block).not.toBeNull();
    expect(block.dataset['momentKind']).toBe('goal');
    expect(block.textContent).toContain("90'+3");
    expect(block.textContent).toContain('Saka');
  });

  it('omits the headline-moment block when the backend supplied none', () => {
    const h = makeRecapHarness({ slot: recapSlot('g1'), headlineMoment: null });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    expect(moment(h.host)).toBeNull();
  });

  it('marks a card moment with its kind', () => {
    const h = makeRecapHarness({
      slot: recapSlot('g1'),
      headlineMoment: { kind: 'card', atClock: "61'", detail: {} },
    });
    h.gameStateStore.upsertSnapshot(finalGame('g1'));
    h.fixtureListStore.applyList(fixtureFrame([fixture('g1')]));

    new RecapTemplate().mount(h.host, h.ctx);

    expect(moment(h.host)!.dataset['momentKind']).toBe('card');
  });
});
