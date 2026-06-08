import { describe, it, expect } from 'vitest';
import { FixtureCardSet, FIXTURE_CARD_TESTID } from '../../../src/templates/fixtures/FixtureCardSet';
import { FixtureListStore } from '../../../src/render/FixtureListStore';
import {
  RecordingJournal,
  RecordingCardTransitions,
  makeAssetStore,
  applyBadgeManifest,
  makeCrestManifest,
  warmCrest,
  fixture,
  fixtureFrame,
} from './support';
import type { CrestResolver } from '../../../src/render/CrestResolver';

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

function harness(badges: string[] = [], crestResolver?: CrestResolver): Harness {
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
    ...(crestResolver ? { crestResolver } : {}),
  });
  return { list, cards, store, journal, transitions, fetcher, assetStore };
}

const crestImg = (card: HTMLElement, testid: string): HTMLImageElement | null =>
  sel(card, testid)?.querySelector<HTMLImageElement>('.cdq-team-crest .cdq-team-crest-img') ?? null;

const crestMono = (card: HTMLElement, testid: string): HTMLElement | null =>
  sel(card, testid)?.querySelector<HTMLElement>('.cdq-team-crest .cdq-team-crest-mono') ?? null;

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
    // Await the store's ensure for the same id: it de-dups onto the card's
    // in-flight call, so this settles exactly when the card's swap-in fires.
    await h.assetStore.ensure('badge:football:premier-league');
    await Promise.resolve();
    const img = card.querySelector<HTMLImageElement>('.cdq-sport-badge img');
    expect(img?.getAttribute('src')).toMatch(/^blob:/);
    // Still exactly one fetch — the second ensure() de-duped (no extra fetch).
    expect(h.fetcher.fetched.filter((id) => id === 'badge:football:premier-league')).toHaveLength(1);
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

describe('FixtureCardSet real team crests (SPEC-CRWDQ-S11)', () => {
  it('renders an <img> with the warm crest URL for BOTH teams (distinct per team)', async () => {
    const { store: assetStore } = makeAssetStore();
    const crest = makeCrestManifest(assetStore, ['Arsenal', 'Chelsea']);
    await warmCrest(assetStore, 'Arsenal');
    await warmCrest(assetStore, 'Chelsea');

    const h = harness([], crest);
    // Rebind the harness to the SAME asset store the crest manifest applied to.
    const list = document.createElement('ul');
    const cards = new FixtureCardSet({
      list,
      fixtureListStore: h.store,
      assetManifestStore: assetStore,
      journal: h.journal,
      transitions: h.transitions,
      timezone: TZ,
      now: () => NOW,
      crestResolver: crest,
    });
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await cards.addCard('eA', 0);

    const card = Array.from(list.querySelectorAll<HTMLElement>('.cdq-fixture-card'))[0]!;
    const homeImg = crestImg(card, FIXTURE_CARD_TESTID.home);
    const awayImg = crestImg(card, FIXTURE_CARD_TESTID.away);
    expect(homeImg).not.toBeNull();
    expect(awayImg).not.toBeNull();
    // Real, distinct crest URLs per team (the gap: no longer a generic chip).
    expect(homeImg!.getAttribute('src')).toMatch(/^blob:crest:arsenal$/);
    expect(awayImg!.getAttribute('src')).toMatch(/^blob:crest:chelsea$/);
    expect(homeImg!.getAttribute('src')).not.toBe(awayImg!.getAttribute('src'));
    expect(sel(card, FIXTURE_CARD_TESTID.home)!.dataset['hasCrest']).toBe('true');
    // The team NAME line is still intact next to the crest.
    expect(sel(card, FIXTURE_CARD_TESTID.home)!.textContent).toContain('Arsenal');
  });

  it('falls back to a colour-block monogram when a team has no crest in the manifest', async () => {
    const { store: assetStore } = makeAssetStore();
    // Only Arsenal has a crest; Chelsea is missing → monogram fallback.
    const crest = makeCrestManifest(assetStore, ['Arsenal']);
    await warmCrest(assetStore, 'Arsenal');

    const h = harness();
    const list = document.createElement('ul');
    const cards = new FixtureCardSet({
      list,
      fixtureListStore: h.store,
      assetManifestStore: assetStore,
      journal: h.journal,
      transitions: h.transitions,
      timezone: TZ,
      now: () => NOW,
      crestResolver: crest,
    });
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await cards.addCard('eA', 0);

    const card = Array.from(list.querySelectorAll<HTMLElement>('.cdq-fixture-card'))[0]!;
    // Arsenal: real crest img. Chelsea: monogram fallback (never a broken image).
    expect(crestImg(card, FIXTURE_CARD_TESTID.home)).not.toBeNull();
    expect(crestImg(card, FIXTURE_CARD_TESTID.away)).toBeNull();
    const mono = crestMono(card, FIXTURE_CARD_TESTID.away)!;
    expect(mono).not.toBeNull();
    expect(mono.textContent).toBe('CHE');
    expect(sel(card, FIXTURE_CARD_TESTID.away)!.dataset['hasCrest']).toBeUndefined();
  });

  it('swaps the real crest in over the monogram on a later onCrestReady warm (cold get)', async () => {
    const { store: assetStore, fetcher } = makeAssetStore();
    // Declared but NOT warm: first render is a get() miss → monogram + warm-fetch.
    const crest = makeCrestManifest(assetStore, ['Arsenal', 'Chelsea']);

    const h = harness();
    const list = document.createElement('ul');
    const cards = new FixtureCardSet({
      list,
      fixtureListStore: h.store,
      assetManifestStore: assetStore,
      journal: h.journal,
      transitions: h.transitions,
      timezone: TZ,
      now: () => NOW,
      crestResolver: crest,
    });
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await cards.addCard('eA', 0);

    const card = Array.from(list.querySelectorAll<HTMLElement>('.cdq-fixture-card'))[0]!;
    // Immediate render: monogram fallback (the card never blocks on a crest).
    expect(crestImg(card, FIXTURE_CARD_TESTID.home)).toBeNull();
    expect(crestMono(card, FIXTURE_CARD_TESTID.home)!.textContent).toBe('ARS');

    // The resolver kicked one warm-fetch per team; await them so onCrestReady fires.
    await assetStore.ensure('crest:arsenal');
    await assetStore.ensure('crest:chelsea');
    await Promise.resolve();
    await Promise.resolve();

    // Real crest images are now swapped in over the monograms (the swap-in path).
    expect(crestImg(card, FIXTURE_CARD_TESTID.home)?.getAttribute('src')).toMatch(/^blob:/);
    expect(crestImg(card, FIXTURE_CARD_TESTID.away)?.getAttribute('src')).toMatch(/^blob:/);
    // Exactly one fetch per crest id (no churn).
    expect(fetcher.fetched.filter((id) => id === 'crest:arsenal')).toHaveLength(1);
  });

  it('renders NO crest slot content (name-only) when no crestResolver is wired', async () => {
    const h = harness(); // no crestResolver
    h.store.applyList(fixtureFrame([fixture('eA')]));
    await h.cards.addCard('eA', 0);
    const card = cardEls(h.list)[0]!;
    // The crest slot exists in the skeleton but stays empty (pre-S11 behaviour),
    // so the team element's text is exactly the team name.
    expect(crestImg(card, FIXTURE_CARD_TESTID.home)).toBeNull();
    expect(crestMono(card, FIXTURE_CARD_TESTID.home)).toBeNull();
    expect(sel(card, FIXTURE_CARD_TESTID.home)!.textContent).toBe('Arsenal');
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
