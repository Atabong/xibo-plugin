/**
 * SPEC-CRWDQ-066 — the `fixtures_with_live_game` composite template (D-GRH-30
 * #7), the canonical "mixed-state" composite: a pre-game fixture grid where
 * exactly one tile is promoted to a live game render.
 *
 * It COMPOSES, never forks (INV-FACTORY-19): the non-promoted tiles are the
 * UNMODIFIED SPEC-CRWDQ-034 `FixtureCardSet` (the static-card primitive, with
 * its own per-fixture `FixtureListStore` subscriptions, badges, time
 * formatting); the promoted tile is a `LiveFixtureTile` (SPEC-CRWDQ-066) mounted
 * into a `<li class="cdq-fixture-card cdq-tile-live" data-game-id>` the composite
 * owns. The `FixtureCardSet` manages only the non-promoted ids; the composite
 * owns the promoted `<li>` and re-orders the whole `<ul>` by `fixture_ids`
 * position after any structural change (the card set's own reindex appends only
 * its cards, so a single composite-level reorder restores the interleaved order
 * without touching the card set internals).
 *
 * Promoted-fixture identification is the direct id match
 * `fixture_id === programSlot.primary_game_id` — both canonical `event_id`
 * (SPEC-CRWDQ-066 RESOLVED: the live game's id IS one of the listed fixture ids,
 * matched directly, no separate `game_id` field on the wire). A null
 * `primary_game_id`, an empty `fixture_ids`, or a `primary_game_id` matching no
 * listed fixture each journal `template_input_invalid` and DECLINE the mount
 * (return null) — the activator then falls through to safe.
 *
 * The instance implements the optional `reconcile?(event)` hook (D-GRH-13): a
 * revised `ProgramSlot` (same `program_slot_id`) may change `primary_game_id`,
 * demoting the old live tile to a static card and promoting the new fixture's
 * `<li>` to a live tile (old GameState subscription unsubscribed, dwell NOT
 * reset, `live_tile_reconciled` journaled). `ad_slot` / `game_state_revision`
 * kinds are no-ops (per-game GameState deltas reach the live tile through its
 * own store subscription, not the reconcile hook).
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { GameStateStore } from '../../render/GameStateStore';
import type { RenderJournal } from '../../render/RenderJournal';
import type {
  TemplateInstance,
  TemplateReconcileEvent,
} from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { ProgramSlotPayload } from '../../render/types';
import type { CardTransitions } from '../multi-game/CardSet';
import { FixtureCardSet } from '../fixtures/FixtureCardSet';
import { FIXTURE_CARD_ANIMATION, type PendingPreferenceApply } from '../fixtures/FixturesTemplate';
import { LiveFixtureTile, type LiveFixtureTileInstance } from './LiveFixtureTile';

/** Stable test id for the composite section root. */
export const FIXTURES_WITH_LIVE_GAME_TESTID = {
  root: 'fixtures-with-live-game-root',
} as const;

export interface FixturesWithLiveGameContext {
  /** Resolved ProgramSlot — `fixture_ids[]` non-empty + `primary_game_id` non-null. */
  programSlot: ProgramSlotPayload;
  theme: ResolvedTheme;
  /** Bar-local IANA timezone for the STATIC tiles' kickoff times (D-GRH-73). */
  timezone: string;
  fixtureListStore: FixtureListStore;
  assetManifestStore: AssetManifestStore;
  gameStateStore: GameStateStore;
  journal: RenderJournal;
  /** Card-level animation seam for the static set; defaults to no-op. */
  cardTransitions?: CardTransitions;
  /** Clock seam (INV-FACTORY-17); defaults to `Date.now`. */
  now?: () => number;
  /** Pending preference apply drained at the dwell boundary, or null. */
  pendingApply: PendingPreferenceApply | null;
}

export interface FixturesWithLiveGameInstance extends TemplateInstance {
  reconcile(event: TemplateReconcileEvent): Promise<void>;
  applyPending(pending: PendingPreferenceApply): void;
}

const noopCardTransitions: CardTransitions = {
  enter: async () => {},
  exit: async () => {},
};

export class FixturesWithLiveGameTemplate {
  /**
   * Mount the composite, or null when a constraint is violated (AC: decline).
   */
  mount(
    host: HTMLElement,
    ctx: FixturesWithLiveGameContext,
  ): FixturesWithLiveGameInstance | null {
    const fixtureIds = ctx.programSlot.fixture_ids ?? [];
    const primaryGameId = ctx.programSlot.primary_game_id;

    if (fixtureIds.length === 0) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'empty_fixture_ids',
        program_slot_id: ctx.programSlot.program_slot_id,
      });
      return null;
    }
    if (primaryGameId === null) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'null_primary_game_id',
        program_slot_id: ctx.programSlot.program_slot_id,
      });
      return null;
    }
    // Direct id match: the promoted fixture's id IS the primary_game_id.
    if (!fixtureIds.includes(primaryGameId)) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'promoted_fixture_not_found',
        program_slot_id: ctx.programSlot.program_slot_id,
        primary_game_id: primaryGameId,
      });
      return null;
    }

    const root = buildRoot(themeAttr(ctx.theme));
    const list = root.querySelector<HTMLElement>('.cdq-fixture-list')!;
    host.append(root);

    const cards = new FixtureCardSet({
      list,
      fixtureListStore: ctx.fixtureListStore,
      assetManifestStore: ctx.assetManifestStore,
      journal: ctx.journal,
      transitions: ctx.cardTransitions ?? noopCardTransitions,
      timezone: ctx.timezone,
      ...(ctx.now === undefined ? {} : { now: ctx.now }),
    });

    const instance = new FixturesWithLiveGameInstanceImpl({
      root,
      list,
      cards,
      gameStateStore: ctx.gameStateStore,
      assetManifestStore: ctx.assetManifestStore,
      fixtureListStore: ctx.fixtureListStore,
      journal: ctx.journal,
    });
    instance.initialMount(fixtureIds, primaryGameId);

    if (ctx.pendingApply) instance.applyPending(ctx.pendingApply);

    return instance;
  }
}

interface InstanceDeps {
  root: HTMLElement;
  list: HTMLElement;
  cards: FixtureCardSet;
  gameStateStore: GameStateStore;
  assetManifestStore: AssetManifestStore;
  fixtureListStore: FixtureListStore;
  journal: RenderJournal;
}

/**
 * The live composite instance. Owns the promoted `<li>` + its `LiveFixtureTile`
 * subscription, delegates the static set to the composed `FixtureCardSet`, and
 * keeps the `<ul>` ordered by `fixture_ids` position after structural changes.
 */
class FixturesWithLiveGameInstanceImpl implements FixturesWithLiveGameInstance {
  private readonly d: InstanceDeps;
  private readonly liveTile = new LiveFixtureTile();
  /** The current ordered fixture ids. */
  private order: string[] = [];
  /** The currently promoted fixture id (== primary_game_id). */
  private promotedId: string | null = null;
  /** The promoted `<li>` the composite owns (outside the card set). */
  private promotedLi: HTMLElement | null = null;
  private liveInstance: LiveFixtureTileInstance | null = null;

  constructor(deps: InstanceDeps) {
    this.d = deps;
  }

  /** Build the initial list: static cards for the rest, a live tile for the promoted. */
  initialMount(fixtureIds: readonly string[], primaryGameId: string): void {
    this.order = [...fixtureIds];
    this.promotedId = primaryGameId;

    // Static cards for every NON-promoted fixture (the card set owns their subs).
    fixtureIds.forEach((eventId, position) => {
      if (eventId !== primaryGameId) void this.d.cards.addCard(eventId, position);
    });
    // The promoted `<li>` the composite owns.
    this.promotedLi = this.mountPromoted(primaryGameId);
    this.placeInOrder();
  }

  detach(): HTMLElement {
    this.liveInstance?.detach();
    this.liveInstance = null;
    this.d.cards.teardown();
    this.d.root.remove();
    return this.d.root;
  }

  /**
   * Apply an in-place revision. Only a `program_slot` event reshapes the
   * composite; `ad_slot` and `game_state_revision` are no-ops (per-game deltas
   * reach the live tile via its own subscription, not this hook).
   */
  async reconcile(event: TemplateReconcileEvent): Promise<void> {
    if (event.kind !== 'program_slot') return;
    const slot = event.slot;
    const nextIds = slot.fixture_ids ?? [];
    const nextPromoted = slot.primary_game_id;

    // A revised slot that no longer satisfies the composite's invariants is a
    // backend authoring error; leave the current render in place (the activator
    // owns escalation), but do not restructure into an invalid state.
    if (nextPromoted === null || nextIds.length === 0 || !nextIds.includes(nextPromoted)) {
      this.d.journal.record({
        type: 'template_input_invalid',
        reason: 'reconcile_constraint_violation',
        program_slot_id: slot.program_slot_id,
        primary_game_id: nextPromoted,
      });
      return;
    }

    const previousPromoted = this.promotedId;
    const promotionChanged = nextPromoted !== previousPromoted;

    if (promotionChanged) {
      await this.repromote(previousPromoted, nextPromoted, nextIds);
    } else {
      await this.reconcileStatic(nextIds, nextPromoted);
    }
  }

  applyPending(pending: PendingPreferenceApply): void {
    if (pending.timezone === undefined) return;
    this.d.cards.reformatAll(pending.timezone);
    this.d.journal.record({ type: 'template_locale_refresh', timezone: pending.timezone });
  }

  // --- internals -------------------------------------------------------------

  /**
   * Re-promotion (D-GRH-13): demote the old promoted `<li>` to a static card,
   * promote the new fixture's tile, swap the GameState subscription, journal
   * `live_tile_reconciled`. Then reconcile the static set for any fixture_ids
   * change. The dwell timer is NOT touched (the activator owns it).
   */
  private async repromote(
    previousPromoted: string | null,
    nextPromoted: string,
    nextIds: readonly string[],
  ): Promise<void> {
    // Tear down the old live tile.
    this.liveInstance?.detach();
    this.liveInstance = null;
    if (this.promotedLi) {
      this.promotedLi.remove();
      this.promotedLi = null;
    }

    // The newly-promoted fixture must leave the static card set (the live tile
    // owns its rendering); the old promoted fixture becomes a static card.
    await this.d.cards.removeCard(nextPromoted);
    if (previousPromoted !== null && nextIds.includes(previousPromoted)) {
      const pos = nextIds.indexOf(previousPromoted);
      await this.d.cards.addCard(previousPromoted, pos, FIXTURE_CARD_ANIMATION.enter);
    }

    this.promotedId = nextPromoted;
    this.promotedLi = this.mountPromoted(nextPromoted);

    // Apply any static-set add/remove from the revised id list, then reorder.
    await this.reconcileStaticSet(nextIds, nextPromoted);
    this.order = [...nextIds];
    this.placeInOrder();

    this.d.journal.record({
      type: 'live_tile_reconciled',
      program_slot_id: this.d.root.dataset['programSlotId'] ?? null,
      previous_game_id: previousPromoted,
      new_game_id: nextPromoted,
      demoted_fixture_id:
        previousPromoted !== null && nextIds.includes(previousPromoted) ? previousPromoted : null,
    });
  }

  /** Same promoted game: just reconcile the static set + reorder. */
  private async reconcileStatic(nextIds: readonly string[], promoted: string): Promise<void> {
    await this.reconcileStaticSet(nextIds, promoted);
    this.order = [...nextIds];
    this.placeInOrder();
  }

  /**
   * Diff the NON-promoted portion of `nextIds` against the card set's current
   * static cards: add the newcomers, remove the departed (SPEC-CRWDQ-034 card
   * animations). The promoted id is excluded — it is the live tile's, not the
   * card set's.
   */
  private async reconcileStaticSet(nextIds: readonly string[], promoted: string): Promise<void> {
    const wantStatic = nextIds.filter((id) => id !== promoted);
    const haveStatic = this.d.cards.current();

    for (const id of haveStatic) {
      if (!wantStatic.includes(id)) await this.d.cards.removeCard(id, FIXTURE_CARD_ANIMATION.exit);
    }
    for (let i = 0; i < wantStatic.length; i += 1) {
      const id = wantStatic[i]!;
      if (!haveStatic.includes(id)) {
        await this.d.cards.addCard(id, i, FIXTURE_CARD_ANIMATION.enter);
      }
    }
  }

  /** Build + mount the promoted `<li>` with a real LiveFixtureTile body. */
  private mountPromoted(eventId: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'cdq-fixture-card cdq-tile-live';
    // `data-event-id` matches the SPEC-CRWDQ-034 static card primitive (so the
    // composite orders every `<li>` uniformly); `data-fixture-id` +
    // `data-game-id` are the SPEC-CRWDQ-066 promoted-tile attributes.
    li.dataset['eventId'] = eventId;
    li.dataset['fixtureId'] = eventId;
    li.dataset['gameId'] = eventId;
    li.dataset['status'] = 'live';

    const fixture = this.d.fixtureListStore.resolve(eventId);
    this.liveInstance = this.liveTile.mount(li, {
      gameId: eventId,
      // A cache-miss fixture still mounts the tile; team names fall back to the
      // store's null -> empty handling inside LiveFixtureTile (score still shows).
      fixture: fixture ?? placeholderFixture(eventId),
      gameStateStore: this.d.gameStateStore,
      assetManifestStore: this.d.assetManifestStore,
    });
    return li;
  }

  /** Order every `<li>` (static + promoted) by its `fixture_ids` index. */
  private placeInOrder(): void {
    for (const eventId of this.order) {
      const li =
        eventId === this.promotedId
          ? this.promotedLi
          : this.d.list.querySelector<HTMLElement>(
              `.cdq-fixture-card[data-event-id="${eventId}"]:not(.cdq-tile-live)`,
            );
      if (li) {
        li.dataset['position'] = String(this.order.indexOf(eventId));
        this.d.list.append(li);
      }
    }
  }
}

/** A minimal stand-in fixture when the promoted id misses the FixtureListStore. */
function placeholderFixture(eventId: string): import('../fixtures/types').Fixture {
  return {
    eventId,
    sport: '',
    leagueId: 0,
    leagueName: '',
    homeTeam: '',
    awayTeam: '',
    kickoffUtc: '',
    feedStatus: 'live',
  };
}

/** Build the empty composite skeleton: section > header + list. */
function buildRoot(themeAttrValue: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'crowdaq-fixtures-with-live-game';
  section.dataset['theme'] = themeAttrValue;
  section.dataset['testid'] = FIXTURES_WITH_LIVE_GAME_TESTID.root;

  const header = document.createElement('header');
  header.className = 'cdq-fixtures-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Coming up';
  header.append(h2);

  const list = document.createElement('ul');
  list.className = 'cdq-fixture-list';

  section.append(header, list);
  return section;
}
