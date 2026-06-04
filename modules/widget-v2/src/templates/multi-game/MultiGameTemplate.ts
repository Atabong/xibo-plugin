/**
 * SPEC-CRWDQ-031 — the `multiple_games` business-mode template (D-GRH-30 #2).
 *
 * `mount(host, ctx)` renders a 2×2 CSS-grid `<section>` holding one
 * `<div class="cdq-card">` per `game_id` in `ProgramSlot.game_ids[]`
 * (D-GRH-14 order preserved, 2–4 cards), each subscribed independently to the
 * multiplexed `GameStateStore` (D-GRH-12). The `primary_game_id` card carries
 * `data-primary="true"`. The returned `MultiGameInstance` satisfies the shared
 * `TemplateInstance` contract: `detach()` unsubscribes every card and hands
 * back the host node for the supersede transition, and `reconcile?` applies the
 * D-GRH-13 in-place card add/remove/reorder without remount or dwell reset.
 *
 * Card count is validated against [2, 4] at mount: an out-of-range slot journals
 * `template_input_invalid` and does NOT mount (AC2) — escalation to safe is
 * SPEC-CRWDQ-052's job, out of scope here. No card-level transition runs at
 * mount; `card_slide_in` / `card_slide_out` run ONLY inside reconcile (AC5).
 */
import type { RenderJournal } from '../../render/RenderJournal';
import type { GameStateStore } from '../../render/GameStateStore';
import type {
  TemplateInstance,
  TemplateReconcileEvent,
} from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { ProgramSlotPayload } from '../../render/types';
import { CardSet, CARD_ANIMATION, noopCardTransitions, type CardTransitions } from './CardSet';
import type { CrestResolver } from '../../render/CrestResolver';

/** Stable test ids for the grid root (cards carry their own, see CardSet). */
export const MULTI_TESTID = {
  root: 'multi-game-root',
} as const;

/** The valid card-count range a multiple_games slot may carry (D-GRH-14). */
export const MIN_CARDS = 2;
export const MAX_CARDS = 4;

export interface MultiGameContext {
  /** Resolved ProgramSlot — `game_ids[]` (2..4) + `primary_game_id` (∈ ids). */
  programSlot: ProgramSlotPayload;
  /** Resolved theme for the `data-theme` attribute (SPEC-CRWDQ-023 contract). */
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
  journal: RenderJournal;
  /** Card-level animation seam; defaults to no-op when omitted. */
  cardTransitions?: CardTransitions;
  /** SPEC-CRWDQ-S11 — resolve real club crests from the AssetManifest by team. */
  crestResolver?: CrestResolver;
}

/**
 * The `multiple_games` instance. Unlike the bare single_game instance it DOES
 * implement `reconcile?` (AC6): the grid has card-level enter/exit transitions,
 * which is exactly the case the shared contract reserves the hook for.
 */
export interface MultiGameInstance extends TemplateInstance {
  reconcile(event: TemplateReconcileEvent): Promise<void>;
}

export class MultiGameTemplate {
  /**
   * Mount the grid for the slot, or null when the card count is out of range
   * (AC2). A null return tells the activator the template declined to mount.
   */
  mount(host: HTMLElement, ctx: MultiGameContext): MultiGameInstance | null {
    const gameIds = ctx.programSlot.game_ids;
    if (gameIds.length < MIN_CARDS || gameIds.length > MAX_CARDS) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'card_count_out_of_range',
        program_slot_id: ctx.programSlot.program_slot_id,
        card_count: gameIds.length,
      });
      return null;
    }

    const grid = buildGrid(themeAttr(ctx.theme), gameIds.length);
    host.append(grid);

    const cardSet = new CardSet({
      grid,
      gameStateStore: ctx.gameStateStore,
      cardTransitions: ctx.cardTransitions ?? noopCardTransitions,
      ...(ctx.crestResolver ? { crestResolver: ctx.crestResolver } : {}),
    });
    // Mount adds cards with NO card-level animation (AC5).
    gameIds.forEach((gameId, position) => void cardSet.addCard(gameId, position));
    cardSet.setPrimary(primaryWithin(ctx.programSlot));

    return new MultiGameInstanceImpl(grid, cardSet, ctx.journal);
  }
}

/**
 * The live grid instance. Owns the supersede `detach()` (tear every card down,
 * return the host node) and the D-GRH-13 `reconcile` (diff `game_ids`, slide
 * cards in/out, reposition survivors, re-mark primary — no dwell reset, AC5).
 */
class MultiGameInstanceImpl implements MultiGameInstance {
  constructor(
    private readonly grid: HTMLElement,
    private readonly cardSet: CardSet,
    private readonly journal: RenderJournal,
  ) {}

  detach(): HTMLElement {
    this.cardSet.teardown();
    this.grid.remove();
    return this.grid;
  }

  /**
   * Apply an in-place revision. Only a `program_slot` event reshapes the card
   * set; `ad_slot` and `game_state_revision` are no-ops here (per-game state
   * already reaches each card through its own subscription, AC4/AC6). The slide
   * in/out + reposition runs WITHOUT touching the dwell timer (AC5) — the
   * activator owns the dwell and never re-arms it for a reconcile.
   */
  async reconcile(event: TemplateReconcileEvent): Promise<void> {
    if (event.kind !== 'program_slot') return;
    const slot = event.slot;
    const before = this.cardSet.current();
    const after = slot.game_ids;

    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    const reordered = survivorsThatMoved(before, after, removed, added);

    // Exit the dropped cards (card_slide_out), then enter the new ones at their
    // target position (card_slide_in), then reposition every survivor.
    for (const gameId of removed) {
      await this.cardSet.removeCard(gameId, CARD_ANIMATION.exit);
    }
    for (let position = 0; position < after.length; position += 1) {
      const gameId = after[position]!;
      if (added.includes(gameId)) {
        await this.cardSet.addCard(gameId, position, CARD_ANIMATION.enter);
      } else {
        this.cardSet.moveCard(gameId, position);
      }
    }

    this.grid.dataset['cardCount'] = String(after.length);
    this.cardSet.setPrimary(primaryWithin(slot));

    // No change to the card set or order: nothing to journal (AC7).
    if (removed.length === 0 && added.length === 0 && reordered.length === 0) {
      return;
    }
    this.journal.record({
      type: 'multi_game_reconciled',
      program_slot_id: slot.program_slot_id,
      added,
      removed,
      reordered,
    });
  }
}

/** The slot's primary game id, but only when it is one of the rendered cards. */
function primaryWithin(slot: ProgramSlotPayload): string | null {
  const primary = slot.primary_game_id;
  return primary !== null && slot.game_ids.includes(primary) ? primary : null;
}

/**
 * Survivors (present in both before + after) whose ABSOLUTE grid position
 * changed — a survivor reported here had its `data-position` re-stamped by
 * `moveCard`, whether because it was reordered or because a card ahead of it
 * was removed / inserted. Each card lands in exactly one of the added /
 * removed / reordered lists (AC7). Reported in post-reconcile display order.
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

/** Build the empty 2×2 grid skeleton carrying card-count + theme (AC1). */
function buildGrid(themeAttrValue: string, cardCount: number): HTMLElement {
  const section = document.createElement('section');
  section.className = 'crowdaq-multi-game cdq-grid-2x2';
  section.dataset['theme'] = themeAttrValue;
  section.dataset['cardCount'] = String(cardCount);
  section.dataset['testid'] = MULTI_TESTID.root;
  return section;
}
