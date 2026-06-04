/**
 * SPEC-CRWDQ-031 — the card collection behind the `multiple_games` grid.
 *
 * A `CardSet` owns the live `<div class="cdq-card">` elements inside the grid
 * `<section>`, one per `game_id`. It is the single place that knows how a card
 * maps to a `game_id`, a grid position, the primary marker, and the per-game
 * `GameStateStore` subscription — so `MultiGameTemplate` (mount) and
 * `MultiGameInstance.reconcile` (in-place add/remove/reorder) both drive the
 * same DOM through one small surface instead of re-deriving card layout twice.
 *
 * Card lifecycle (D-GRH-13): `addCard` builds the card, subscribes it to its
 * game's multiplexed `GameState` stream (D-GRH-12), and runs the enter
 * animation; `removeCard` runs the exit animation, unsubscribes, and detaches;
 * `moveCard` is a layout-only `data-position` update for a surviving card.
 * `setPrimary` keeps exactly one (or zero) `data-primary="true"` card. Card
 * animation playback is a substitutable boundary (INV-FACTORY-17) injected via
 * {@link CardTransitions}; everything else is in-process DOM + a real
 * `GameStateStore` subscription.
 */
import type { GameStateStore } from '../../render/GameStateStore';
import type { GameState } from '../../render/types';
import type { CrestResolver } from '../../render/CrestResolver';

/** Per-card sub-region test ids (stable across mount + reconcile). */
export const CARD_TESTID = {
  homeTeam: 'cdq-card-home',
  awayTeam: 'cdq-card-away',
  clock: 'cdq-card-clock',
  sportContext: 'cdq-card-sport-context',
} as const;

/** Default named card animations (D-GRH-50 catalog names) for reconcile. */
export const CARD_ANIMATION = {
  enter: 'card_slide_in',
  exit: 'card_slide_out',
} as const;

/**
 * The substitutable card-animation playback seam (INV-FACTORY-17). Production
 * plays the named animation against the card element (Web Animations API);
 * tests record what was played and resolve immediately. Mirrors the
 * PlannedState-level `TransitionPlayer` shape, scoped to a single card.
 */
export interface CardTransitions {
  /** Play the named enter animation as a card is added; resolves on settle. */
  enter(card: HTMLElement, animationId: string): Promise<void>;
  /** Play the named exit animation before a card is removed; resolves on settle. */
  exit(card: HTMLElement, animationId: string): Promise<void>;
}

/** A no-op card-transition adapter for deployments without card animations. */
export const noopCardTransitions: CardTransitions = {
  enter: async () => {},
  exit: async () => {},
};

interface CardRecord {
  gameId: string;
  element: HTMLElement;
  unsubscribe: () => void;
}

export interface CardSetDeps {
  /** The grid `<section>` the cards live inside. */
  grid: HTMLElement;
  gameStateStore: GameStateStore;
  cardTransitions: CardTransitions;
  /** SPEC-CRWDQ-S11 — resolve real club crests from the AssetManifest by team.
   *  Optional: absent → cards render the name-only line (existing behaviour). */
  crestResolver?: CrestResolver;
}

export class CardSet {
  private readonly grid: HTMLElement;
  private readonly store: GameStateStore;
  private readonly transitions: CardTransitions;
  private readonly crestResolver: CrestResolver | undefined;
  /** Cards in display order; index IS the grid position. */
  private readonly cards: CardRecord[] = [];
  private primaryGameId: string | null = null;

  private unsubCrest: () => void = () => {};

  constructor(deps: CardSetDeps) {
    this.grid = deps.grid;
    this.store = deps.gameStateStore;
    this.transitions = deps.cardTransitions;
    this.crestResolver = deps.crestResolver;
    // SPEC-CRWDQ-S11 — when a crest warms, re-paint every card so the real
    // badge swaps in over the colour block (no new GameState needed).
    if (this.crestResolver) {
      this.unsubCrest = this.crestResolver.onCrestReady(() => this.repaintAll());
    }
  }

  /** Re-paint each live card from its current GameState (crest-warm swap-in). */
  private repaintAll(): void {
    for (const card of this.cards) {
      renderCard(card.element, this.store.get(card.gameId), this.crestResolver);
    }
  }

  /** The currently rendered game ids, in display order. */
  current(): readonly string[] {
    return this.cards.map((c) => c.gameId);
  }

  /**
   * Add a card for `gameId` at `position`, subscribing it to the game's
   * `GameState` stream and running the named enter animation. The enter
   * animation only runs when `animationId` is provided (reconcile add); the
   * initial mount passes none so no card-level transition fires (AC5).
   */
  async addCard(gameId: string, position: number, animationId?: string): Promise<void> {
    const element = buildCard(gameId, position);
    const render = (state: GameState | null): void =>
      renderCard(element, state, this.crestResolver);
    render(this.store.get(gameId));
    const unsubscribe = this.store.subscribe(gameId, render);
    this.cards.splice(position, 0, { gameId, element, unsubscribe });
    this.grid.append(element);
    this.reindex();
    if (this.primaryGameId === gameId) element.dataset['primary'] = 'true';
    if (animationId !== undefined) await this.transitions.enter(element, animationId);
  }

  /**
   * Remove the card for `gameId` with the named exit animation, unsubscribing
   * its `GameState` listener and detaching it. No-op if `gameId` is absent.
   */
  async removeCard(gameId: string, animationId?: string): Promise<void> {
    const index = this.cards.findIndex((c) => c.gameId === gameId);
    if (index === -1) return;
    const [record] = this.cards.splice(index, 1);
    if (!record) return;
    if (animationId !== undefined) await this.transitions.exit(record.element, animationId);
    record.unsubscribe();
    record.element.remove();
    this.reindex();
  }

  /** Move a surviving card to a new display position (layout only, no data). */
  moveCard(gameId: string, toPosition: number): void {
    const fromIndex = this.cards.findIndex((c) => c.gameId === gameId);
    if (fromIndex === -1) return;
    const [record] = this.cards.splice(fromIndex, 1);
    if (!record) return;
    const clamped = Math.max(0, Math.min(toPosition, this.cards.length));
    this.cards.splice(clamped, 0, record);
    this.reindex();
  }

  /**
   * Mark `gameId` the primary card, clearing any prior primary. A null id (or
   * an id not currently rendered) leaves zero primary cards. Exactly one or
   * zero cards carry `data-primary="true"` after this returns (AC3).
   */
  setPrimary(gameId: string | null): void {
    this.primaryGameId = gameId;
    for (const card of this.cards) {
      if (card.gameId === gameId) card.element.dataset['primary'] = 'true';
      else delete card.element.dataset['primary'];
    }
  }

  /** Unsubscribe + detach every card (the supersede / detach path, AC9). */
  teardown(): void {
    this.unsubCrest();
    for (const card of this.cards) {
      card.unsubscribe();
      card.element.remove();
    }
    this.cards.length = 0;
  }

  /** Re-stamp `data-position` + DOM order from the current index order. */
  private reindex(): void {
    this.cards.forEach((card, index) => {
      card.element.dataset['position'] = String(index);
      // Reassert DOM order so a moved/added card lands in its slot.
      this.grid.append(card.element);
    });
  }
}

/** Build an empty card skeleton for `gameId` at `position`. */
function buildCard(gameId: string, position: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cdq-card';
  card.dataset['gameId'] = gameId;
  card.dataset['position'] = String(position);

  const header = document.createElement('header');
  header.className = 'cdq-card-sport-context';
  header.dataset['testid'] = CARD_TESTID.sportContext;

  const home = buildCardTeam('cdq-card-home', CARD_TESTID.homeTeam);
  const clock = document.createElement('div');
  clock.className = 'cdq-card-clock';
  clock.dataset['testid'] = CARD_TESTID.clock;
  const away = buildCardTeam('cdq-card-away', CARD_TESTID.awayTeam);

  card.append(header, home, clock, away);
  return card;
}

/** A card team block: a crest slot (real badge img, S11) + a text line. The
 *  text line keeps the `data-testid` so the existing "NAME N" assertions hold. */
function buildCardTeam(sideClass: string, testid: string): HTMLElement {
  const team = document.createElement('div');
  team.className = `cdq-card-team ${sideClass}`;
  team.dataset['testid'] = testid;
  const crest = document.createElement('span');
  crest.className = 'cdq-card-crest';
  crest.hidden = true;
  const line = document.createElement('span');
  line.className = 'cdq-card-team-line';
  team.append(crest, line);
  return team;
}

/** Populate one card's score / clock / sport-context from current state. */
function renderCard(
  card: HTMLElement,
  state: GameState | null,
  crestResolver?: CrestResolver,
): void {
  const sel = (testid: string): HTMLElement | null =>
    card.querySelector(`[data-testid="${testid}"]`);

  const header = sel(CARD_TESTID.sportContext);
  if (header) {
    const ctx = state?.sport_context;
    header.textContent = [ctx?.sport, ctx?.league, ctx?.venue]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' · ');
  }
  paintCardTeam(sel(CARD_TESTID.homeTeam), state?.home_team, state?.home_score, crestResolver);
  paintCardTeam(sel(CARD_TESTID.awayTeam), state?.away_team, state?.away_score, crestResolver);
  const clock = sel(CARD_TESTID.clock);
  if (clock) clock.textContent = state?.sport_context?.period_clock ?? '';
}

/** Paint a card team block: the text line ("NAME N") + a real crest badge from
 *  the AssetManifest when published (falls back to no badge — text only). */
function paintCardTeam(
  team: HTMLElement | null,
  name: string | undefined,
  score: number | undefined,
  crestResolver?: CrestResolver,
): void {
  if (!team) return;
  const line = team.querySelector<HTMLElement>('.cdq-card-team-line');
  if (line) line.textContent = teamLine(name, score);
  const crest = team.querySelector<HTMLElement>('.cdq-card-crest');
  if (!crest) return;
  const url = crestResolver?.crestUrlForTeam(name) ?? null;
  if (url) {
    let img = crest.querySelector<HTMLImageElement>('img.cdq-card-crest-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'cdq-card-crest-img';
      img.alt = '';
      img.decoding = 'async';
      crest.appendChild(img);
    }
    if (img.getAttribute('src') !== url) img.src = url;
    crest.hidden = false;
    team.dataset['hasCrest'] = 'true';
  } else {
    crest.hidden = true;
    delete team.dataset['hasCrest'];
  }
}

function teamLine(name: string | undefined, score: number | undefined): string {
  const n = name ?? '';
  const s = score === undefined ? '' : String(score);
  return `${n} ${s}`.trim();
}
