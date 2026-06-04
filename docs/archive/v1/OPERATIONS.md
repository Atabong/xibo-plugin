<!--
  Copyright (C) 2026 CROWDAQ
  Licensed under AGPL-3.0-or-later.
-->
> **⚠️ ARCHIVED — v1 (SSE) widget.** This documents the legacy SSE widget `modules/crowdaq-widget.xml`. Current direction is **widget-v2** (WebSocket/JSONL) — see [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md). v1 still ships side-by-side with v2; this doc is retained for v1 operators only.

# CROWDAQ Xibo plugin — operations runbook

Operator-side procedures for inspecting and debugging a deployed CROWDAQ
widget. Targets the production stack (k3s + Flux + Xibo CMS pod) reached
via `kubectl --context nadwell-k3s -n xibo`.

## Table of contents

- [Querying widget logs (CMS player_faults table)](#querying-widget-logs-cms-player_faults-table)
- [Log event reference](#log-event-reference)
- [Refreshing a deployed widget](#refreshing-a-deployed-widget)
- [Player-side Chromium remote debugging](#player-side-chromium-remote-debugging)
- [Known limitation: xibo-player CSP whitelist](#known-limitation-xibo-player-csp-whitelist)
- [Known limitation: payload schema mismatch (backend vs widget)](#known-limitation-payload-schema-mismatch-backend-vs-widget)

## Querying widget logs (CMS player_faults table)

Errors propagate to CMS `player_faults` table via `xiboIC.reportFault`. Non-error events
(info, warn) log to the player's local console-logs.db sqlite only (severity gated by
the player's logLevel config) — they are **not** visible in CMS.

### One-shot query (last 30 entries)

```sql
SELECT incidentDt, displayId, code, reason
FROM player_faults
WHERE code LIKE 'crowdaq-%'
ORDER BY playerFaultId DESC LIMIT 30;
```

Run against the CMS pod:

```bash
POD=$(kubectl --context nadwell-k3s -n xibo get pod \
    -l app.kubernetes.io/name=xibo-cms \
    -o jsonpath='{.items[0].metadata.name}')

kubectl --context nadwell-k3s -n xibo exec "$POD" -- bash -c \
  'mysql -h mysql -u cms -p${MYSQL_PASSWORD} cms -e \
  "\"SELECT incidentDt, displayId, code, reason FROM player_faults WHERE code LIKE 'crowdaq-%' ORDER BY playerFaultId DESC LIMIT 30\""'
```

`displayId` lets you scope to a single bar. `code` is `crowdaq-<event>`, `reason` is
the full `[crowdaq:<event>] {json}` message. Note: info/warn-level events are NOT
visible here — only errors escalate via reportFault.

### Tail (re-run every few seconds)

There is no native tail on the CMS `player_faults` table; rerun the one-shot query
or use `watch` on the bastion:

```bash
watch -n 5 kubectl --context nadwell-k3s -n xibo exec "$POD" -- bash -c \
  'mysql -h mysql -u cms -p${MYSQL_PASSWORD} cms -e \
  "\"SELECT incidentDt, displayId, code, reason FROM player_faults WHERE code LIKE 'crowdaq-%' ORDER BY playerFaultId DESC LIMIT 10\""'
```

## Log event reference

Every log message has the form:

```
[crowdaq:<event>] {<json fields>}
```

The full inventory of events emitted by the widget — listed by lifecycle
phase. Field names are stable; new fields may be added without notice but
existing ones do not change shape.

### Initialisation

| event | level | fields | meaning |
| --- | --- | --- | --- |
| `init` | info | `apiBaseUrlRaw`, `eventIdRaw`, `refreshInterval`, `showTeamLogos`, `showLastMoment`, `maxMomentLength`, `userAgent`, `hasXiboIC`, `hasEventSource` | First line emitted on widget mount. Confirms the stencil parsed and the IIFE is running. |
| `init-no-root` | error | `{}` | The `[data-crowdaq-root]` element was not found in the DOM — stencil/Twig render broken. |
| `resolved` | info | `apiBaseUrl`, `eventId`, `sourceInfoPresent` | Final values after `display:<field>` resolution + `window.crowdaqBackendBase` fallback. `sourceInfoPresent: false` means `xiboIC.info()` did not return data (offline / preview / pre-4.4 player). |
| `connect` | info | `url`, `streamEventId` | About to call `new EventSource(url)`. The `url` value is what the widget will actually hit. |
| `connect-no-api-base-url` | error | `rawApiBaseUrl`, `rawEventId` | Widget cannot connect — no apiBaseUrl resolved. Operator must set the property. |
| `connect-no-eventsource` | error | `{}` | Browser does not implement `EventSource`. Should never trigger on Xibo Player Chromium. |

### EventSource lifecycle

| event | level | fields | meaning |
| --- | --- | --- | --- |
| `es-opening` | info | `url`, `attempt` | New `EventSource` ctor about to fire. `attempt > 0` indicates a reconnect cycle. |
| `es-open` | info | `readyState`, `url`, `eventType` | `EventSource` `onopen` fired. `readyState=1` (OPEN). The first time this lands the stream is up. |
| `es-open-throw` | error | `url`, `error` | `new EventSource(...)` threw synchronously — usually a malformed URL. |
| `es-error` | error | `readyState`, `url`, `attempt`, `eventType`, `timestamp` | The browser reported an error on the stream. Note that EventSource does NOT expose status code, response body, or CORS detail by spec — this is the most signal you can get from the client side. Cross-reference `readyState`: `0` = connecting (initial fail), `2` = closed (server-side close or network drop). |
| `es-give-up` | error | `attempts`, `maxAttempts`, `url` | Reconnect schedule exhausted (`MAX_ATTEMPTS=5`). Widget shows "offline". |
| `es-event` | info | `event`, `bytes`, `keys` | A typed event arrived. `keys` lists the top-level fields of the JSON payload. |
| `es-parse-error` | error | `event`, `error`, `sample` | `JSON.parse` failed on the event payload. `sample` is the first 120 chars of the raw `data` line. |
| `reconnect-attempt` | warn | `attempt`, `backoffMs`, `url` | Bounded backoff scheduling the next `openStream()` call. Schedule: 1s, 2s, 5s, 15s, 30s. |

### Stream content

| event | level | fields | meaning |
| --- | --- | --- | --- |
| `server-error-event` | error | `code`, `message` | Server emitted an `event: error` SSE frame (per `docs/contract/events/error.json`). |
| `handler-throw` | error | `event`, `error`, `stack` | A widget event handler threw — caught so the stream stays alive. Indicates a bug in the dispatch path. |

### Liveness watchdogs

| event | level | fields | meaning |
| --- | --- | --- | --- |
| `stale-detected` | warn | `lastEventAt`, `now`, `gapMs`, `staleThresholdMs` | No event of any kind for `2 * refreshInterval` seconds. Widget flips to the "stale" overlay. |
| `watchdog-no-events` | warn | `gapMs`, `lastEventAt`, `readyState` | No event for >30s. Widget shows the yellow RECONNECTING pill. Earlier-warning indicator than `stale-detected`. Latched: only fires once per stall, resets when the gap drops below 5s. |

### Uncaught errors

| event | level | fields | meaning |
| --- | --- | --- | --- |
| `js-error` | error | `message`, `source`, `lineno`, `colno`, `stack` | Captured by `window.addEventListener('error')`. Catches everything that escaped a try/catch. |
| `js-promise-reject` | error | `reason` | Captured by `window.addEventListener('unhandledrejection')`. |

### Reading the stream of events

Typical happy path on widget mount:

```
init        -> resolved -> connect -> es-opening -> es-open
es-event{score-update} -> es-event{heartbeat} -> es-event{score-update} -> ...
```

Common failure shapes:

- `init -> resolved (apiBaseUrl=null) -> connect-no-api-base-url`: misconfigured property.
- `init -> resolved -> connect -> es-opening -> es-error (readyState=0) -> reconnect-attempt -> es-opening -> es-error -> ...`: connection never established. Check backend reachability + CORS + tailnet ACL.
- `init -> resolved -> connect -> es-opening -> es-open -> watchdog-no-events`: connection succeeded but server emits nothing. Check the backend's stream emitter.
- `... -> es-event -> es-error -> reconnect-attempt`: the stream was up and dropped. Check backend uptime / tailnet auth expiry.

## Refreshing a deployed widget

The widget XML is shipped via the GitOps Job in `k8s/`:
[`k8s/job.yaml`](../../../k8s/job.yaml) + Flux. Editing
`modules/crowdaq-widget.xml` on `main` re-hashes the kustomize-generated
`crowdaq-manifests` ConfigMap, which re-creates the install Job, which
copies the new XML into `/var/www/cms/custom/modules/` in the CMS pod
and restarts the deployment.

Cache busting on the player side is automatic: the Xibo Player polls the
CMS for layout changes on its `collectInterval` (default 300s — check
the display profile). To force a faster pickup, restart the player
service on the bar PC:

```bash
ssh bar-pc 'sudo snap restart xibo-player'
```

## Player-side Chromium remote debugging

The Xibo Player snap embeds Electron-based Chromium and does not, by
default, expose `--remote-debugging-port`. Investigation status:

- `/var/snap/xibo-player/` does NOT contain a writable env file the snap
  reads at start.
- The snap's confinement (strict / classic) and snapcraft.yaml control
  the launch command. The upstream snap is built from
  [`xibosignage/xibo-snaps`](https://github.com/xibosignage/xibo-snaps);
  the player launcher passes a fixed argv to the Electron binary.
- The previous attempt to add `--remote-debugging-port=9222` via snap
  config knobs / cap-stripping was reverted (commit c9db039,
  `fix(bar-player): drop snap-confine cap-stripping knobs`).
- The supported path forward is to either (a) build a private xibo-player
  snap with the debug arg patched in, or (b) run the unconfined dev build
  pipeline serves as the production observability surface.

For this reason the widget's `xiboIC.reportFault` pipeline (this doc's
[Querying widget logs](#querying-widget-logs-cms-player_faults-table) section) is
the supported observability path on production bars. DevTools-level
inspection is reserved for the dev VM build.

## Known limitation: xibo-player CSP whitelist

The upstream `xibo-player` Electron snap injects a hardcoded
Content-Security-Policy on every renderer response from its main process.
The literal lives at:

```
/snap/xibo-player/<rev>/resources/app/dist/main/index.js
```

inside the `webRequest.onHeadersReceived` callback, and the value is:

```
connect-src 'self' http://localhost:9696 https://auth.signlicence.co.uk
```

Chromium enforces this CSP at the renderer **before** CORS preflight or
any network packet leaves the box. EventSource, `fetch`, and WebSocket
calls to any other origin are silently blocked: nothing reaches the
widget's network stack and tcpdump on the player records zero packets to
the target host.

In the CROWDAQ deployment this blocks the widget's connection to the
CROWDAQ SSE backend at `http://crowdaq-1.tail7c5015.ts.net`. The widget's
`[crowdaq:es-error]` log entries fire immediately on every connect
attempt with `readyState=0`; this is the CSP block, **not** a CORS or
network problem. Do not re-debug from the widget side: the plugin code
is correct and the backend's `Access-Control-Allow-Origin: *` is
correct — the request never leaves the renderer.

Fix path: fork the `xibo-player` snap, patch the CSP literal to allow
the bar's tailnet stem (e.g. `http://*.ts.net`, or a tighter
`http://crowdaq-*.tail7c5015.ts.net`), publish the forked snap to a
private channel, and switch `infra/bar-pc/bootstrap.sh` to install from
that channel.

Until that lands the widget will log a tight repeating sequence of
`es-opening` -> `es-error (readyState=0)` -> `reconnect-attempt` ->
`es-give-up` on every bar player. Those entries are still useful as a
heartbeat that the widget itself is mounted and the logging pipeline is
working — they just are not actionable until the snap fork ships.

## Known limitation: payload schema mismatch (backend vs widget)

Independent of the CSP block, the widget's `score-update` handler
expects a nested payload shape per
[`docs/contract/events/score-update.json`](../../contract/events/score-update.json):

```json
{
  "teams": { "home": {...}, "away": {...} },
  "score": { "home": 0, "away": 0 },
  "excitement": { "level": 0.0, "trend": "flat" },
  "last_moment": { "text": "..." },
  "clock": { "minute": 0, "period": "1H" },
  "possession": "home"
}
```

The current backend (as observed on the dev recording) emits a flatter
shape — top-level `home`, `away`, `possession`, `status` fields without
the `teams` / `score` wrappers. Once the CSP block is removed, the first
event that lands at the widget will fail to populate the score row
(`payload.score.home` will be `undefined`, defaulted to `0`).

This is a separate todo and requires either:

1. Backend emits the contract-compliant nested shape (preferred — the
   contract under `docs/contract/` is source of truth), or
2. Widget grows a shape-translation shim in `onScoreUpdate` that accepts
   either shape.

Re-confirm with a `[crowdaq:es-event]` entry in the log table after the
snap fork unblocks the connection: the `keys` field of that log line
will show whether the backend is emitting `[teams,score,excitement,...]`
or `[home,away,possession,status]`.
