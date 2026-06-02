import { describe, it, expect } from 'vitest';
import { FixtureCardSet, FIXTURE_CARD_TESTID } from '../../../src/templates/fixtures/FixtureCardSet';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
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

interface Harness {
  list: HTMLElement;
  cards: FixtureCardSet;
  store: FixtureListStore;
  journal: RecordingJournal;
  transitions: RecordingCardTransitions;
  fetcher: ReturnType<typeof makeAssetStore>['fetcher'];
  assetStore: ReturnType<typeof makeAssetStore>['store'];
}

function harness(badges: string[] = []): Harness {
  const list = document.createElement('ul');
  list.className = 'cdq-fixture-list';
  const store = new FixtureListStore();
  const journal = new RecordingJournal();
  const transitions = new RecordingCardTransitions();
  const { store: assetStore, fetcher } = makeAssetStore();
  applyBadgeManifest(assetStore, badges);
  const cards = new FixtureCardSet({
    list,
    fixtureListStore: store,
    assetManifestStore: assetStore,
    journal,
    transitions,
    timezone: TZ,
    now: () => NOW,
  });
  return { list, cards, store, journal, transitions, fetcher, assetStore };
}

const sel = (card: HTMLElement, testid: string): HTMLElement | null =>
  card.querySelector(`[data-testid="${testid}"]`);

const cardEls = (list: ParentNode): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>('.cdq-fixture-card'));

describe('FixtureCardSet.addCard rendering (AC1/AC2)', () => {
  it('renders a card with team names, league, sport, and bar-local time', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);

    const card = cardEls(h.list)[0]!;
    expect(card.dataset['eventId']).toBe('eA');
    expect(card.dataset['status']).toBe('scheduled');
    expect(sel(card, FIXTURE_CARD_TESTID.home)?.textContent).toBe('Arsenal');
    expect(sel(card, FIXTURE_CARD_TESTID.away)?.textContent).toBe('Chelsea');
    const when = sel(card, FIXTURE_CARD_TESTID.when)!;
    expect(when.getAttribute('datetime')).toBe('2026-06-02T00:30:00Z');
    expect(when.textContent).toMatch(/^Today /);
    // league + sport are present; no venue / broadcast / per-team logo.
    expect(card.textContent).toContain('Premier League');
    expect(card.querySelector('.cdq-team-logo')).toBeNull();
  });
});

describe('FixtureCardSet status pill (AC5)', () => {
  it('marks a live fixture data-status=live with a visible LIVE pill', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'live' })]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    expect(card.dataset['status']).toBe('live');
    const pill = sel(card, FIXTURE_CARD_TESTID.status)!;
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toMatch(/LIVE/i);
  });

  it('renders a final fixture with no LIVE pill (recent-final card)', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'final' })]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    expect(card.dataset['status']).toBe('final');
    expect(sel(card, FIXTURE_CARD_TESTID.status)!.hidden).toBe(true);
  });

  it('renders a scheduled fixture with no LIVE pill', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    expect(sel(card, FIXTURE_CARD_TESTID.status)!.hidden).toBe(true);
  });
});

describe('FixtureCardSet fixture cache miss (AC7)', () => {
  it('renders a TBA placeholder and journals fixture_cache_miss', async () => {
    const h = harness();
    // eGHOST is not in the store.
    await h.cards.addCard('eGHOST', 0);
    const card = cardEls(h.list)[0]!;
    expect(card.dataset['eventId']).toBe('eGHOST');
    expect(card.textContent).toContain('TBA');
    const misses = h.journal.typesOf('fixture_cache_miss');
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({ event_id: 'eGHOST' });
  });
});

describe('FixtureCardSet badge resolution (AC7/AC8)', () => {
  it('renders the badge <img> when the asset is warm in the manifest store', async () => {
    const h = harness(['badge:football:premier-league']);
    await h.assetStore.ensure('badge:football:premier-league'); // warm the hot map
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);
    const img = cardEls(h.list)[0]!.querySelector<HTMLImageElement>('.cdq-sport-badge img');
    expect(img?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('falls back to league-name text and ensures the badge once on a get() miss', async () => {
    const h = harness(['badge:football:premier-league']); // declared but NOT warm
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);

    const card = cardEls(h.list)[0]!;
    const badge = card.querySelector('.cdq-sport-badge')!;
    expect(badge.textContent).toContain('Premier League');
    // ensure() was invoked exactly once for the badge id (one fetch).
    expect(h.fetcher.fetched.filter((id) => id === 'badge:football:premier-league')).toHaveLength(1);
    // After the ensure resolves the badge <img> is swapped in.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const img = card.querySelector<HTMLImageElement>('.cdq-sport-badge img');
    expect(img?.getAttribute('src')).toMatch(/^blob:/);
  });
});

describe('FixtureCardSet in-place update via subscription (AC10)', () => {
  it('toggles the LIVE pill on a feedStatus flip with no re-mount, no transition', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'scheduled' })]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    expect(card.dataset['status']).toBe('scheduled');

    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'live' })]));
    // same DOM node (no remount): still exactly one card, same element.
    expect(cardEls(h.list)).toHaveLength(1);
    expect(cardEls(h.list)[0]).toBe(card);
    expect(card.dataset['status']).toBe('live');
    expect(sel(card, FIXTURE_CARD_TESTID.status)!.hidden).toBe(false);
    expect(h.transitions.played).toHaveLength(0);
  });

  it('re-formats the time on a kickoffUtc edit in place', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;

    h.store.applyList(fixtureFrame([fixture('eA', { kickoffUtc: '2026-06-03T00:30:00Z' })]));
    const when = sel(card, FIXTURE_CARD_TESTID.when)!;
    expect(when.getAttribute('datetime')).toBe('2026-06-03T00:30:00Z');
    expect(when.textContent).toMatch(/^Tomorrow /);
  });
});

describe('FixtureCardSet add/remove/move + teardown', () => {
  it('reports current event ids in display order', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA'), fixture('eB')]));
    await h.cards.addCard('eA', 0);
    await h.cards.addCard('eB', 1);
    expect(h.cards.current()).toEqual(['eA', 'eB']);
    expect(cardEls(h.list).map((c) => c.dataset['eventId'])).toEqual(['eA', 'eB']);
  });

  it('removes a card with a slide-out exit and unsubscribes it', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'scheduled' })]));
    await h.cards.addCard('eA', 0);
    await h.cards.removeCard('eA', 'card_slide_out');
    expect(cardEls(h.list)).toHaveLength(0);
    expect(h.transitions.phasesFor('eA')).toEqual(['exit']);
    // After removal a re-push for eA must not throw / re-create a card.
    h.store.applyList(fixtureFrame([fixture('eA', { feedStatus: 'live' })]));
    expect(cardEls(h.list)).toHaveLength(0);
  });

  it('adds a card with a slide-in enter when an animation id is given', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0, 'card_slide_in');
    expect(h.transitions.phasesFor('eA')).toEqual(['enter']);
  });

  it('moves a surviving card to a new position', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA'), fixture('eB')]));
    await h.cards.addCard('eA', 0);
    await h.cards.addCard('eB', 1);
    h.cards.moveCard('eB', 0);
    expect(cardEls(h.list).map((c) => c.dataset['eventId'])).toEqual(['eB', 'eA']);
  });

  it('teardown unsubscribes and detaches every card', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA'), fixture('eB')]));
    await h.cards.addCard('eA', 0);
    await h.cards.addCard('eB', 1);
    h.cards.teardown();
    expect(cardEls(h.list)).toHaveLength(0);
    expect(h.cards.current()).toEqual([]);
  });
});

describe('FixtureCardSet re-format all (timezone change)', () => {
  it('re-formats every card time under a new timezone', async () => {
    const h = harness();
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    // The Chicago time text first:
    expect(sel(card, FIXTURE_CARD_TESTID.when)!.textContent).toMatch(/7:30/);
    // 2026-06-02T00:30Z in Tokyo (UTC+9) is 09:30 on 2026-06-02; bar-local now
    // (2026-06-01T18:00Z) is 06-02 03:00 JST — both Jun 2, so "Today 9:30".
    h.cards.reformatAll('Asia/Tokyo');
    const when = sel(card, FIXTURE_CARD_TESTID.when)!;
    expect(when.textContent).toMatch(/^Today /);
    expect(when.textContent).toMatch(/9:30/);
  });
});
