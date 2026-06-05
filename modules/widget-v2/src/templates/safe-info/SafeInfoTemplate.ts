/**
 * SPEC-CRWDQ-052 — the `safe_info` business-mode template (D-GRH-30 #8).
 *
 * A static, sport-neutral, theme-aware "stay tuned" panel. It carries NO
 * game-data dependency, always renders, and is offline-safe per D-SAFE-01: the
 * venue-brand asset (if any) is read SYNCHRONOUSLY from the warm
 * `AssetManifestStore.get(...)` hot map — the template never calls `ensure()`
 * and never touches the network.
 *
 * `safe_info` is reached three ways (Paths A/B/C — see {@link SafeStateController});
 * all converge here. The `source` discriminates why, and drives the calm,
 * non-alarming footer status per the D-GRH-76-reconciled source/reason map.
 *
 * DOM (AC1): one `<section class="crowdaq-safe-info" data-theme data-source
 * data-reason>` with a header (venue brand), a body (CROWDAQ wordmark +
 * tagline), and a footer (status text). No motion is applied to the body
 * (AC6 / D-GRH-31 anti-flash + D-SAFE-01 calm intent) — the outer
 * PlannedState-level transition is the activator's, never the body's.
 */
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { TemplateInstance } from '../../render/TemplateInstance';
import { themeAttr, type ResolvedTheme } from '../../render/ThemeResolver';
import type { BarPreferencesWire } from '../../wire';
import type { ProgramSlotPayload } from '../../render/types';

/** Stable test ids for the template's sub-regions (AC1). */
export const SAFE_INFO_TESTID = {
  root: 'safe-info-root',
  header: 'safe-info-header',
  venue: 'safe-info-venue',
  body: 'safe-info-body',
  title: 'safe-info-title',
  tagline: 'safe-info-tagline',
  footer: 'safe-info-footer',
  status: 'safe-info-status',
} as const;

/** The CROWDAQ wordmark + tagline rendered in the body (D-GRH-22 brand panel). */
const WORDMARK = 'CROWDAQ';
const TAGLINE = 'Live sports excitement';

/**
 * Why the safe template is mounted. The reason is calm by construction; it
 * keys the footer status text (the only patron-visible reason channel — the
 * backend wire carries no reason field, RESOLVED note in the spec).
 */
export type SafeSource =
  | { kind: 'backend_planned'; reason: 'scheduled' | 'no_content' | 'maintenance' }
  | { kind: 'player_fallback'; reason: 'control_channel_lost' | 'data_stale' | 'no_recent_state' }
  | { kind: 'template_escalation'; reason: 'template_input_invalid' | 'template_buffer_timeout' };

/**
 * The bar-preferences subset the safe template reads. It is the locked
 * D-GRH-73 `BarPreferencesWire` (theme + city + state) PLUS the `bar_id` the
 * venue-brand asset key is built from. `bar_id` is envelope metadata on the
 * wire (lifted out of `BarPreferencesWire`), so the caller — which received
 * the ConfigPush envelope — re-attaches it here; the template never reaches
 * into a ConfigPushHandler internal to find it (INV-FACTORY-19).
 */
export interface SafeBarPreferences extends BarPreferencesWire {
  bar_id: string;
}

export interface SafeInfoContext {
  /**
   * The ProgramSlot when entered via a backend PlannedState (Path A); null
   * when entered via the controller (Path B) or escalation (Path C). The safe
   * template renders no game data, so the slot is unused for content — it is
   * carried only to match the shared activation contract.
   */
  programSlot: ProgramSlotPayload | null;
  /** SPEC-CRWDQ-023 three-state resolved theme (set/default/unset). */
  theme: ResolvedTheme;
  /**
   * Active bar preferences (D-GRH-73) driving venue branding. Null only on a
   * cold boot before the first ConfigPush — resolves to the wordmark (AC2).
   */
  barPreferences: SafeBarPreferences | null;
  /** Synchronous venue-brand asset source (SPEC-CRWDQ-064). */
  assetManifestStore: AssetManifestStore;
  /** Why are we here? Keys the footer status (AC7). */
  source: SafeSource;
}

/** The mounted safe instance: a bare {@link TemplateInstance} (no reconcile). */
export type SafeInfoInstance = TemplateInstance;

/** The venue-brand asset key for a bar (SPEC-CRWDQ-064 cache key, AC2 rung 1). */
export function venueBrandAssetId(barId: string): string {
  return `venue_brand:${barId}`;
}

/**
 * The source/reason -> footer-text map (AC7). Calm, non-alarming phrasings
 * only: every reason maps to an explicit, patron-legible status — backend-planned
 * reasons affirm the CROWDAQ link ("Connected to CROWDAQ · …"), player fallbacks
 * say we are reconnecting/connecting, and template escalations say the display is
 * recovering. These are player-authored indicators, not echoes of any wire field
 * (D-GRH-76 reconciled).
 */
const FOOTER_STATUS: Record<SafeSource['kind'], Record<string, string>> = {
  backend_planned: {
    scheduled: 'Connected to CROWDAQ · waiting for next game',
    no_content: 'Connected to CROWDAQ · nothing scheduled',
    maintenance: 'Connected to CROWDAQ · scheduled maintenance',
  },
  player_fallback: {
    control_channel_lost: 'Reconnecting to CROWDAQ backend…',
    data_stale: 'Reconnecting · showing last update',
    no_recent_state: 'Connecting to CROWDAQ backend…',
  },
  template_escalation: {
    template_input_invalid: 'Recovering display · data issue',
    template_buffer_timeout: 'Recovering display · timed out',
  },
};

/** Footer text for a source, or '' when the map has no entry (defensive). */
export function footerStatusText(source: SafeSource): string {
  return FOOTER_STATUS[source.kind][source.reason] ?? '';
}

export class SafeInfoTemplate {
  /** Mount the static safe panel into `host`. */
  mount(host: HTMLElement, ctx: SafeInfoContext): SafeInfoInstance {
    const root = buildRoot(ctx);
    host.appendChild(root);
    return {
      detach(): HTMLElement {
        root.remove();
        return root;
      },
    };
  }
}

/** Build the full safe_info skeleton from the context (a pure render). */
function buildRoot(ctx: SafeInfoContext): HTMLElement {
  const root = document.createElement('section');
  root.className = 'crowdaq-safe-info';
  root.dataset['testid'] = SAFE_INFO_TESTID.root;
  root.dataset['theme'] = themeAttr(ctx.theme);
  root.dataset['source'] = ctx.source.kind;
  root.dataset['reason'] = ctx.source.reason;

  // Atmospheric depth chrome (CSS-painted gradient mesh + grain + vignette +
  // a slow ambient aura). This is decorative background, not body motion — the
  // wordmark/tagline body stays still per D-SAFE-01 / AC6.
  for (const cls of ['cdq-bg-mesh', 'cdq-bg-grain', 'cdq-bg-vignette', 'cdq-safe-aura']) {
    const layer = document.createElement('div');
    layer.className = cls;
    root.append(layer);
  }

  root.append(buildHeader(ctx), buildBody(), buildFooter(ctx.source));
  return root;
}

/** Header: the venue brand resolved via the AC2 fallback chain. */
function buildHeader(ctx: SafeInfoContext): HTMLElement {
  const header = document.createElement('header');
  header.className = 'cdq-safe-header';
  header.dataset['testid'] = SAFE_INFO_TESTID.header;

  const venue = document.createElement('span');
  venue.className = 'cdq-venue-name';
  venue.dataset['testid'] = SAFE_INFO_TESTID.venue;
  renderVenueBrand(venue, ctx);

  header.append(venue);
  return header;
}

/**
 * Venue-brand fallback chain (AC2), first non-null wins:
 *   1. cached venue-brand asset -> <img> (synchronous get(), no fetch — AC9);
 *   2. else city + state populated -> "CITY, STATE" uppercased;
 *   3. else (incl. null barPreferences) -> the wordmark only (empty header).
 */
function renderVenueBrand(venue: HTMLElement, ctx: SafeInfoContext): void {
  const prefs = ctx.barPreferences;
  if (prefs === null) return;

  const cached = ctx.assetManifestStore.get(venueBrandAssetId(prefs.bar_id));
  if (cached !== null) {
    const img = document.createElement('img');
    img.className = 'cdq-venue-brand-img';
    img.src = cached.url;
    img.alt = '';
    venue.append(img);
    return;
  }

  const city = prefs.city;
  const state = prefs.state;
  if (city !== null && city.length > 0 && state !== null && state.length > 0) {
    venue.textContent = `${city.toUpperCase()}, ${state.toUpperCase()}`;
  }
}

/**
 * Body: a designed standby lock-up — a kicker strap, the CROWDAQ wordmark with
 * an accent underscore, and the tagline. The wordmark/tagline carry their exact
 * testids + text so the AC + e2e contract holds (title === "CROWDAQ"). No body
 * motion (AC6 / D-SAFE-01): the only movement is the decorative root aura.
 */
function buildBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'cdq-safe-body';
  body.dataset['testid'] = SAFE_INFO_TESTID.body;

  const kicker = document.createElement('span');
  kicker.className = 'cdq-safe-kicker';
  kicker.textContent = 'LIVE SPORTS NETWORK';

  const lockup = document.createElement('div');
  lockup.className = 'cdq-safe-lockup';

  const title = document.createElement('h1');
  title.className = 'cdq-safe-title';
  title.dataset['testid'] = SAFE_INFO_TESTID.title;
  title.textContent = WORDMARK;

  const rule = document.createElement('span');
  rule.className = 'cdq-safe-rule';

  lockup.append(title, rule);

  const tagline = document.createElement('p');
  tagline.className = 'cdq-safe-tagline';
  tagline.dataset['testid'] = SAFE_INFO_TESTID.tagline;
  tagline.textContent = TAGLINE;

  body.append(kicker, lockup, tagline);
  return body;
}

/** Footer: the calm, source/reason-keyed status indicator (AC7). */
function buildFooter(source: SafeSource): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'cdq-safe-footer';
  footer.dataset['testid'] = SAFE_INFO_TESTID.footer;

  const status = document.createElement('span');
  status.className = 'cdq-safe-status';
  status.dataset['testid'] = SAFE_INFO_TESTID.status;
  status.textContent = footerStatusText(source);

  footer.append(status);
  return footer;
}
