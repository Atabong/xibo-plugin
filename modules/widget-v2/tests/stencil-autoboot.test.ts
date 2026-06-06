/**
 * @vitest-environment jsdom
 *
 * SPEC-CRWDQ-S72 — UNCONDITIONAL WS OPEN ON RENDER.
 *
 * CROWDAQ's live data arrives over the crowdaq.v1 WebSocket, not Xibo's static
 * <dataType> mechanism (intentionally empty), so the module renders with
 * isDataExpected=false. On player runtimes that gate the data-lifecycle render
 * callback (`onRender_<id>`) on the widget's data being expected/ready, that
 * callback — which inlines the bundle and calls boot() — is DEFINED but NEVER
 * CALLED. The delivery WS is then never opened and the s49 active-resync
 * reconnect loop is never armed (it can only reconnect a connection that was
 * first opened). The bar shows only the static collect-time snapshot.
 *
 * The fix is a stencil-level auto-boot <script> that is part of the parsed body
 * HTML and therefore ALWAYS runs, independent of Xibo's data lifecycle. It
 * invokes the player-defined `onRender_<id>` itself when the player has not, so
 * boot() (and thus the WS connect) runs UNCONDITIONALLY on render.
 *
 * This suite extracts the real stencil auto-boot driver from the source module
 * XML and runs it in jsdom against a stubbed onRender_<id> + a fake
 * window.CrowdaqWidgetV2, asserting:
 *   1. the auto-boot invokes the render entry on DOMContentLoaded even though
 *      the player never calls onRender_<id> and isDataExpected is false;
 *   2. it is idempotent — when the player DID already boot (host carries the
 *      __crowdaqWidgetV2 runtime handle), the auto-boot does not invoke again;
 *   3. it does not double-invoke when both the player and the fallback run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MODULE_XML = resolve(here, '..', '..', 'crowdaq-widget-v2.xml');

/**
 * Pull the stencil auto-boot <script> body out of the <twig> CDATA in the module
 * XML. This is the literal code shipped to the player — the test runs the SAME
 * source, not a hand-copied facsimile.
 */
function extractAutoBootScript(): string {
  const xml = readFileSync(MODULE_XML, 'utf8');
  const twigStart = xml.indexOf('<twig><![CDATA[');
  const twigEnd = xml.indexOf(']]></twig>', twigStart);
  expect(twigStart).toBeGreaterThan(-1);
  expect(twigEnd).toBeGreaterThan(twigStart);
  const twig = xml.slice(twigStart, twigEnd);
  // The auto-boot driver is the (single) real <script> block inside the stencil
  // twig. Match the exact opening tag — NOT a bare "<script" — because the
  // explanatory HTML comment above it mentions the word "<script>" in prose.
  const OPEN_TAG = '<script type="text/javascript">';
  const scriptOpen = twig.indexOf(OPEN_TAG);
  const scriptBodyStart = scriptOpen + OPEN_TAG.length;
  const scriptClose = twig.indexOf('</script>', scriptBodyStart);
  expect(scriptOpen).toBeGreaterThan(-1);
  expect(scriptClose).toBeGreaterThan(scriptBodyStart);
  return twig.slice(scriptBodyStart, scriptClose);
}

/** Render the stencil host div (the [data-crowdaq-v2-root] mount) into the DOM. */
function mountHost(): HTMLElement {
  const host = document.createElement('div');
  host.className = 'crowdaq-widget-v2-host';
  host.setAttribute('data-crowdaq-v2-root', '1');
  host.setAttribute('data-crowdaq-ws-base-url', 'ws://game-delivery.example/ws');
  host.setAttribute('data-crowdaq-bar-id', '11111111-1111-1111-1111-111111111111');
  host.setAttribute('data-crowdaq-display-id', 'bar-demo');
  document.body.appendChild(host);
  return host;
}

/** Evaluate the extracted auto-boot script in the jsdom window scope. */
function runAutoBoot(script: string): void {
  // Run in the global scope so `document`, `window`, and any `onRender_*` global
  // resolve exactly as they do in the player iframe.
  // eslint-disable-next-line no-eval
  (0, eval)(script);
}

describe('SPEC-CRWDQ-S72 stencil auto-boot — WS opens on render regardless of isDataExpected', () => {
  let autoBootScript: string;

  beforeEach(() => {
    autoBootScript = extractAutoBootScript();
    document.body.innerHTML = '';
    vi.useFakeTimers();
    // Each iframe defines exactly one onRender_<id>; clean any prior global.
    for (const k of Object.keys(globalThis)) {
      if (k.indexOf('onRender_') === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any)[k];
      }
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the render entry on DOMContentLoaded even though the player never calls onRender_<id> (isDataExpected=false)', () => {
    const host = mountHost();
    const calls: Array<unknown[]> = [];

    // Simulate the player having DEFINED onRender_<id> but NEVER CALLING it
    // (the static-widget gating case). The real onRender body inlines the
    // bundle and calls CrowdaqWidgetV2.boot(host, …); here we record the call
    // and stamp the runtime handle the way the real boot().then() does.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).onRender_42 = function (id: unknown, target: unknown, items: unknown) {
      calls.push([id, target, items]);
      host.__crowdaqWidgetV2 = { wsUrl: 'ws://game-delivery.example/ws', client: {} } as never;
    };

    runAutoBoot(autoBootScript);
    // DOMContentLoaded already fired in jsdom (readyState !== 'loading'), so the
    // driver arms immediately; flush its initial attempt + interval.
    vi.advanceTimersByTime(250);

    expect(calls.length).toBe(1); // the WS-opening render entry ran UNCONDITIONALLY
    expect(host.__crowdaqWidgetV2).toBeTruthy(); // boot() result recorded
  });

  it('is a no-op when the player already booted the widget (host runtime present)', () => {
    const host = mountHost();
    // Player already booted: runtime handle present before the driver arms.
    host.__crowdaqWidgetV2 = { wsUrl: 'ws://x/ws', client: {} } as never;
    let invoked = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).onRender_7 = function () {
      invoked++;
    };

    runAutoBoot(autoBootScript);
    vi.advanceTimersByTime(2_000);

    expect(invoked).toBe(0); // already booted → the fallback must not re-invoke
  });

  it('does not double-invoke when the render entry sets the in-flight guard synchronously', () => {
    const host = mountHost();
    let invoked = 0;
    // The real onRender IIFE sets host.__crowdaqBooting = true synchronously
    // before its async boot(); model that so a second arm-cycle is suppressed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).onRender_99 = function () {
      invoked++;
      host.__crowdaqBooting = true;
      // resolve the boot asynchronously (handle appears later)
      queueMicrotask(() => {
        host.__crowdaqWidgetV2 = { wsUrl: 'ws://x/ws', client: {} } as never;
      });
    };

    runAutoBoot(autoBootScript);
    vi.advanceTimersByTime(3_000);

    expect(invoked).toBe(1); // exactly one boot despite repeated interval ticks
  });
});

// Augment the HTMLElement type for the test-only runtime handles the renderer
// stamps onto the mount host.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLElement {
    __crowdaqWidgetV2?: unknown;
    __crowdaqBooting?: boolean;
  }
}
