/**
 * SPEC-CRWDQ-046 — the `recap` business-mode template (D-GRH-68).
 *
 * `mount(host, ctx)` renders the post-game closing image: a FULL TIME header
 * with the sport/league badge, the final score with team NAMES, the derived
 * winner highlight, and an optional single headline moment. It is a FROZEN
 * snapshot — it reads `GameState` ONCE at mount and never subscribes
 * (D-GRH-68 closing image). A late `GameEvent` for the same game after mount is
 * journaled `recap_late_event` but does NOT mutate the DOM.
 *
 * Per SPEC-CRWDQ-045 the recap's `ProgramSlot` is freshly minted alongside the
 * `PlannedState`: `primary_game_id` is the recap target, `game_ids =
 * [primary_game_id]`, `fixture_ids = []`. The template reads only
 * `primary_game_id` — it never assumes the recap reuses the preceding
 * live-game slot.
 *
 * Data sources, cross-checked against `crowdaq-backend` `src/wire/types.ts`:
 *  - final score + `status` + `sport_context` — the in-memory `GameState`;
 *  - team NAMES — the cached `FixtureList` joined on `game_id` (the canonical
 *    `event_id`); `GameState` carries no team identity, and there is no wire
 *    `team_id`, so there is no per-team logo;
 *  - the single headline moment — `ctx.headlineMoment` (the recap
 *    `PlannedState` render-hint blob, SPEC-CRWDQ-045 `HeadlineMoment`).
 *
 * Two inputs fall through to safe (the template declines, returning null; the
 * activator escalates per SPEC-CRWDQ-052): a null `primary_game_id` (journal
 * `template_input_invalid`) and a `GameState` cache miss (journal
 * `recap_no_gamestate`). Everything else degrades IN PLACE: a FixtureList miss
 * renders `"Home"` / `"Away"` placeholders, a badge-cache miss leaves the badge
 * slot empty, a null headline moment omits its block, and a non-`final` status
 * journals `recap_premature` but still mounts whatever state exists.
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { FixtureListStore } from '../../render/FixtureListStore';
import type { GameStateStore } from '../../render/GameStateStore';
import type { RenderJournal } from '../../render/RenderJournal';
import type { TemplateInstance, TemplateReconcileEvent } from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { GameState, ProgramSlotPayload } from '../../render/types';
import { badgeAssetId } from '../fixtures/badgeAssetId';

/** Stable test ids / class hooks for the recap sub-regions (AC1). */
export const RECAP_TESTID = {
  root: 'recap-root',
} as const;

/** SPEC-CRWDQ-045 HeadlineMoment — carried in the recap PlannedState render-hint. */
export interface HeadlineMoment {
  kind: 'goal' | 'card' | 'turning_point';
  atClock: string;
  detail: Record<string, unknown>;
}

/**
 * The minimal pending-preference surface the recap consumes at a dwell
 * boundary. The bare template (part 1) accepts but does not act on it — the
 * shared SPEC-CRWDQ-023 activator owns the dwell-boundary theme swap
 * (SPEC-CRWDQ-046 part 2). Modelled like the fixtures template's slot so the
 * recap adapter binds to one shape.
 */
export interface PendingPreferenceApply {
  theme?: unknown;
}

export interface RecapContext {
  /** The recap's own freshly minted ProgramSlot; `primary_game_id` is the target. */
  programSlot: ProgramSlotPayload;
  /** SPEC-CRWDQ-023 three-state theme (set/default/unset). */
  theme: ResolvedTheme;
  gameStateStore: GameStateStore;
  /**
   * The player's cached FixtureList (SPEC-CRWDQ-034). Recap team identity is
   * joined from here by `event_id` — `GameState` carries no team fields
   * (verified `crowdaq-backend` `src/wire/types.ts`).
   */
  fixtureListStore: FixtureListStore;
  /** SPEC-CRWDQ-064 — sport/league badge resolution (no per-team logo). */
  assetManifestStore: AssetManifestStore;
  /**
   * The single headline moment from the recap PlannedState's render-hint blob,
   * or null when the backend supplied none (SPEC-CRWDQ-045 HeadlineMoment).
   */
  headlineMoment: HeadlineMoment | null;
  /** Drained at a dwell boundary by the activator (part 2); ignored by the bare template. */
  pendingApply: PendingPreferenceApply | null;
  journal: RenderJournal;
}

/**
 * The recap instance. It implements `reconcile?` ONLY to journal a late
 * `GameEvent` (`recap_late_event`) without mutating the frozen DOM (D-GRH-68);
 * it holds no `GameStateStore` subscription, so `detach()` has nothing to
 * unwind beyond removing the root.
 */
export interface RecapInstance extends TemplateInstance {
  reconcile(event: TemplateReconcileEvent): Promise<void>;
}

/** Placeholder labels when the FixtureList has no entry for the recap's game. */
const PLACEHOLDER_HOME = 'Home';
const PLACEHOLDER_AWAY = 'Away';

export class RecapTemplate {
  /**
   * Mount the recap composition, or null when the template declines (a null
   * `primary_game_id` or a `GameState` cache miss — both fall through to safe).
   */
  mount(host: HTMLElement, ctx: RecapContext): RecapInstance | null {
    const gameId = ctx.programSlot.primary_game_id;
    if (gameId === null) {
      ctx.journal.record({
        type: 'template_input_invalid',
        reason: 'recap_missing_primary_game',
        program_slot_id: ctx.programSlot.program_slot_id,
      });
      return null;
    }

    const gameState = ctx.gameStateStore.get(gameId);
    if (gameState === null) {
      ctx.journal.record({ type: 'recap_no_gamestate', game_id: gameId });
      return null;
    }

    // A recap fired before the final flip is a backend timing bug: journal it,
    // but proceed with whatever state exists (do not crash — graceful AC).
    if (gameState.status !== 'final') {
      ctx.journal.record({
        type: 'recap_premature',
        game_id: gameId,
        status: gameState.status ?? null,
      });
    }

    const fixture = ctx.fixtureListStore.resolve(gameId);
    const homeName = fixture?.homeTeam ?? PLACEHOLDER_HOME;
    const awayName = fixture?.awayTeam ?? PLACEHOLDER_AWAY;

    const root = buildRoot({
      gameId,
      themeAttrValue: themeAttr(ctx.theme),
      winner: deriveWinner(gameState),
      homeName,
      awayName,
      homeScore: gameState.home_score,
      awayScore: gameState.away_score,
      headlineMoment: ctx.headlineMoment,
    });
    renderBadge(root, gameState, ctx.assetManifestStore);
    host.append(root);

    return new RecapInstanceImpl(root, gameId, ctx.journal);
  }
}

/**
 * The live recap instance. It never subscribed to `GameState` (D-GRH-68 frozen
 * image), so `detach()` only removes the root. `reconcile` journals a late
 * same-game revision and returns WITHOUT touching the DOM.
 */
class RecapInstanceImpl implements RecapInstance {
  constructor(
    private readonly root: HTMLElement,
    private readonly gameId: string,
    private readonly journal: RenderJournal,
  ) {}

  detach(): HTMLElement {
    this.root.remove();
    return this.root;
  }

  /**
   * A late `GameEvent` delta for the recap's game (e.g. a post-final score
   * correction) is journaled `recap_late_event` for backend diagnostics but
   * does NOT re-render: the recap is the closing image (D-GRH-68). Any other
   * revision kind is a no-op (the recap holds no ad slot and no live subscription).
   */
  async reconcile(event: TemplateReconcileEvent): Promise<void> {
    if (event.kind !== 'game_state_revision') return;
    if (event.gameState.game_id !== this.gameId) return;
    this.journal.record({
      type: 'recap_late_event',
      game_id: this.gameId,
      seq: event.gameState.seq,
    });
  }
}

/** Compute the winner from the final scores (in-widget, never a wire field). */
function deriveWinner(state: GameState): 'home' | 'away' | 'draw' {
  const home = state.home_score ?? 0;
  const away = state.away_score ?? 0;
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

interface RootArgs {
  gameId: string;
  themeAttrValue: string;
  winner: 'home' | 'away' | 'draw';
  homeName: string;
  awayName: string;
  homeScore: number | undefined;
  awayScore: number | undefined;
  headlineMoment: HeadlineMoment | null;
}

/** Build the full recap composition (AC1 DOM shape). */
function buildRoot(args: RootArgs): HTMLElement {
  const section = document.createElement('section');
  section.className = 'crowdaq-recap';
  section.dataset['theme'] = args.themeAttrValue;
  section.dataset['gameId'] = args.gameId;
  section.dataset['winner'] = args.winner;
  section.dataset['testid'] = RECAP_TESTID.root;

  section.append(
    buildHeader(),
    buildFinalScore(args),
  );
  const moment = buildHeadlineMoment(args.headlineMoment);
  if (moment !== null) section.append(moment);
  return section;
}

/** The FULL TIME header with a sport/league badge slot (no per-team logo). */
function buildHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'cdq-recap-header';

  const label = document.createElement('span');
  label.className = 'cdq-recap-label';
  label.textContent = 'FULL TIME';

  const sport = document.createElement('span');
  sport.className = 'cdq-sport-context';

  header.append(label, sport);
  return header;
}

/** The final-score block: two teams with NAMES + scores, no logo, no team_id. */
function buildFinalScore(args: RootArgs): HTMLElement {
  const block = document.createElement('div');
  block.className = 'cdq-final-score';
  block.append(
    buildTeam('home', args.homeName, args.homeScore),
    buildTeam('away', args.awayName, args.awayScore),
  );
  return block;
}

/** One team line: a NAME + a score, no per-team logo and no data-team-id. */
function buildTeam(side: 'home' | 'away', name: string, score: number | undefined): HTMLElement {
  const team = document.createElement('div');
  team.className = `cdq-team cdq-team-${side}`;

  const nameEl = document.createElement('span');
  nameEl.className = 'cdq-team-name';
  nameEl.textContent = name;

  const scoreEl = document.createElement('span');
  scoreEl.className = 'cdq-team-score';
  scoreEl.textContent = score === undefined ? '' : String(score);

  team.append(nameEl, scoreEl);
  return team;
}

/** The single headline-moment block, or null when the backend supplied none. */
function buildHeadlineMoment(moment: HeadlineMoment | null): HTMLElement | null {
  if (moment === null) return null;
  const block = document.createElement('div');
  block.className = 'cdq-headline-moment';
  block.dataset['momentKind'] = moment.kind;
  block.textContent = describeMoment(moment);
  return block;
}

/** Human-readable text for a headline moment from its kind + clock + detail. */
function describeMoment(moment: HeadlineMoment): string {
  const label = MOMENT_LABEL[moment.kind];
  const clock = moment.atClock.length > 0 ? `${moment.atClock} ` : '';
  const detail = momentDetail(moment.detail);
  return `${clock}${label}${detail}`.trim();
}

const MOMENT_LABEL: Record<HeadlineMoment['kind'], string> = {
  goal: 'Goal',
  card: 'Card',
  turning_point: 'Turning point',
};

/** A compact, render-safe rendering of the moment's free-form detail blob. */
function momentDetail(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const value of Object.values(detail)) {
    if (typeof value === 'string' && value.length > 0) parts.push(value);
    else if (typeof value === 'number') parts.push(String(value));
  }
  return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
}

/**
 * Resolve the sport/league badge from the AssetManifest (keyed by sport +
 * league, both on `sport_context`). A synchronous cache hit paints the badge
 * `<img>`; a miss leaves the slot empty (no error). There is NO per-team logo —
 * no wire payload carries a `team_id`.
 */
function renderBadge(root: HTMLElement, state: GameState, assets: AssetManifestStore): void {
  const slot = root.querySelector<HTMLElement>('.cdq-sport-context');
  if (!slot) return;
  const sport = state.sport_context?.sport;
  const league = state.sport_context?.league;
  if (typeof sport !== 'string' || typeof league !== 'string' || sport.length === 0 || league.length === 0) {
    return;
  }
  const cached = assets.get(badgeAssetId(sport, league));
  if (cached === null) return;
  const img = document.createElement('img');
  img.alt = '';
  img.setAttribute('src', cached.url);
  slot.append(img);
}
