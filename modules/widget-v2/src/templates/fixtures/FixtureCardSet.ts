/**
 * SPEC-CRWDQ-034 — the card collection behind the `fixtures` list.
 *
 * A `FixtureCardSet` owns the live `<li class="cdq-fixture-card">` elements
 * inside the list `<ul>`, one per `eventId`. It is the single place that knows
 * how a card maps to an `eventId`, a list position, the per-fixture
 * `FixtureListStore` subscription (in-place feedStatus/kickoff updates, AC10),
 * the sport/league badge lookup (AC7/AC8), and the bar-local time format — so
 * `FixturesTemplate` (mount) and `FixturesInstance.reconcile` (in-place
 * add/remove/reorder) both drive the same DOM through one small surface.
 *
 * Card lifecycle: `addCard` builds the card, resolves the fixture (a cache miss
 * journals `fixture_cache_miss` + renders a "TBA" placeholder), subscribes it to
 * its fixture's mutation stream (D-GRH-18 re-push), resolves its badge, and runs
 * the optional enter animation; `removeCard` runs the exit animation,
 * unsubscribes, and detaches; `moveCard` is a layout-only reposition.
 *
 * Card animation playback is the only substitutable boundary here
 * (INV-FACTORY-17, injected via {@link CardTransitions}); everything else is
 * in-process DOM + a real `FixtureListStore` + a real `AssetManifestStore`.
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { RenderJournal } from '../../render/RenderJournal';
import type { CardTransitions } from '../multi-game/CardSet';
import { formatKickoff } from './formatKickoff';
import { badgeAssetId } from './badgeAssetId';
import type { Fixture } from './types';

/** Per-card sub-region test ids (stable across mount + reconcile). */
export const FIXTURE_CARD_TESTID = {
  home: 'cdq-fixture-home',
  away: 'cdq-fixture-away',
  when: 'cdq-fixture-when',
  status: 'cdq-fixture-status',
} as const;

interface CardRecord {
  eventId: string;
  element: HTMLElement;
  unsubscribe: () => void;
}

export interface FixtureCardSetDeps {
  /** The list `<ul>` the cards live inside. */
  list: HTMLElement;
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
  transitions: CardTransitions;
  /** Bar-local IANA timezone for kickoff formatting (D-GRH-73). */
  timezone: string;
  /** Clock seam (INV-FACTORY-17). Defaults to `Date.now`. */
  now?: () => number;
}

export class FixtureCardSet {
  private readonly list: HTMLElement;
  private readonly store: FixtureListStore;
  private readonly assets: AssetManifestStore;
  private readonly journal: RenderJournal;
  private readonly transitions: CardTransitions;
  private readonly now: () => number;
  private timezone: string;
  /** Cards in display order; index IS the list position. */
  private readonly cards: CardRecord[] = [];

  constructor(deps: FixtureCardSetDeps) {
    this.list = deps.list;
    this.store = deps.fixtureListStore;
    this.assets = deps.assetManifestStore;
    this.journal = deps.journal;
    this.transitions = deps.transitions;
    this.timezone = deps.timezone;
    this.now = deps.now ?? Date.now;
  }

  /** The currently rendered event ids, in display order. */
  current(): readonly string[] {
    return this.cards.map((c) => c.eventId);
  }

  /**
   * Add a card for `eventId` at `position`. Resolves the fixture from the store
   * (a miss renders a "TBA" placeholder + journals `fixture_cache_miss`),
   * subscribes to per-fixture mutations, resolves the badge, and runs the named
   * enter animation only when `animationId` is given (reconcile add; the initial
   * mount passes none so no card-level transition fires).
   */
  async addCard(eventId: string, position: number, animationId?: string): Promise<void> {
    const element = buildCard(eventId);
    const fixture = this.store.resolve(eventId);

    if (fixture === null) {
      renderPlaceholder(element);
      this.journal.record({ type: 'fixture_cache_miss', event_id: eventId });
    } else {
      this.renderFixture(element, fixture);
    }

    // A re-push for this eventId mutates the card in place (AC10). The
    // subscription is held even for a current cache-miss so a later list that
    // adds the fixture fills the card in place.
    const unsubscribe = this.store.subscribe(eventId, (updated) => {
      this.renderFixture(element, updated);
    });

    this.cards.splice(position, 0, { eventId, element, unsubscribe });
    this.reindex();
    if (animationId !== undefined) await this.transitions.enter(element, animationId);
  }

  /**
   * Remove the card for `eventId` with the named exit animation, unsubscribing
   * its mutation listener and detaching it. No-op if `eventId` is absent.
   */
  async removeCard(eventId: string, animationId?: string): Promise<void> {
    const index = this.cards.findIndex((c) => c.eventId === eventId);
    if (index === -1) return;
    const [record] = this.cards.splice(index, 1);
    if (!record) return;
    if (animationId !== undefined) await this.transitions.exit(record.element, animationId);
    record.unsubscribe();
    record.element.remove();
    this.reindex();
  }

  /** Move a surviving card to a new display position (layout only). */
  moveCard(eventId: string, toPosition: number): void {
    const fromIndex = this.cards.findIndex((c) => c.eventId === eventId);
    if (fromIndex === -1) return;
    const [record] = this.cards.splice(fromIndex, 1);
    if (!record) return;
    const clamped = Math.max(0, Math.min(toPosition, this.cards.length));
    this.cards.splice(clamped, 0, record);
    this.reindex();
  }

  /** Re-format every rendered card's time under a new bar `timezone` (AC11). */
  reformatAll(timezone: string): void {
    this.timezone = timezone;
    for (const card of this.cards) {
      const fixture = this.store.resolve(card.eventId);
      if (fixture !== null) this.renderTime(card.element, fixture);
    }
  }

  /** Unsubscribe + detach every card (the supersede / detach path). */
  teardown(): void {
    for (const card of this.cards) {
      card.unsubscribe();
      card.element.remove();
    }
    this.cards.length = 0;
  }

  // --- internals -------------------------------------------------------------

  /** Render the full fixture content into a card (mount + in-place update). */
  private renderFixture(card: HTMLElement, fixture: Fixture): void {
    card.dataset['status'] = fixture.feedStatus;

    const home = sel(card, FIXTURE_CARD_TESTID.home);
    if (home) home.textContent = fixture.homeTeam;
    const away = sel(card, FIXTURE_CARD_TESTID.away);
    if (away) away.textContent = fixture.awayTeam;

    this.renderTime(card, fixture);

    const status = sel(card, FIXTURE_CARD_TESTID.status);
    if (status) {
      const live = fixture.feedStatus === 'live';
      status.hidden = !live;
      status.textContent = live ? 'LIVE' : '';
    }

    this.renderBadge(card, fixture);
  }

  /** (Re)format the kickoff time in the current bar timezone. */
  private renderTime(card: HTMLElement, fixture: Fixture): void {
    const when = sel(card, FIXTURE_CARD_TESTID.when);
    if (!when) return;
    when.setAttribute('datetime', fixture.kickoffUtc);
    when.textContent = formatKickoff(fixture.kickoffUtc, this.timezone, this.now());
  }

  /**
   * Resolve the sport/league badge (AC7/AC8). A synchronous `get` hit paints the
   * `<img>`; a miss renders the league-name text fallback (D-GRH-08) and calls
   * `ensure(...)` exactly once, swapping the `<img>` in when the fetch resolves.
   */
  private renderBadge(card: HTMLElement, fixture: Fixture): void {
    const badge = card.querySelector<HTMLElement>('.cdq-sport-badge');
    if (!badge) return;
    const assetId = badgeAssetId(fixture.sport, fixture.leagueName);

    const cached = this.assets.get(assetId);
    if (cached !== null) {
      paintBadge(badge, cached.url);
      return;
    }

    // Miss: league-name text fallback, then ensure once.
    badge.replaceChildren(document.createTextNode(fixture.leagueName));
    void this.assets
      .ensure(assetId)
      .then((asset) => {
        // Swap the resolved badge in. Only when the league-name fallback is
        // still showing — a later in-place re-render (e.g. a feedStatus flip
        // that already painted a fresh badge) must not be clobbered.
        if (badge.querySelector('img') === null) paintBadge(badge, asset.url);
      })
      .catch(() => {
        // Fetch failed: the league-name text fallback already keeps the card legible.
      });
  }

  /** Re-stamp `data-position` + DOM order from the current index order. */
  private reindex(): void {
    this.cards.forEach((card, index) => {
      card.element.dataset['position'] = String(index);
      this.list.append(card.element);
    });
  }
}

/** Build an empty card skeleton for `eventId`. */
function buildCard(eventId: string): HTMLElement {
  const card = document.createElement('li');
  card.className = 'cdq-fixture-card';
  card.dataset['eventId'] = eventId;

  const badge = document.createElement('span');
  badge.className = 'cdq-sport-badge';

  const teams = document.createElement('div');
  teams.className = 'cdq-teams';
  const home = document.createElement('span');
  home.className = 'cdq-home';
  home.dataset['testid'] = FIXTURE_CARD_TESTID.home;
  const vs = document.createElement('span');
  vs.className = 'cdq-vs';
  vs.textContent = 'vs';
  const away = document.createElement('span');
  away.className = 'cdq-away';
  away.dataset['testid'] = FIXTURE_CARD_TESTID.away;
  teams.append(home, vs, away);

  const when = document.createElement('time');
  when.className = 'cdq-when';
  when.dataset['testid'] = FIXTURE_CARD_TESTID.when;

  const status = document.createElement('span');
  status.className = 'cdq-status';
  status.dataset['testid'] = FIXTURE_CARD_TESTID.status;
  status.hidden = true;

  card.append(badge, teams, when, status);
  return card;
}

/** Render the sport-neutral "TBA" placeholder for an unresolved eventId (AC7). */
function renderPlaceholder(card: HTMLElement): void {
  card.dataset['status'] = 'tba';
  const home = sel(card, FIXTURE_CARD_TESTID.home);
  if (home) home.textContent = 'TBA';
  const away = sel(card, FIXTURE_CARD_TESTID.away);
  if (away) away.textContent = '';
}

/** Paint a badge `<img>` with the resolved asset url. */
function paintBadge(badge: HTMLElement, url: string): void {
  const img = document.createElement('img');
  img.alt = '';
  img.setAttribute('src', url);
  badge.replaceChildren(img);
}

function sel(card: HTMLElement, testid: string): HTMLElement | null {
  return card.querySelector(`[data-testid="${testid}"]`);
}
