/**
 * Crowdaq Widget v2 runtime — public entrypoint.
 *
 * The bundle (tsup IIFE/UMD, global `CrowdaqWidgetV2`) exposes `boot()` for the
 * Xibo `<onRender>` to call: it wires the transport, config, render and
 * single_game template modules into a running widget against the crowdaq.v1 WS.
 * The wire barrel is re-exported for consumers that need the protocol types.
 */
export { boot, resolveWsUrl, resolveXiboInfo, HOST_TESTID } from './bootstrap';
export type {
  BootDeps,
  BootProperties,
  WidgetRuntime,
  XiboDisplayInfo,
} from './bootstrap';
export * from './wire';
