/**
 * SPEC-CRWDQ-034 — the `fixtures` business-mode template (D-GRH-30 #3).
 *
 * `mount(host, ctx)` renders the pre-game catalog: a
 * `<section class="crowdaq-fixtures">` holding one `<li class="cdq-fixture-card">`
 * per `eventId` in `ProgramSlot.fixture_ids[]` order (kickoff ascending), each
 * resolved against the `FixtureListStore` and subscribed for in-place
 * feedStatus/kickoff updates (AC10). The PlannedState-level transition
 * (`ctx.transition`, always `"cut"` from the backend) runs once on mount; the
 * card-level `card_slide_in`/`card_slide_out` transitions run ONLY inside
 * `reconcile()` (AC7). No `GameState` subscription anywhere — fixtures is the
 * pre-game catalog (AC: no GameState).
 *
 * An empty `fixture_ids[]` is a backend authoring error (D-GRH-22 / SPEC-CRWDQ-033
 * guarantee a non-empty list): journal `template_input_invalid` and return null
 * (do NOT mount, AC6). Escalation to safe is SPEC-CRWDQ-052's job.
 *
 * The returned `FixturesInstance` satisfies the shared `TemplateInstance`
 * contract: `detach()` tears every card down + returns the host root for the
 * supersede transition; `reconcile?` applies a D-GRH-13 in-place revision of the
 * `fixture_ids` set WITHOUT remount / PlannedState-transition / dwell reset.
 * `applyPending` re-formats every card's time at a dwell boundary on a timezone
 * change (AC12).
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { RenderJournal } from '../../render/RenderJournal';
import type { TransitionExecutor } from '../../render/TransitionExecutor';
import type {
  TemplateInstance,
  TemplateReconcileEvent,
} from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { ProgramSlotPayload, TransitionSpec } from '../../render/types';
import type { CardTransitions } from '../multi-game/CardSet';
import { FixtureCardSet } from './FixtureCardSet';

/** Stable test id for the fixtures section root (cards carry their own). */
export const FIXTURES_TESTID = {
  root: 'fixtures-root',
} as const;

/** Named card animations for reconcile (D-GRH-50 catalog names). */
export const FIXTURE_CARD_ANIMATION = {
  enter: 'card_slide_in',
  exit: 'card_slide_out',
} as const;

/**
 * The minimal pending-preference surface this template consumes at a dwell
 * boundary. SPEC-CRWDQ-034 cares only about a `timezone` change (re-format all
 * cards, AC12); a theme change in the full `PendingPreferenceApply` is applied
 * by the SPEC-CRWDQ-023 activator's theme path, not the bare template.
 */
export interface PendingPreferenceApply {
  /** A new bar-local IANA timezone to re-format card times under (D-GRH-73). */
  timezone?: string;
}

export interface FixturesContext {
  /** Resolved ProgramSlot — `fixture_ids[]` non-empty; entries are eventIds. */
  programSlot: ProgramSlotPayload;
  /** Resolved theme for the `data-theme` attribute (SPEC-CRWDQ-023 contract). */
  theme: ResolvedTheme;
  /** Bar-local IANA timezone (D-GRH-73). */
  timezone: string;
  fixtureListStore: FixtureListStore;
  /** Consumed from SPEC-CRWDQ-064; this template neither defines nor creates it. */
  assetManifestStore: AssetManifestStore;
  /** Shared SPEC-CRWDQ-023 PlannedState-level transition executor. */
  transitionExecutor: TransitionExecutor;
  /** The PlannedState's catalog-name transition (SPEC-CRWDQ-017; `"cut"`). */
  transition: TransitionSpec;
  journal: RenderJournal;
  /** Card-level animation seam; defaults to no-op when omitted. */
  cardTransitions?: CardTransitions;
  /** Clock seam (INV-FACTORY-17); defaults to `Date.now`. */
  now?: () => number;
  /** Pending preference apply drained at the dwell boundary, or null (AC12). */
  pendingApply: PendingPreferenceApply | null;
}

/**
 * The `fixtures` instance. Like `multiple_games` (and unlike the bare
 * single_game instance) it DOES implement `reconcile?` (AC11): the list has
 * card-level enter/exit transitions, exactly the case the shared contract
 * reserves the hook for.
 */
export interface FixturesInstance extends TemplateInstance {
  reconcile(event: TemplateReconcileEvent): Promise<void>;
  /** Apply a drained pending preference at the dwell boundary (AC12). */
  applyPending(pending: PendingPreferenceApply): void;
}

const noopCardTransitions: CardTransitions = {
  enter: async () => {},
  exit: async () => {},
};

export class FixturesTemplate {
  /**
   * Mount the fixtures catalog, or null when `fixture_ids[]` is empty (AC6).
   * A null return tells the activator the template declined to mount.
   */
  mount(host: HTMLElement, ctx: FixturesContext): FixturesInstance | null {
    const fixtureIds = ctx.programSlot.fixture_ids ?? [];
    if (fixtureIds.length === 0) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'empty_fixture_ids',
        program_slot_id: ctx.programSlot.program_slot_id,
      });
      return null;
    }

    const root = buildRoot(themeAttr(ctx.theme), fixtureIds.length);
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

    // Mount adds cards with NO card-level animation (AC7).
    fixtureIds.forEach((eventId, position) => void cards.addCard(eventId, position));

    const instance = new FixturesInstanceImpl(root, cards, ctx.journal);

    // PlannedState-level transition on mount (AC7) — always "cut" for fixtures.
    void ctx.transitionExecutor.run(ctx.transition, host);

    // A pending timezone present at mount re-formats immediately (AC12).
    if (ctx.pendingApply) instance.applyPending(ctx.pendingApply);

    return instance;
  }
}

/**
 * The live fixtures instance. Owns the supersede `detach()` (tear every card
 * down, return the root) and the D-GRH-13 `reconcile` (diff `fixture_ids`, slide
 * cards in/out, reposition survivors — no dwell reset, AC11).
 */
class FixturesInstanceImpl implements FixturesInstance {
  constructor(
    private readonly root: HTMLElement,
    private readonly cards: FixtureCardSet,
    private readonly journal: RenderJournal,
  ) {}

  detach(): HTMLElement {
    this.cards.teardown();
    this.root.remove();
    return this.root;
  }

  /**
   * Apply an in-place revision. Only a `program_slot` event reshapes the card
   * set; `ad_slot` and `game_state_revision` are no-ops (the bare fixtures
   * template carries no ad_slot and never subscribes to GameState — AC11). The
   * slide in/out + reposition runs WITHOUT touching the dwell timer (AC11) — the
   * activator owns the dwell and never re-arms it for a reconcile.
   */
  async reconcile(event: TemplateReconcileEvent): Promise<void> {
    if (event.kind !== 'program_slot') return;
    const slot = event.slot;
    const before = this.cards.current();
    const after = slot.fixture_ids ?? [];

    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    const reordered = survivorsThatMoved(before, after, removed, added);

    for (const eventId of removed) {
      await this.cards.removeCard(eventId, FIXTURE_CARD_ANIMATION.exit);
    }
    for (let position = 0; position < after.length; position += 1) {
      const eventId = after[position]!;
      if (added.includes(eventId)) {
        await this.cards.addCard(eventId, position, FIXTURE_CARD_ANIMATION.enter);
      } else {
        this.cards.moveCard(eventId, position);
      }
    }

    this.root.dataset['cardCount'] = String(after.length);

    // No change to the fixture set or order: nothing to journal (AC11).
    if (removed.length === 0 && added.length === 0 && reordered.length === 0) {
      return;
    }
    this.journal.record({
      type: 'fixtures_reconciled',
      program_slot_id: slot.program_slot_id,
      added,
      removed,
      reordered,
    });
  }

  applyPending(pending: PendingPreferenceApply): void {
    if (pending.timezone === undefined) return;
    this.cards.reformatAll(pending.timezone);
    this.journal.record({ type: 'template_locale_refresh', timezone: pending.timezone });
  }
}

/**
 * Survivors (present in both before + after) whose ABSOLUTE position changed.
 * Each card lands in exactly one of the added / removed / reordered lists.
 */
function survivorsThatMoved(
  before: readonly string[],
  after: readonly string[],
  removed: readonly string[],
  added: readonly string[],
): string[] {
  return after.filter((id, afterIndex) => {
    if (added.includes(id) || removed.includes(id)) return false;
    return before.indexOf(id) !== afterIndex;
  });
}

/** Build the empty fixtures skeleton: section > header + list (AC1). */
function buildRoot(themeAttrValue: string, cardCount: number): HTMLElement {
  const section = document.createElement('section');
  section.className = 'crowdaq-fixtures';
  section.dataset['theme'] = themeAttrValue;
  section.dataset['cardCount'] = String(cardCount);
  section.dataset['testid'] = FIXTURES_TESTID.root;

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
