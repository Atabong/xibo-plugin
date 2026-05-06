<!--
  Copyright (C) 2026 CROWDAQ
  Licensed under AGPL-3.0-or-later.
-->
# CROWDAQ Xibo plugin — operations runbook

Operator-side procedures for inspecting and debugging a deployed CROWDAQ
widget. Targets the production stack (k3s + Flux + Xibo CMS pod) reached
via `kubectl --context nadwell-k3s -n xibo`.

## Table of contents

- [Querying widget logs (CMS log table)](#querying-widget-logs-cms-log-table)
- [Log event reference](#log-event-reference)
- [Refreshing a deployed widget](#refreshing-a-deployed-widget)
- [Player-side Chromium remote debugging](#player-side-chromium-remote-debugging)

## Querying widget logs (CMS log table)

The widget's `<onRender>` JS pipes structured events through
`xiboIC.submitLog(...)` over XMDS. They land in the CMS database's `log`
table with `channel = "xmds"` (or whichever channel XMDS uses on this
deployment) and a `[crowdaq:<event>] <json>` message body.

The bar-player snap is snap-confined Chromium with no remote DevTools
exposed and a default sqlite log level of `error` only — these CMS-side
log entries are therefore the canonical source of widget-runtime signal
on a production bar.

### One-shot query (last 30 entries)

```bash
POD=$(kubectl --context nadwell-k3s -n xibo get pod \
    -l app.kubernetes.io/name=xibo-cms \
    -o jsonpath='{.items[0].metadata.name}')
MYSQL_POD=$(kubectl --context nadwell-k3s -n xibo get pod \
    -l app=mysql \
    -o jsonpath='{.items[0].metadata.name}')

kubectl --context nadwell-k3s -n xibo exec "$MYSQL_POD" -- sh -c '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
    SELECT logDate, displayId, page, function, message
    FROM log
    WHERE message LIKE '\''%[crowdaq:%'\''
    ORDER BY logId DESC
    LIMIT 30
"'
```

`displayId` lets you scope to a single bar when multiple displays log at
once. `page` and `function` are XMDS metadata; the structured fields
that matter live inside `message`.

### Filter by event class

```bash
# Only errors
... WHERE message LIKE '%[crowdaq:%' AND message LIKE '%[crowdaq:%' AND
    message REGEXP '\\[crowdaq:(es-error|es-give-up|es-open-throw|es-parse-error|server-error-event|js-error|js-promise-reject|handler-throw|connect-no-api-base-url|connect-no-eventsource|init-no-root)'
ORDER BY logId DESC LIMIT 30

# Only EventSource lifecycle (open / error / give-up / events)
... WHERE message REGEXP '\\[crowdaq:(es-opening|es-open|es-error|es-event|es-give-up|reconnect-attempt|stale-detected|watchdog-no-events)'
ORDER BY logId DESC LIMIT 50
```

### Tail (re-run every few seconds)

There is no native tail on the CMS `log` table; rerun the one-shot query
or use `watch` on the bastion:

```bash
watch -n 5 'kubectl --context nadwell-k3s -n xibo exec "$MYSQL_POD" -- sh -c "
mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -e \"
    SELECT logDate, displayId, message
    FROM log
    WHERE message LIKE '%[crowdaq:%'
    ORDER BY logId DESC
    LIMIT 10
\""'
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
[`k8s/job.yaml`](../k8s/job.yaml) + Flux. Editing
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
  on a debug bar VM. Neither is in scope while the CMS-side `log` table
  pipeline serves as the production observability surface.

For this reason the widget's `xiboIC.submitLog` pipeline (this doc's
[Querying widget logs](#querying-widget-logs-cms-log-table) section) is
the supported observability path on production bars. DevTools-level
inspection is reserved for the dev VM build.
