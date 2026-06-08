/**
 * SPEC-CRWDQ-022/-023 composition root — the player runtime entrypoint.
 *
 * This is the ONE place the implemented-but-decoupled modules are wired into a
 * running widget. It is the missing piece the S5 recon flagged: every module
 * (transport, config, render orchestration, single_game template, asset
 * manifest, observability) is tested in isolation, but nothing assembled them
 * into something a Xibo `<onRender>` can boot. `boot()` does exactly that.
 *
 * Boot sequence (mirrors the e2e harness `tests/.../e2e-support.ts`, which wires
 * the SAME real modules — that harness is the executable blueprint for this
 * file, with the WS/clock/transition-timing seams substituted there and made
 * real here):
 *
 *   1. read `xiboIC.info()` for the display identity (hardwareKey/displayName);
 *   2. resolve the `crowdaq.v1` WS URL from the `wsBaseUrl` widget property
 *      (with `display:<field>` targeting against the resolved info), `/ws` path;
 *   3. construct the render pipeline: ProgramSlotResolver, GameStateStore,
 *      AssetManifestStore, TransitionExecutor (real instant player — no flash),
 *      DwellTimer, ConfigPushHandler, PlannedStateActivator(single_game);
 *   4. build the FrameDispatcher and register every server frame handler:
 *      ConfigPush, AssetManifest, PlannedState + ProgramSlot (via the activator),
 *      and the game-data frames (GameState/GameStateSnapshot/GameEvent) into the
 *      GameStateStore;
 *   5. construct the CrowdaqWsClient(crowdaq.v1), which performs the D-GRH-61
 *      DeviceRegistration handshake + 30 s heartbeat + reconnect backoff;
 *   6. mount the host `<div data-testid="crowdaq-widget-v2">` and connect.
 *
 * The WebSocket, clock and jitter RNG are the only system boundaries; every
 * render decision is made by the real modules. Defaults to the browser globals
 * but each boundary is injectable so the headless e2e (SPEC-CRWDQ-027) can feed
 * a mock crowdaq.v1 server.
 */
import { CrowdaqWsClient, type WebSocketFactory, type WebSocketLike } from './transport/WsClient';
import { createSessionLock, type SessionLock, type SessionLockHandle } from './transport/SessionLock';
import { WireDeserializer, type Deserializer } from './transport/Deserializer';
import type { ParseResult, ServerFrame } from './transport/types';
import { FrameDispatcher, type ActiveGames } from './transport/Dispatcher';
import type {
  Dispatcher,
  GameStateRequester,
  JournalSink,
  WsClientConfig,
} from './transport/types';
import type {
  GameEventFrame,
  GameStateFrame,
  GameStateSnapshotFrame,
  PlayerToServerFrame,
} from './wire';

import { ProgramSlotResolver } from './render/ProgramSlotResolver';
import { GameStateStore } from './render/GameStateStore';
import { DwellTimer, systemDwellClock, type DwellClock } from './render/DwellTimer';
import {
  TransitionExecutor,
  type TransitionDefinition,
  type TransitionPlayer,
} from './render/TransitionExecutor';
import { AssetManifestStore, type ManifestJournal, type ManifestJournalEntry } from './render/AssetManifestStore';
import { CrestResolver } from './render/CrestResolver';
import type { AssetCache, AssetCacheRow } from './render/AssetCache';
import type { AssetFetcher } from './render/AssetFetcher';
import type { AssetEntry, CachedAsset } from './render/AssetTypes';
import type { RenderJournal, RenderJournalEntry } from './render/RenderJournal';
import type { StyleSheetRegistry } from './render/StyleSheetRegistry';
import type { BarThemeSource } from './render/ThemeResolver';
import type { GameEvent, GameState, GameStateSnapshot, SportContext } from './render/types';
import {
  PlannedStateActivator,
  type PendingThemeApply,
} from './render/PlannedStateActivator';
import { SafeStateController } from './render/SafeStateController';
import { SafeInfoTemplate, type SafeBarPreferences } from './templates/safe-info/SafeInfoTemplate';
import { makeSafeAdapter } from './templates/safe-info/SafeAdapter';
import { AmbientTemplate } from './templates/ambient/AmbientTemplate';
import { AmbientPlaylist } from './templates/ambient/AmbientPlaylist';
import { makeAmbientAdapter } from './templates/ambient/AmbientAdapter';

// S9-modes assembly: the remaining D-GRH-26 templates, each registered through
// the SAME PlannedStateActivator seam (INV-FACTORY-19) — never a forked path.
import { FixtureListStore } from './render/FixtureListStore';
import { FixturesTimezoneBroadcast } from './render/FixturesTimezoneBroadcast';
import type { FixtureListFrameTyped } from './templates/fixtures/types';
import { MultiGameTemplate } from './templates/multi-game/MultiGameTemplate';
import { makeMultiGameAdapter } from './templates/multi-game/MultiGameAdapter';
import { noopCardTransitions } from './templates/multi-game/CardSet';
import { FixturesTemplate } from './templates/fixtures/FixturesTemplate';
import { makeFixturesAdapter } from './templates/fixtures/FixturesAdapter';
import { RecapTemplate } from './templates/recap/RecapTemplate';
import { makeRecapAdapter } from './templates/recap/RecapAdapter';
import { MultiGameWithAdsTemplate } from './templates/with-ads/MultiGameWithAdsTemplate';
import { FixturesWithAdsTemplate } from './templates/with-ads/FixturesWithAdsTemplate';
import {
  makeMultiGameWithAdsAdapter,
  makeFixturesWithAdsAdapter,
  type AdSlotResolver,
} from './templates/with-ads/WithAdsAdapter';
import type { AdSlotPayload } from './render/types';

import { JournalStore } from './observability/JournalStore';
import { JournalSyncClient } from './observability/JournalSyncClient';
import { Observer } from './observability/index';
import { ImpressionEmitter } from './observability/ImpressionEmitter';
import { ConfigPushHandler } from './config/ConfigPushHandler';
import { LocalStoragePreferenceStore, type PreferenceDerivedCache } from './config/PreferenceStore';
import { PendingApplySlot } from './config/ApplyPreferenceState';
import type { ConfigJournal, ConfigPushJournalEvent } from './config/Journal';
import type { ConfigPushFrame } from './config/types';
import type { ThemeChoiceWire } from './wire';

// --- xiboIC interaction contract (player-injected global) --------------------

/** The single-display info the xibo-player returns from `xiboIC.info()`. */
export interface XiboDisplayInfo {
  hardwareKey?: string;
  displayName?: string;
  displayId?: number | string;
  [field: string]: unknown;
}

/** The callback-style `xiboIC.info({ done, error })` surface we depend on. */
interface XiboInteractiveControl {
  info(cb: { done: (xhr: { responseText: string }) => void; error: () => void }): void;
}

declare const xiboIC: XiboInteractiveControl | undefined;

/**
 * Promisify the player's `xiboIC.info()` callback contract. Resolves with the
 * parsed display info, or null when xiboIC is absent (CMS preview / headless),
 * unparseable, errored, or slow (5 s safety — never hang the boot).
 */
export function resolveXiboInfo(timeoutMs = 5000): Promise<XiboDisplayInfo | null> {
  return new Promise((resolve) => {
    if (typeof xiboIC === 'undefined' || typeof xiboIC.info !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (info: XiboDisplayInfo | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      resolve(info);
    };
    const safety = setTimeout(() => finish(null), timeoutMs);
    try {
      xiboIC.info({
        done: (xhr) => {
          let info: XiboDisplayInfo | null = null;
          try {
            info = JSON.parse(xhr.responseText) as XiboDisplayInfo;
          } catch {
            info = null;
          }
          finish(info);
        },
        error: () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

// --- WS URL resolution -------------------------------------------------------

/**
 * Resolve the `crowdaq.v1` WS URL from the `wsBaseUrl` widget property and the
 * display info. Supports the v1 widget's `display:<field>` targeting convention
 * so one layout can serve many bars: a value `display:displayName` resolves the
 * `displayName` field from `xiboIC.info()`. A bare base URL has `/ws` appended;
 * an `http(s)://` base is rewritten to `ws(s)://`. Returns null when no base can
 * be resolved (the widget renders the configure placeholder instead of dialing).
 */
export function resolveWsUrl(wsBaseUrlRaw: string, info: XiboDisplayInfo | null): string | null {
  let base = (wsBaseUrlRaw || '').trim();

  if (base.startsWith('display:')) {
    const field = base.slice('display:'.length);
    const value = info != null ? info[field] : undefined;
    if (typeof value !== 'string' || value.length === 0) return null;
    base = value.trim();
  }

  if (base.length === 0) return null;

  // Normalise scheme: http(s) -> ws(s); leave an explicit ws(s) base as-is.
  if (base.startsWith('https://')) base = 'wss://' + base.slice('https://'.length);
  else if (base.startsWith('http://')) base = 'ws://' + base.slice('http://'.length);

  // Append the /ws path unless the base already targets it.
  const trimmed = base.replace(/\/+$/, '');
  return /\/ws$/.test(trimmed) ? trimmed : trimmed + '/ws';
}

// --- production-grade system-boundary adapters -------------------------------

/**
 * Real transition player: applies the resolved animation to the host and
 * resolves on the next frame. The no-flash constraint (D-GRH-31) is met by
 * never hiding the host — duration-0 / default-fade transitions paint in place.
 * Web Animations playback is exercised end-to-end by SPEC-CRWDQ-027; here it is
 * a deterministic instant apply so a slow animation can never wedge activation.
 */
export class InstantTransitionPlayer implements TransitionPlayer {
  async play(_definition: TransitionDefinition, _host: HTMLElement, _durationMs: number): Promise<void> {
    // Resolve on a microtask so the activator's async chain ordering holds.
    await Promise.resolve();
  }
}

/**
 * In-memory asset cache. Single_game renders without delivered assets (its DOM
 * is synthesized), so cross-restart persistence is not on the S5 critical path;
 * IndexedDB-backed persistence is SPEC-CRWDQ-064 production hardening. This
 * adapter satisfies the full {@link AssetCache} contract in-process.
 */
export class InMemoryAssetCache implements AssetCache {
  private readonly rows = new Map<string, { asset: CachedAsset; lastAccessAt: Date }>();
  private key(assetId: string, contentHash: string): string {
    return `${assetId} ${contentHash}`;
  }
  async read(assetId: string, contentHash: string): Promise<CachedAsset | null> {
    const row = this.rows.get(this.key(assetId, contentHash));
    if (!row) return null;
    row.lastAccessAt = new Date();
    return row.asset;
  }
  async write(asset: CachedAsset): Promise<void> {
    this.rows.set(this.key(asset.asset_id, asset.content_hash), { asset, lastAccessAt: new Date() });
  }
  async delete(assetId: string, contentHash: string): Promise<void> {
    this.rows.delete(this.key(assetId, contentHash));
  }
  async enumerate(): Promise<readonly AssetCacheRow[]> {
    return Array.from(this.rows.values(), ({ asset, lastAccessAt }) => ({
      asset_id: asset.asset_id,
      content_hash: asset.content_hash,
      sizeBytes: asset.bytes.byteLength,
      lastAccessAt,
    }));
  }
  /** Preference-derived cache eviction (SPEC-014 ConfigPush replace path). */
  async evictAll(): Promise<string[]> {
    const ids = Array.from(this.rows.values(), (r) => r.asset.asset_id);
    this.rows.clear();
    return ids;
  }
}

/**
 * Envelope-flattening deserializer (the live↔twin wire-shape adapter).
 *
 * The live game-delivery server nests per-type data under `payload`
 * (`{ schema_version, channel, message_type, ts, payload, bar_id?, game_id?,
 * seq? }`), but the implemented widget handlers — PlannedStateActivator,
 * ProgramSlotResolver, the GameStateStore game-data handlers — read their fields
 * at the TOP level (matching the SPEC-CRWDQ-017 twin + the on-branch fixtures).
 * AssetManifestStore is the exception: it reads `frame.payload.{version,assets}`.
 *
 * This wrapper hoists `payload` keys to the top level on every parsed frame
 * WITHOUT discarding `payload` (so AssetManifest still resolves), and lifts the
 * envelope `seq` / `game_id` / `bar_id` so the seq-bearing game-data handlers
 * see them. Top-level keys already present win over `payload` (a twin-shaped
 * frame is passed through unchanged). This is the one place the live envelope is
 * reconciled to the twin — the integration boundary, not a fork of every module.
 */
export class EnvelopeFlatteningDeserializer implements Deserializer {
  constructor(private readonly inner: Deserializer = new WireDeserializer()) {}
  parse(line: string): ParseResult {
    const result = this.inner.parse(line);
    if (!isFrame(result)) return result;
    const frame = result as Record<string, unknown>;
    const payload = frame['payload'];
    if (payload == null || typeof payload !== 'object') return result;
    // Hoist payload keys to top level without clobbering an existing top-level
    // key and without dropping `payload` (AssetManifest / OverrideInjection /
    // MessagingLane / FixtureList read frame.payload).
    const flattened: Record<string, unknown> = { ...(payload as Record<string, unknown>), ...frame };
    // S87 — drop the envelope-only `channel` wrapper key. It is the transport
    // routing tag, never an inner message field, so leaving it on the flattened
    // frame made the closed-shape ConfigPush validator reject every live frame
    // as `schema_invalid` (~8/sec). No handler reads a top-level `channel`.
    // `payload` is intentionally KEPT (the four stores above still read it).
    delete flattened['channel'];
    return flattened as unknown as ServerFrame;
  }
}

/** True when a ParseResult is an actual frame (not an empty/parse-error marker). */
function isFrame(r: ParseResult): r is ServerFrame {
  return typeof (r as { message_type?: unknown }).message_type === 'string';
}

/**
 * HTTP `fetch` asset fetcher (D-GRH-74 publicly-readable URLs).
 *
 * CSP / cross-origin note (SPEC-CRWDQ-S11, learned LIVE on the Xibo player):
 * the asset bytes live on a DIFFERENT origin than the widget (the game-delivery
 * tailnet host vs the player's `http://localhost:9696` web root). The Xibo
 * player (Electron) enforces a Content-Security-Policy whose `img-src` refuses
 * BOTH a cross-origin remote `<img src>` AND a `blob:` object URL — but it
 * ALLOWS `data:` URIs (the player's own UI uses inline `data:` SVGs). So the
 * CachedAsset `url` is a `data:<type>;base64,...` URI built from the
 * already-fetched + hash-verified bytes; every `<img src>` consumer then loads
 * inline, CSP-safe. The cross-origin FETCH itself is governed by `connect-src`
 * + CORS, which we satisfy with `Access-Control-Allow-Origin: *` on the server.
 */
export class HttpAssetFetcher implements AssetFetcher {
  async fetch(entry: AssetEntry): Promise<CachedAsset> {
    const res = await fetch(entry.url);
    if (!res.ok) {
      throw new Error(`asset fetch ${entry.asset_id}: HTTP ${res.status}`);
    }
    const bytes = await res.arrayBuffer();
    const type =
      entry.content_type || res.headers.get('content-type') || 'application/octet-stream';
    return {
      asset_id: entry.asset_id,
      content_hash: entry.content_hash,
      url: toDataUri(bytes, type),
      content_type: entry.content_type,
      bytes,
    };
  }
}

/** Encode bytes as a `data:<type>;base64,...` URI (CSP-safe `img-src`). */
function toDataUri(bytes: ArrayBuffer, contentType: string): string {
  const u8 = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(u8).toString('base64'); // non-browser (tests)
  return `data:${contentType};base64,${b64}`;
}

/**
 * A console-backed journal sink covering all four journal surfaces (transport,
 * render, config, manifest). Every journal event is a single structured line
 * tagged `component: 'widget-v2'` so the operator trail
 * (`kubectl logs ... | grep widget-v2`) works exactly like the v1 widget's
 * `POST /log`. SPEC-CRWDQ-061's JournalSyncClient additionally batches to the WS
 * channel; this sink is the always-on local breadcrumb.
 */
export class ConsoleJournalSink
  implements JournalSink, RenderJournal, ConfigJournal, ManifestJournal
{
  constructor(
    private readonly sink: (line: Record<string, unknown>) => void = (l) => console.log(JSON.stringify(l)),
  ) {}
  record(
    entry: RenderJournalEntry | ConfigPushJournalEvent | ManifestJournalEntry | Record<string, unknown>,
  ): void {
    this.sink({ component: 'widget-v2', ...entry });
  }
}

/**
 * StyleSheetRegistry over the real document head: a swapped theme injects (or
 * replaces) a single `<link data-crowdaq-theme>` element; a null theme removes
 * it. The link href convention (`theme-<id>.css`) matches the asset-delivered
 * theme stylesheet naming; absent that file the host simply renders unthemed.
 */
export class DocumentStyleSheetRegistry implements StyleSheetRegistry {
  constructor(private readonly doc: Document = document) {}
  applyTheme(themeId: string | null): void {
    const existing = this.doc.querySelector('link[data-crowdaq-theme]');
    if (themeId === null) {
      existing?.remove();
      return;
    }
    const link = (existing as HTMLLinkElement | null) ?? this.doc.createElement('link');
    link.setAttribute('data-crowdaq-theme', '');
    link.rel = 'stylesheet';
    link.href = `theme-${themeId}.css`;
    if (existing === null) this.doc.head.appendChild(link);
  }
}

/**
 * Bar-wide theme source over the ConfigPush pending-apply path. The activator
 * reads `currentBarTheme()` to resolve a PlannedState's theme fall-through; the
 * applied bar theme is updated whenever a ConfigPush is accepted. A narrow seam
 * (INV-FACTORY-19) — it never reaches into ConfigPushHandler internals.
 */
export class AppliedBarTheme implements BarThemeSource {
  private theme: ThemeChoiceWire | null = null;
  set(theme: ThemeChoiceWire): void {
    this.theme = theme;
  }
  currentBarTheme(): ThemeChoiceWire | null {
    return this.theme;
  }
}

// --- the composition root ----------------------------------------------------

/** Tunable, injectable dependencies for {@link boot} (all defaulted to browser). */
export interface BootDeps {
  /** Document to mount into + read xiboIC info from. Defaults to global. */
  document?: Document;
  /** WebSocket constructor seam (mock crowdaq.v1 server in the e2e). */
  webSocketFactory?: WebSocketFactory;
  /** Player clock. Defaults to `Date.now` + global timers. */
  dwellClock?: DwellClock;
  /** Monotonic ms clock for the WS heartbeat/backoff. Defaults to `Date.now`. */
  now?: () => number;
  /** Jitter RNG in [0,1). Defaults to `Math.random`. */
  random?: () => number;
  /** LocalStorage seam. Defaults to `window.localStorage`. */
  storage?: Storage;
  /** Structured-journal line sink. Defaults to `console.log(JSON.stringify)`. */
  journalSink?: (line: Record<string, unknown>) => void;
  /** Pre-resolved display info (skips the `xiboIC.info()` round-trip in tests). */
  displayInfo?: XiboDisplayInfo | null;
  /** Asset cache seam. Defaults to an in-memory cache. */
  assetCache?: AssetCache & PreferenceDerivedCache;
  /** Asset fetcher seam. Defaults to an HTTP `fetch` fetcher. */
  assetFetcher?: AssetFetcher;
  /**
   * Cross-iframe single-session lock (S22). Defaults to a Web Locks API lock
   * (or the leader-election fallback) keyed by bar so exactly ONE of Xibo's
   * double-buffer iframes holds the WS at a time. Inject an
   * {@link ImmediateSessionLock} in a single-instance test/harness, or a fake to
   * drive the two-iframe takeover scenario deterministically.
   */
  sessionLock?: SessionLock;
}

/** Widget properties the CMS injects (the `<onRender>` `properties` object). */
export interface BootProperties {
  /** `crowdaq.v1` WS base URL, an http(s)/ws(s) base, or `display:<field>`. */
  wsBaseUrl?: string;
  /**
   * Explicit bar identifier override. When set, this is the `bar_id` used in the
   * DeviceRegistration handshake, taking precedence over the player-reported
   * `xiboIC.info().hardwareKey`. Required on players whose `xiboIC.info()` is
   * unavailable (the Xibo 4.0.x Linux player 404s `/info`); on players that do
   * report a hardwareKey, leave blank to bind by hardwareKey.
   */
  barId?: string;
  /** Explicit display identifier override (parallels {@link barId}). */
  displayId?: string;
  /** Optional player software version surfaced in the registration handshake. */
  playerVersion?: string;
  /** Heartbeat cadence (default 30 000 ms per D-GRH-59). */
  heartbeatIntervalMs?: number;
  [prop: string]: unknown;
}

/** The handle a host returns from {@link boot} for teardown. */
export interface WidgetRuntime {
  /** The mounted host element (carries `data-testid="crowdaq-widget-v2"`). */
  host: HTMLElement;
  /** The resolved WS URL, or null when no base was configured. */
  wsUrl: string | null;
  /** Tear the runtime down: close the WS, stop heartbeat, detach the host. */
  destroy(): Promise<void>;
  /** The live WsClient (null when no WS URL resolved — placeholder mode). */
  client: CrowdaqWsClient | null;
}

/** Stable test id for the mounted host (parallels the template TESTID set). */
export const HOST_TESTID = 'crowdaq-widget-v2';

/**
 * SPEC-CRWDQ-S58 — deployed build marker. Stamped on the `widget_boot` journal
 * line so the operator can confirm (via the player console / `kubectl logs`)
 * that a given player picked up THIS build (the never-blank fix) and not a stale
 * cached bundle. Bump on each deployed widget build.
 */
export const BUILD_MARKER = 'build:s102-fixtures-crests';

/** Default heartbeat cadence (D-GRH-59 / SPEC-CRWDQ-022). */
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;
/**
 * SPEC-CRWDQ-S41 inbound-frame liveness watchdog (ms). A healthy link delivers
 * at least a HeartbeatAck every heartbeat interval (30 s); silence well past one
 * interval means the socket is dead-but-open (the half-open proxy/pod-roll case
 * that left the bar stuck on stale safe_info with no manual recovery). Set to
 * ~2.3× the heartbeat interval so a single missed ack window does not flap the
 * connection, while a genuinely dead socket is detected and reconnected in ~70 s
 * — far faster than waiting for the OS TCP timeout that may never arrive.
 */
const DEFAULT_LIVENESS_TIMEOUT_MS = 70_000;

/**
 * Boot the Widget v2 single_game runtime into `target`. Resolves once the host
 * is mounted and (when a WS URL resolves) the WS connect has been initiated.
 */
export async function boot(
  target: HTMLElement,
  properties: BootProperties = {},
  deps: BootDeps = {},
): Promise<WidgetRuntime> {
  const doc = deps.document ?? document;

  // 1. mount the host the template family renders into. The host carries the
  // broadcast backdrop class (`crowdaq-widget-v2-host`: the stadium-dark
  // gradient base + flex centring) and the shared atmospheric depth layers
  // (mesh / grain / vignette) once at the host level, so EVERY mode sits on the
  // same depth backdrop. The S9 single_game/safe_info/ambient templates inject
  // their own layers inside their z-index:1 root; the new game/fixture/recap/
  // with-ads modes rely on this host-level backdrop (one source of depth).
  const host = doc.createElement('div');
  host.className = 'crowdaq-widget-v2 crowdaq-widget-v2-host';
  host.dataset['testid'] = HOST_TESTID;
  for (const cls of ['cdq-bg-mesh', 'cdq-bg-grain', 'cdq-bg-vignette']) {
    const layer = doc.createElement('div');
    layer.className = cls;
    host.appendChild(layer);
  }
  target.appendChild(host);

  // 2. resolve display identity + the WS URL.
  const info = deps.displayInfo !== undefined ? deps.displayInfo : await resolveXiboInfo();
  const wsUrl = resolveWsUrl(properties.wsBaseUrl ?? '', info);
  // bar_id binding: an explicit `barId` property wins (required where
  // xiboIC.info() is unavailable), else the player-reported hardwareKey.
  const barIdProp = typeof properties.barId === 'string' ? properties.barId.trim() : '';
  const displayIdProp = typeof properties.displayId === 'string' ? properties.displayId.trim() : '';
  const barId = (barIdProp.length > 0 ? barIdProp : readField(info, 'hardwareKey')) ?? 'unknown-bar';
  const displayId = (displayIdProp.length > 0
    ? displayIdProp
    : readField(info, 'displayName') ?? readField(info, 'displayId')) ?? 'unknown-display';

  const journal = new ConsoleJournalSink(deps.journalSink);

  // SPEC-CRWDQ-S105 — durable journal store + emit adapter for the ad-impression
  // loop. An `ad_slot_rendered` render event becomes a journal row that drains
  // to the backend over the SPEC-CRWDQ-061 JournalSync WS path (the
  // JournalSyncClient is bound onto the WS client at step 5). The store's
  // IndexedDB open is best-effort: a headless/preview environment without
  // IndexedDB keeps the console breadcrumb and simply records no durable
  // impression rows (the loop is a live-bar concern). `impressionJournal`
  // decorates the console sink so AdPanel renders both log AND meter.
  const journalStore = new JournalStore({ barId, displayId });
  let journalSyncClient: JournalSyncClient | null = null;
  const observer = new Observer(journalStore, () => new Date().toISOString(), {
    onAppended: () => journalSyncClient?.onAppended(),
  });
  void journalStore.ready().catch((err) => {
    journal.record({
      event: 'journal_store_unavailable',
      error: err instanceof Error ? err.message : String(err),
    });
  });
  const impressionJournal = new ImpressionEmitter({ inner: journal, observer });

  if (wsUrl === null) {
    // No WS base configured — render the configure placeholder, do not dial.
    renderConfigurePlaceholder(host, doc);
    journal.record({ event: 'widget_boot_no_ws_url', wsBaseUrl: properties.wsBaseUrl ?? '' });
    return { host, wsUrl: null, client: null, destroy: async () => void host.remove() };
  }

  // 3. build the render pipeline (the real modules, exactly as the e2e harness).
  const slots = new ProgramSlotResolver();
  const gameStateStore = new GameStateStore(journal);
  const assetCache = deps.assetCache ?? new InMemoryAssetCache();
  const assets = new AssetManifestStore({
    cache: assetCache,
    fetcher: deps.assetFetcher ?? new HttpAssetFetcher(),
    journal,
  });
  // SPEC-CRWDQ-S11 — resolve real club crests from the AssetManifest by team
  // (kind=crest, ref=team name_key). Shared by single_game + multiple_games so
  // the scoreboard renders the real badge image, falling back to the existing
  // colour block when a team's crest isn't published/warmed (never a fake).
  const crestResolver = new CrestResolver(assets);
  const transitions = new TransitionExecutor({
    // Pre-baked catalog: the two transitions the activator names directly
    // (incoming default + supersede). Misses fall through to the default fade.
    catalog: new Map<string, unknown>([
      ['fade_scale_up', { opacity: [0, 1] }],
      ['fade_scale_down', { opacity: [1, 0] }],
    ]),
    assets,
    player: new InstantTransitionPlayer(),
    journal,
  });

  const barTheme = new AppliedBarTheme();
  // Latest applied bar preferences (D-GRH-73) for the safe/ambient venue brand.
  // Captured whenever a ConfigPush carries preferences; null on a cold boot.
  let lastPrefs: SafeBarPreferences | null = null;
  const pendingApply = new PendingApplySlot();
  const preferenceStore = new LocalStoragePreferenceStore(
    deps.storage ?? window.localStorage,
    assetCache,
  );
  const configHandler = new ConfigPushHandler(preferenceStore, pendingApply, journal);

  // SEED lastPrefs from the PERSISTED snapshot at boot (D-GRH-73). On a
  // RECONNECT the delivery re-sends a ConfigPush whose hash MATCHES the already
  // persisted snapshot, so the handler returns `unchanged` and never sets
  // lastPrefs — leaving the fixtures timezone thunk to fall back to 'UTC' even
  // though the bar's real zone is sitting in localStorage from the first push.
  // Seeding here makes the bar's zone available BEFORE the first frame is
  // dispatched, so a fixtures board mounted off a hash-matched reconnect renders
  // in the bar's local timezone (labeled) instead of the UTC fallback.
  try {
    const persisted = await preferenceStore.load();
    if (persisted) {
      lastPrefs = { ...persisted.payload.preferences, bar_id: barId } as SafeBarPreferences;
    }
  } catch {
    // A storage read fault is non-fatal: lastPrefs stays null and the first
    // wire ConfigPush will populate it (the pre-fix behaviour).
  }

  const activator = new PlannedStateActivator({
    host,
    slots,
    gameStateStore,
    transitions,
    dwell: new DwellTimer(deps.dwellClock ?? systemDwellClock),
    template: new SingleGameTemplateAdapter(),
    journal,
    styleSheets: new DocumentStyleSheetRegistry(doc),
    barTheme,
    pendingApply: pendingApply as PendingThemeApply,
    clock: deps.dwellClock ?? systemDwellClock,
    // Late-bound: forwards each activation to the SafeStateController (built
    // just below) so its no_recent_state / data_stale probes track the mode.
    onActivated: (mode) => safeController.notePlannedState(mode),
    // SPEC-CRWDQ-S58 NEVER-BLANK (D-SAFE-01): an unsatisfiable/invalid content
    // PlannedState (e.g. multiple_games_with_ads with a missing ad_slot) or a
    // template that throws while mounting escalates to the calm safe_info panel
    // instead of leaving the bar blank. Late-bound onto the SafeStateController
    // built just below; routes through the SAME activator (Path C).
    escalateToSafe: (reason) => safeController.escalateFromTemplate(reason),
    // SPEC-CRWDQ-S11 — real club crests for the built-in single_game score-bug.
    crestResolver,
  });

  // 3b. Register the non-game-data standing-display modes so the bar shows
  // something 24/7 (SPEC-CRWDQ-052 safe_info + SPEC-CRWDQ-053 ambient). Both
  // activate through the SAME PlannedStateActivator orchestration as single_game
  // (buffer/transition/dwell/supersede) — never a forked render path.
  const clock = deps.dwellClock ?? systemDwellClock;
  let lastThemeId: string | null = null;

  // Deferred WS-lifecycle binder: the SafeStateController subscribes to
  // open/close/reconnect at construction, but the CrowdaqWsClient is built at
  // step 5. This buffers subscriptions and replays them onto the client once it
  // exists (INV-FACTORY-19 narrow seam — only the three connectivity events).
  const wsLifecycle = new DeferredWsLifecycle();

  // SPEC-CRWDQ-S49 — late-bound resync seam. The SafeStateController is built
  // before the CrowdaqWsClient (step 5), so the controller's active-resync
  // trigger is a closure over a mutable client ref filled in once the client
  // exists. While the controller is held in a player-side fallback it calls this
  // to recycle the WS (the proven self-heal: reconnect→re-register→re-push), so
  // the bar recovers on its own instead of waiting for a spontaneous re-push.
  let wsClientRef: CrowdaqWsClient | null = null;

  // safe_info (default standing state). The controller also synthesizes safe_info
  // on the D-SAFE-01 player-side thresholds (control-channel loss / stale data /
  // no-state), routing through the normal activator.
  const safeController = new SafeStateController({
    activator,
    gameStateStore,
    ws: wsLifecycle,
    clock,
    slots,
    barPreferences: () => lastPrefs,
    assetManifestStore: assets,
    lastThemeId: () => lastThemeId,
    // SPEC-CRWDQ-S49 — drive an active resync while stuck in a player fallback.
    requestResync: () => wsClientRef?.forceResync(),
  });
  activator.registerTemplate(
    'safe_info',
    makeSafeAdapter({ template: new SafeInfoTemplate(), controller: safeController }),
  );

  // ambient (gap-filling branded content from the AssetManifest, D-GRH-26/27).
  // Degrades to the safe_info panel when the manifest carries no ambient assets.
  activator.registerTemplate(
    'ambient',
    makeAmbientAdapter({
      template: new AmbientTemplate(),
      safeInfoTemplate: new SafeInfoTemplate(),
      assetManifestStore: assets,
      journal,
      makePlaylist: () => new AmbientPlaylist({ assetManifestStore: assets, journal }),
      makeDwell: () => new DwellTimer(clock),
      barPreferences: () => lastPrefs,
    }),
  );

  // 3c. The remaining game/fixture/recap render modes (S9-modes assembly).
  // Each registers through the SAME activator orchestration as single_game —
  // buffer/transition/dwell/supersede/reconcile — never a forked path.
  //
  // FixtureListStore: the player-side cache of the most recent FixtureList
  // (D-GRH-18) the fixtures + recap templates read team/kickoff detail from.
  // NOTE (backend gap): the GameDeliveryService re-push (builder.ts) does NOT
  // yet emit a FixtureList frame, so on the live backend this store stays empty
  // and the fixtures template declines to mount (`template_input_invalid`).
  const fixtureListStore = new FixtureListStore();

  // AdSlotResolver: a last-write-wins cache of delivered AdSlot frames, keyed by
  // ad_slot_id. The backend re-push emits no AdSlot frame yet (S5 recon:
  // `ad_slot_payload_unavailable` — verified still open), so on the LIVE backend
  // this map stays empty, `resolve` returns null, and the with-ads composites
  // DECLINE the mount (`template_input_invalid` / `missing_ad_slot`) — the panel
  // is never fabricated. The map is the seam a future backend AdSlot delivery
  // (SPEC-CRWDQ-080/-081) plugs into with zero further wiring.
  const adSlotCache = new Map<string, AdSlotPayload>();
  const adSlots: AdSlotResolver = { resolve: (id) => adSlotCache.get(id) ?? null };
  // Bar-local IANA timezone for fixtures kickoff formatting (D-GRH-73); falls
  // back to UTC until a ConfigPush carries a timezone preference. Passed to the
  // fixtures adapters as a THUNK (evaluated at mount, after the first ConfigPush
  // populated lastPrefs) so the cold-boot 'UTC' fallback is never frozen into a
  // render.
  const fixturesTimezone = (): string => lastPrefs?.timezone ?? 'UTC';
  // Live bar-timezone broadcast (D-GRH-73): a `replaced` ConfigPush that EDITS
  // the bar's zone reformats the already-mounted fixtures board(s) in place
  // (no remount). Independent of the SPEC-014 pending-apply slot the activator
  // drains for the theme swap, so the two never race over the single slot.
  const fixturesTimezoneBroadcast = new FixturesTimezoneBroadcast();

  // multiple_games — 2×4 score-bug grid (SPEC-CRWDQ-031).
  activator.registerTemplate(
    'multiple_games',
    makeMultiGameAdapter({
      template: new MultiGameTemplate(),
      journal,
      cardTransitions: noopCardTransitions,
      crestResolver,
    }),
  );

  // fixtures — upcoming-fixture catalog (SPEC-CRWDQ-033/-034).
  activator.registerTemplate(
    'fixtures',
    makeFixturesAdapter({
      template: new FixturesTemplate(),
      journal,
      cardTransitions: noopCardTransitions,
      fixtureListStore,
      assetManifestStore: assets,
      crestResolver,
      timezone: fixturesTimezone,
      timezoneBroadcast: fixturesTimezoneBroadcast,
    }),
  );

  // fixtures_with_live_game — the dedicated split-layout template (SPEC-CRWDQ-066:
  // a fixtures catalog beside one live single_game) is NOT YET IMPLEMENTED in any
  // branch, AND the scheduler's mode-select never authors this mode today. We
  // register it to the fixtures adapter as a graceful degrade so a future
  // scheduler emission renders the catalog (its fixture_ids) rather than nothing,
  // and FLAG the missing SPEC-CRWDQ-066 template + scheduler emission as gaps.
  activator.registerTemplate(
    'fixtures_with_live_game',
    makeFixturesAdapter({
      template: new FixturesTemplate(),
      journal,
      cardTransitions: noopCardTransitions,
      fixtureListStore,
      assetManifestStore: assets,
      crestResolver,
      timezone: fixturesTimezone,
      timezoneBroadcast: fixturesTimezoneBroadcast,
    }),
  );

  // recap — post-game frozen closing image (SPEC-CRWDQ-046).
  activator.registerTemplate(
    'recap',
    makeRecapAdapter({
      template: new RecapTemplate(),
      journal,
      fixtureListStore,
      assetManifestStore: assets,
    }),
  );

  // multiple_games_with_ads — grid + ad panel (SPEC-CRWDQ-041/-055).
  activator.registerTemplate(
    'multiple_games_with_ads',
    makeMultiGameWithAdsAdapter({
      template: new MultiGameWithAdsTemplate(new MultiGameTemplate()),
      // SPEC-CRWDQ-S105 — the with-ads composites mount the AdPanel, whose
      // `ad_slot_rendered` must be metered. The ImpressionEmitter forwards every
      // event to the console sink AND emits the impression journal row.
      journal: impressionJournal,
      cardTransitions: noopCardTransitions,
      assetManifestStore: assets,
      adSlots,
      crestResolver,
    }),
  );

  // fixtures_with_ads — catalog + ad panel (SPEC-CRWDQ-041/-055).
  activator.registerTemplate(
    'fixtures_with_ads',
    makeFixturesWithAdsAdapter({
      template: new FixturesWithAdsTemplate(new FixturesTemplate()),
      // SPEC-CRWDQ-S105 — meter AdPanel renders (see multiple_games_with_ads).
      journal: impressionJournal,
      cardTransitions: noopCardTransitions,
      assetManifestStore: assets,
      adSlots,
      fixtureListStore,
      transitionExecutor: transitions,
      crestResolver,
      timezone: fixturesTimezone,
      timezoneBroadcast: fixturesTimezoneBroadcast,
    }),
  );

  // 4. dispatcher + every server-frame handler.
  // The active-game gate is the activator's currently-rendered slot: only the
  // primary game of the active ProgramSlot is "active" for seq-gap tracking.
  const activeGames: ActiveGames = {
    isActive: (gameId) => activatorActiveGameId(slots, activator) === gameId,
  };
  const requester: GameStateRequester = makeGameStateRequester();
  const dispatcher: Dispatcher = new FrameDispatcher(requester, activeGames);

  activator.registerWith(dispatcher); // PlannedState + ProgramSlot
  assets.registerWith(dispatcher); // AssetManifest

  // ConfigPush: accept, persist, and update the bar-wide applied theme so the
  // activator's theme fall-through resolves against it (AC8). The SPEC-014
  // validator is closed-shape (no extra keys), so the live envelope's `channel`
  // / `payload` wrappers must be stripped — `toConfigPushFrame` reconstructs the
  // exact validatable subset from either the live (payload-nested) or twin
  // (top-level) shape.
  dispatcher.register(
    'ConfigPush',
    (frame) => {
      void configHandler
        .handle(toConfigPushFrame(frame as Record<string, unknown>) as ConfigPushFrame)
        .then((outcome) => {
          // Capture the applied preferences on BOTH the first push AND a later
          // EDIT (`replaced`). A tz EDIT must update lastPrefs so the fixtures
          // thunk reads the new zone on the next mount; without this branch a
          // `replaced` push silently never took effect (the original bug).
          if (outcome.kind === 'first_push' || outcome.kind === 'replaced') {
            const prefs = outcome.preferences;
            const priorTimezone = lastPrefs?.timezone ?? null;
            barTheme.set(prefs.theme);
            // Capture the applied preferences (+ bar_id) for the safe/ambient
            // venue-brand chain, and the resolved theme id for synthetic safe.
            lastPrefs = { ...prefs, bar_id: barId } as SafeBarPreferences;
            lastThemeId = prefs.theme.state === 'set' ? prefs.theme.id : null;
            // GUARANTEED tz handling (D-GRH-73): when the bar's zone CHANGED,
            // reformat the already-mounted fixtures board(s) in place so the
            // edit visibly takes effect without waiting for a remount.
            if (prefs.timezone !== priorTimezone) {
              fixturesTimezoneBroadcast.broadcast(prefs.timezone);
            }
          }
        });
    },
    'control',
  );

  // Game-data frames: snapshot replaces + re-baselines, event applies a delta.
  // These are the frames the single_game template's GameStateStore subscription
  // re-renders on (score/overlay mutate in place, no transition).
  dispatcher.register(
    'GameStateSnapshot',
    (frame) => gameStateStore.upsertSnapshot(toGameSnapshot(frame as GameStateSnapshotFrame)),
    'game_data',
  );
  dispatcher.register(
    'GameState',
    (frame) => gameStateStore.upsertSnapshot(toGameSnapshot(frame as GameStateFrame)),
    'game_data',
  );
  dispatcher.register(
    'GameEvent',
    (frame) => gameStateStore.applyEvent(toGameEvent(frame as GameEventFrame)),
    'game_data',
  );

  // FixtureList (D-GRH-18): the fixtures + recap modes read team/kickoff detail
  // from this cache. A new list REPLACES the cached set. The store consumes the
  // camelCase player twin (`eventId`/`homeTeam`/`kickoffUtc`/`feedStatus`); the
  // live backend `FixtureListPayload` is snake_case (`fixture_id`/`home_team`/
  // `kickoff_ts`) — so `toFixtureListFrame` maps either shape to the twin. This
  // is the one place the wire↔twin fixture shape is reconciled (the integration
  // boundary, mirroring EnvelopeFlatteningDeserializer for game frames).
  // BACKEND GAP: the re-push builder emits no FixtureList frame today, so this
  // handler never fires on the live backend (the headless mock drives it).
  dispatcher.register(
    'FixtureList',
    (frame) => fixtureListStore.applyList(toFixtureListFrame(frame as Record<string, unknown>)),
    'control',
  );

  // AdSlot (D-GRH-15): cache the delivered slot so the with-ads composites can
  // resolve it at mount. BACKEND GAP: the re-push builder emits no AdSlot frame
  // today, so on the live backend this handler never fires (the headless mock
  // drives it). The creative bytes resolve from the AssetManifest by `ad_ref`.
  dispatcher.register(
    'AdSlot',
    (frame) => {
      const slot = toAdSlot(frame as Record<string, unknown>);
      if (slot !== null) adSlotCache.set(slot.ad_slot_id, slot);
    },
    'control',
  );

  // 5. the WS client: crowdaq.v1 subprotocol, D-GRH-61 handshake, heartbeat.
  const config: WsClientConfig = {
    url: wsUrl,
    barId,
    displayId,
    playerVersion: properties.playerVersion ?? 'widget-v2',
    heartbeatIntervalMs: properties.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
    ackTimeoutMs: DEFAULT_ACK_TIMEOUT_MS,
    // SPEC-CRWDQ-S41: cap reconnect backoff at 15 s (was 30 s) so a bar self-
    // heals promptly after the backend returns; retry is INDEFINITE (the
    // WsClient never stops scheduling reconnects until a clean close()).
    reconnect: { initialDelayMs: 1000, maxDelayMs: 15_000, jitter: 'full' },
    // SPEC-CRWDQ-S41: detect a silently dead (half-open) socket — the proxy/pod-
    // roll case — and force a reconnect even when the browser delivers no
    // error/close. Re-resolve the WS URL on every (re)connect so a reconnect
    // rejoins the current endpoint after the tailnet proxy moves.
    livenessTimeoutMs: DEFAULT_LIVENESS_TIMEOUT_MS,
    resolveUrl: () => resolveWsUrl(properties.wsBaseUrl ?? '', info),
  };
  const client = new CrowdaqWsClient(config, {
    webSocketFactory: deps.webSocketFactory ?? browserWebSocketFactory,
    deserializer: new EnvelopeFlatteningDeserializer(),
    dispatcher,
    journal,
    now: deps.now ?? (() => Date.now()),
    random: deps.random ?? (() => Math.random()),
  });

  // SPEC-CRWDQ-S49 — fill the late-bound client ref so the controller's
  // active-resync seam can recycle the WS once the client exists.
  wsClientRef = client;

  // SPEC-CRWDQ-S105 / SPEC-CRWDQ-061 — bind the JournalSyncClient onto the WS
  // client so journaled ad impressions (and other player telemetry) drain to
  // the backend: periodically, on backlog, and on (re)connect. The
  // CrowdaqWsClient satisfies JournalSyncWsClient (isOpen/send/on). This is the
  // transport that carries the impression rows the ImpressionEmitter appended.
  journalSyncClient = new JournalSyncClient({
    store: journalStore,
    ws: client,
    identity: { barId, displayId },
    config: {
      syncIntervalMs: properties.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
      maxBatchSize: 50,
      maxBatchBytes: 256 * 1024,
      retainMaxRows: 10_000,
      retainMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    },
    now: deps.now ?? (() => Date.now()),
    random: deps.random ?? (() => Math.random()),
  });
  journalSyncClient.start();

  // Bind the deferred WS-lifecycle seam to the real client and start the
  // D-SAFE-01 player-fallback controller (now that the WS exists). The
  // controller arms its connectivity/staleness probes; on a threshold it
  // synthesizes a safe_info PlannedState through the normal activator.
  wsLifecycle.bind(client);
  safeController.start();

  // 6. SINGLE-SESSION GATE (S22). Xibo runs TWO same-origin double-buffer
  // iframes of this widget; both boot and both would `connect()` a WS with the
  // same display_id, so the backend's correct one-session-per-display policy
  // (SPEC-CRWDQ-020) evicts the older with `4006 replaced_by_newer` and the two
  // iframes thrash — neither holds long enough to keep its PlannedState, so the
  // bar decays to the player_fallback "Loading…" panel. The fix: only the holder
  // of a per-bar cross-iframe lock connects. The non-holder waits and connects
  // only if/when the holder releases (page hidden/unloaded/crashed). The backend
  // policy is unchanged — this just guarantees a single session at the source.
  const sessionLock =
    deps.sessionLock ??
    createSessionLock(`crowdaq-ws-bar-${barId}`, {
      storage: deps.storage ?? null,
    });

  let lockHandle: SessionLockHandle | null = null;
  let destroyed = false;
  // Acquire the lock, THEN connect. boot() resolves without blocking on the
  // acquire (a waiting iframe must still return a runtime handle); the connect
  // happens in the background once this iframe wins the lock. The holder's own
  // drops still recover via the WsClient's reconnect (it keeps the lock).
  const connectWhenLeader = sessionLock
    .acquire()
    .then((handle) => {
      if (destroyed) {
        handle.release();
        return;
      }
      lockHandle = handle;
      journal.record({ event: 'widget_ws_session_acquired', barId, displayId });
      return client.connect();
    })
    .catch((err) => {
      journal.record({
        event: 'widget_ws_session_lock_error',
        barId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  journal.record({ event: 'widget_boot', build: BUILD_MARKER, wsUrl, barId, displayId });

  return {
    host,
    wsUrl,
    client,
    destroy: async () => {
      destroyed = true;
      safeController.stop();
      // SPEC-CRWDQ-S105 — stop the journal-sync loop + release the store.
      journalSyncClient?.stop();
      journalStore.close();
      await client.close();
      // Release the lock so the OTHER iframe (or a fresh boot) can take over the
      // single session immediately, not after the lease times out. Do NOT await
      // `connectWhenLeader`: if this iframe never won the lock its acquire is
      // still pending, and if it did, `client.connect()` resolves only on the
      // first server frame — neither is a teardown precondition. Swallow any
      // late rejection so an unhandled-rejection never escapes.
      connectWhenLeader.catch(() => {});
      lockHandle?.release();
      lockHandle = null;
      host.remove();
    },
  };
}

/**
 * A deferred WS-lifecycle binder (the {@link SafeStateController}'s `ws` seam).
 * The controller subscribes to open/close/reconnect at construction, before the
 * CrowdaqWsClient is built; this buffers those subscriptions and replays them
 * onto the client the moment {@link bind} is called. A narrow seam — it forwards
 * only the three connectivity events.
 */
class DeferredWsLifecycle {
  private readonly pending: Array<{ event: 'open' | 'close' | 'reconnect'; listener: () => void }> = [];
  private client: CrowdaqWsClient | null = null;
  on(event: 'open' | 'close' | 'reconnect', listener: () => void): void {
    if (this.client !== null) {
      this.client.on(event, listener);
      return;
    }
    this.pending.push({ event, listener });
  }
  bind(client: CrowdaqWsClient): void {
    this.client = client;
    for (const { event, listener } of this.pending) client.on(event, listener);
    this.pending.length = 0;
  }
}

// --- internal wiring helpers -------------------------------------------------

/** Read a string field from the resolved display info, or null. */
function readField(info: XiboDisplayInfo | null, field: string): string | null {
  if (info == null) return null;
  const value = info[field];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Browser `WebSocket` factory with the mandatory crowdaq.v1 subprotocol. */
const browserWebSocketFactory: WebSocketFactory = (url, protocol) =>
  new WebSocket(url, protocol) as unknown as WebSocketLike;

/**
 * Map a GameState/GameStateSnapshot wire frame to the render `GameState` shape.
 * Both wire frames are permissive envelopes; the renderable payload fields are
 * read defensively (absent fields stay undefined, the template renders blanks).
 */
function toGameSnapshot(frame: GameStateFrame | GameStateSnapshotFrame): GameStateSnapshot {
  return readGameFields(frame) as GameStateSnapshot;
}

/** Map a GameEvent wire frame to the render `GameEvent` delta shape. */
function toGameEvent(frame: GameEventFrame): GameEvent {
  return readGameFields(frame) as GameEvent;
}

/**
 * Reconstruct the exact closed-shape ConfigPush frame the SPEC-014 validator
 * accepts, from either the live (payload-nested) or twin (top-level) envelope.
 * The validator demands EXACTLY {message_type, schema_version, ts, bar_id,
 * display_id, config_hash, preferences, cache_ceiling_bytes, intervals} — so the
 * live envelope's `channel` + `payload` wrappers (and the post-flatten duplicate
 * keys) must be dropped. Reads each field from the flattened frame (which carries
 * both top-level and hoisted-payload keys).
 */
function toConfigPushFrame(frame: Record<string, unknown>): Record<string, unknown> {
  const payload = (frame['payload'] as Record<string, unknown> | undefined) ?? {};
  const pick = (key: string): unknown => frame[key] ?? payload[key];
  return {
    message_type: 'ConfigPush',
    schema_version: pick('schema_version') ?? 1,
    ts: pick('ts'),
    bar_id: pick('bar_id'),
    display_id: pick('display_id') ?? null,
    config_hash: pick('config_hash'),
    preferences: pick('preferences'),
    cache_ceiling_bytes: pick('cache_ceiling_bytes'),
    intervals: pick('intervals'),
  };
}

/** Shared field extraction for the game-data frames. */
function readGameFields(frame: Record<string, unknown>): GameState | GameEvent {
  const out: GameState = {
    game_id: String(frame['game_id'] ?? ''),
    seq: typeof frame['seq'] === 'number' ? (frame['seq'] as number) : 0,
  };
  if (typeof frame['home_team'] === 'string') out.home_team = frame['home_team'] as string;
  if (typeof frame['away_team'] === 'string') out.away_team = frame['away_team'] as string;
  if (typeof frame['home_score'] === 'number') out.home_score = frame['home_score'] as number;
  if (typeof frame['away_score'] === 'number') out.away_score = frame['away_score'] as number;
  if (typeof frame['last_moment'] === 'string') out.last_moment = frame['last_moment'] as string;
  const sc = frame['sport_context'];
  if (sc != null && typeof sc === 'object') out.sport_context = sc as SportContext;
  // SPEC-CRWDQ-084 — carry the rich event timeline (additive). The replay /
  // live producer emits the cumulative history on every snapshot frame.
  const tl = frame['timeline'];
  if (Array.isArray(tl)) out.timeline = tl as NonNullable<GameState['timeline']>;
  return out;
}

/**
 * Map a FixtureList wire frame to the camelCase player twin the FixtureListStore
 * consumes. Accepts BOTH shapes per fixture: the twin (`eventId`, `homeTeam`,
 * `leagueName`, `kickoffUtc`, `feedStatus`) and the live backend snake_case
 * (`fixture_id`/`event_id`, `home_team`, `league`, `kickoff_ts`, `status`). The
 * fixtures array is read from `frame.payload.fixtures` or a top-level
 * `fixtures` (post-flatten). Junk entries are dropped by the store's own filter.
 */
function toFixtureListFrame(frame: Record<string, unknown>): FixtureListFrameTyped {
  const payload = (frame['payload'] as Record<string, unknown> | undefined) ?? frame;
  const rawList = Array.isArray(payload['fixtures']) ? (payload['fixtures'] as unknown[]) : [];
  const fixtures = rawList.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]): unknown => {
      for (const k of keys) if (f[k] !== undefined && f[k] !== null) return f[k];
      return undefined;
    };
    return {
      eventId: String(pick('eventId', 'event_id', 'fixture_id', 'game_id') ?? ''),
      sport: String(pick('sport') ?? ''),
      leagueId: Number(pick('leagueId', 'league_id') ?? 0),
      leagueName: String(pick('leagueName', 'league_name', 'league') ?? ''),
      homeTeam: String(pick('homeTeam', 'home_team') ?? ''),
      awayTeam: String(pick('awayTeam', 'away_team') ?? ''),
      kickoffUtc: String(pick('kickoffUtc', 'kickoff_utc', 'kickoff_ts') ?? ''),
      feedStatus: (pick('feedStatus', 'feed_status', 'status') ?? 'scheduled') as
        | 'scheduled'
        | 'live'
        | 'final',
    };
  });
  return { ...frame, payload: { fixtures } } as unknown as FixtureListFrameTyped;
}

/**
 * Map an AdSlot wire frame to the render `AdSlotPayload`. Reads from the
 * flattened top level or the nested `payload`; null when the slot has no id.
 */
function toAdSlot(frame: Record<string, unknown>): AdSlotPayload | null {
  const payload = (frame['payload'] as Record<string, unknown> | undefined) ?? {};
  const pick = (key: string): unknown => frame[key] ?? payload[key];
  const id = pick('ad_slot_id');
  if (typeof id !== 'string' || id.length === 0) return null;
  return {
    ad_slot_id: id,
    ad_class: String(pick('ad_class') ?? ''),
    ad_ref: String(pick('ad_ref') ?? ''),
    ad_ref_type: 'asset_id',
    policy: (pick('policy') as Record<string, unknown>) ?? {},
  };
}

/** A no-op GameStateRequester for single_game (gap recovery is opportunistic). */
function makeGameStateRequester(): GameStateRequester {
  return {
    requestForGap: () => {
      /* single_game tolerates a gap until the next snapshot; no active re-request. */
    },
    resolve: () => {},
  };
}

/**
 * The active game id is the primary game of the currently-rendered ProgramSlot.
 * Read through the activator's public surface; null between renders. Kept as a
 * free function so the dispatcher's ActiveGames gate stays a narrow read.
 */
function activatorActiveGameId(
  slots: ProgramSlotResolver,
  activator: PlannedStateActivator,
): string | null {
  const slotId = activator.activeProgramSlotId();
  if (slotId === null) return null;
  return slots.resolve(slotId)?.primary_game_id ?? null;
}

/** Render the "configure wsBaseUrl" placeholder when no WS base is set. */
function renderConfigurePlaceholder(host: HTMLElement, doc: Document): void {
  const p = doc.createElement('div');
  p.className = 'crowdaq-configure-placeholder';
  p.dataset['testid'] = 'crowdaq-configure-placeholder';
  p.textContent = 'Configure wsBaseUrl';
  host.appendChild(p);
}

// --- single_game template adapter --------------------------------------------

import { SingleGameTemplate, type SingleGameContext, type SingleGameInstance } from './templates/single-game/SingleGameTemplate';
import type { SingleGameTemplateLike } from './render/PlannedStateActivator';

/**
 * Adapts the bare {@link SingleGameTemplate} to the activator's
 * {@link SingleGameTemplateLike} mount seam. A thin pass-through today; the seam
 * exists so the SPEC-CRWDQ-065 reconcile-capable overlay composite can be
 * dropped in without forking the composition root.
 */
class SingleGameTemplateAdapter implements SingleGameTemplateLike {
  private readonly inner = new SingleGameTemplate();
  mount(host: HTMLElement, context: SingleGameContext): SingleGameInstance {
    return this.inner.mount(host, context);
  }
}
