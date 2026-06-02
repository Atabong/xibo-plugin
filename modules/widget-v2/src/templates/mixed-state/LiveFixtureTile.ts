/**
 * SPEC-CRWDQ-066 — `LiveFixtureTile`, the reduced-surface live render that
 * upgrades the promoted fixture's `<li>` from a static SPEC-CRWDQ-034 card body
 * to a compact, GameState-driven score tile.
 *
 * It REUSES the SPEC-CRWDQ-023 `GameStateStore.subscribe` wiring — the same
 * subscribe / get / unsubscribe surface the full-surface `SingleGameTemplate`
 * drives (INV-FACTORY-19: compose the store, do not fork it) — but mounts a
 * tile-shaped DOM: a sport badge, a home/clock/away score block, and a
 * LIVE/FINAL pill. It deliberately renders NEITHER the `sport_context` header
 * NOR the `last_moment` overlay — those are full-surface-only (the spec's
 * "reduced surface" rule).
 *
 * Team identity is the `Fixture` frame's `homeTeam`/`awayTeam` display names —
 * a `GameState` carries no team_id on the wire (the same Team-identity note the
 * static fixture card honours). Per-event `GameState` deltas mutate the score /
 * clock text nodes IN PLACE; no transition runs on a per-event update. A
 * `status === "final"` flip freezes the score block on the last applied values
 * and swaps the LIVE pill for FINAL — the tile does NOT auto-demote (the player
 * waits for the backend to re-promote via a new ProgramSlot / PlannedState).
 *
 * The sport badge follows the SPEC-CRWDQ-034 card's resolution exactly: a
 * synchronous `AssetManifestStore.get` hit paints the `<img>`; a miss renders
 * the league-name text fallback (D-GRH-08) and `ensure()`s once, swapping the
 * resolved badge in while the fallback is still showing. The substitutable
 * boundaries are the asset fetch + the GameState source (INV-FACTORY-17);
 * everything else is in-process DOM over the real stores.
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { GameStateStore } from '../../render/GameStateStore';
import type { GameState } from '../../render/types';
import { badgeAssetId } from '../fixtures/badgeAssetId';
import type { Fixture } from '../fixtures/types';

/** Stable test ids for the live tile's score sub-regions. */
export const LIVE_TILE_TESTID = {
  score: 'live-tile-score',
  homeScore: 'live-tile-home-score',
  awayScore: 'live-tile-away-score',
  clock: 'live-tile-clock',
  status: 'live-tile-status',
} as const;

export interface LiveFixtureTileContext {
  /** The promoted slot's `primary_game_id`. */
  gameId: string;
  /** The promoted fixture's static frame — the source of team / sport / league. */
  fixture: Fixture;
  gameStateStore: GameStateStore;
  assetManifestStore: AssetManifestStore;
}

export interface LiveFixtureTileInstance {
  /** Unsubscribe the GameState listener and hand back the tile host node. */
  detach(): HTMLElement;
}

export class LiveFixtureTile {
  /**
   * Mount the live tile body INTO `host` (the promoted fixture's `<li>`).
   * Subscribes to `gameStateStore` for `gameId`; the returned instance's
   * `detach()` unsubscribes.
   */
  mount(host: HTMLElement, ctx: LiveFixtureTileContext): LiveFixtureTileInstance {
    host.append(buildBody(ctx.fixture));
    renderBadge(host, ctx.fixture, ctx.assetManifestStore);

    const render = (state: GameState | null): void => renderScore(host, state);
    render(ctx.gameStateStore.get(ctx.gameId));
    const unsubscribe = ctx.gameStateStore.subscribe(ctx.gameId, render);

    return {
      detach(): HTMLElement {
        unsubscribe();
        return host;
      },
    };
  }
}

/** Build the tile body: badge + score block (home / clock / away) + pill. */
function buildBody(fixture: Fixture): DocumentFragment {
  const frag = document.createDocumentFragment();

  const badge = document.createElement('span');
  badge.className = 'cdq-sport-badge';

  const score = document.createElement('div');
  score.className = 'cdq-tile-score';
  score.dataset['testid'] = LIVE_TILE_TESTID.score;

  const home = teamCell('cdq-tile-home', fixture.homeTeam, LIVE_TILE_TESTID.homeScore, 'home');
  const clock = document.createElement('span');
  clock.className = 'cdq-tile-clock';
  clock.dataset['testid'] = LIVE_TILE_TESTID.clock;
  const away = teamCell('cdq-tile-away', fixture.awayTeam, LIVE_TILE_TESTID.awayScore, 'away');

  score.append(home, clock, away);

  const status = document.createElement('span');
  status.className = 'cdq-status';
  status.dataset['testid'] = LIVE_TILE_TESTID.status;
  status.dataset['status'] = 'live';
  status.textContent = 'LIVE';

  frag.append(badge, score, status);
  return frag;
}

/**
 * Build one team cell: the team NAME (from the fixture) + the score node. The
 * home cell lays out name-then-score, the away cell score-then-name, matching
 * the spec's symmetric DOM (`HOME 0 | clock | 0 AWAY`).
 */
function teamCell(
  className: string,
  teamName: string,
  scoreTestId: string,
  side: 'home' | 'away',
): HTMLElement {
  const cell = document.createElement('span');
  cell.className = `cdq-tile-team ${className}`;

  const name = document.createElement('span');
  name.className = 'cdq-team-name';
  name.textContent = teamName;

  const scoreNode = document.createElement('span');
  scoreNode.className = side === 'home' ? 'cdq-tile-home-score' : 'cdq-tile-away-score';
  scoreNode.dataset['testid'] = scoreTestId;
  scoreNode.textContent = '0';

  cell.append(...(side === 'home' ? [name, scoreNode] : [scoreNode, name]));
  return cell;
}

/** Populate the score / clock / pill from the current GameState. */
function renderScore(body: ParentNode, state: GameState | null): void {
  const sel = (testid: string): HTMLElement | null =>
    body.querySelector(`[data-testid="${testid}"]`);

  const home = sel(LIVE_TILE_TESTID.homeScore);
  if (home) home.textContent = scoreText(state?.home_score);
  const away = sel(LIVE_TILE_TESTID.awayScore);
  if (away) away.textContent = scoreText(state?.away_score);
  const clock = sel(LIVE_TILE_TESTID.clock);
  if (clock) clock.textContent = state?.sport_context?.period_clock ?? '';

  const status = sel(LIVE_TILE_TESTID.status);
  if (status) {
    const isFinal = state?.status === 'final';
    status.textContent = isFinal ? 'FINAL' : 'LIVE';
    status.dataset['status'] = isFinal ? 'final' : 'live';
  }
}

/** A score node's text: the number, or "0" before any value has applied. */
function scoreText(score: number | undefined): string {
  return score === undefined ? '0' : String(score);
}

/**
 * Resolve the sport/league badge exactly as the SPEC-CRWDQ-034 card does: a
 * synchronous hit paints the `<img>`; a miss renders the league-name text
 * fallback (D-GRH-08) and `ensure()`s once, swapping the resolved badge in only
 * while the league-name fallback is still showing.
 */
function renderBadge(body: ParentNode, fixture: Fixture, assets: AssetManifestStore): void {
  const badge = body.querySelector<HTMLElement>('.cdq-sport-badge');
  if (!badge) return;
  const assetId = badgeAssetId(fixture.sport, fixture.leagueName);

  const cached = assets.get(assetId);
  if (cached !== null) {
    paintBadge(badge, cached.url);
    return;
  }

  badge.replaceChildren(document.createTextNode(fixture.leagueName));
  void assets
    .ensure(assetId)
    .then((asset) => {
      if (badge.querySelector('img') === null) paintBadge(badge, asset.url);
    })
    .catch(() => {
      // Fetch failed: the league-name text fallback keeps the tile legible.
    });
}

/** Paint a badge `<img>` with the resolved asset url. */
function paintBadge(badge: HTMLElement, url: string): void {
  const img = document.createElement('img');
  img.alt = '';
  img.setAttribute('src', url);
  badge.replaceChildren(img);
}
