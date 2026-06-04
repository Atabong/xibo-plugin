/**
 * SPEC-CRWDQ-052 — the `safe_info` adapter plugging {@link SafeInfoTemplate}
 * into the shared `PlannedStateActivator` (the SAME orchestration every other
 * mode uses — buffer, transition, dwell, supersede — never a forked path).
 *
 * The adapter contributes ONLY the mode-specific mount: it builds the
 * `SafeInfoContext` from the activator's mount args (the resolved theme + slot)
 * combined with the {@link SafeStateController}'s per-mount source +
 * venue-brand inputs, mounts the template, and reports an EMPTY subscribed-game
 * set (safe_info renders no game data, so no `game_state_revision` ever gates
 * through). It wraps `detach()` so the controller's `inSafe` flips back to
 * false the moment a real PlannedState supersedes the synthetic safe state
 * (D-SAFE-01 recovery, AC8).
 *
 * Register with `activator.registerTemplate('safe_info', makeSafeAdapter(...))`.
 */
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { SafeStateController } from '../../render/SafeStateController';
import { SafeInfoTemplate } from './SafeInfoTemplate';

export interface SafeAdapterDeps {
  template: SafeInfoTemplate;
  /** Source of the per-mount {@link import('./SafeInfoTemplate').SafeSource}. */
  controller: SafeStateController;
}

/** Build the `safe_info` adapter for `PlannedStateActivator.registerTemplate`. */
export function makeSafeAdapter(deps: SafeAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount {
      const ctx = deps.controller.buildContext(args.theme, args.slot);
      const inner = deps.template.mount(args.host, ctx);
      deps.controller.noteMounted(ctx.source);

      const instance = {
        detach(): HTMLElement {
          const node = inner.detach();
          deps.controller.noteDetached();
          return node;
        },
      };
      // safe_info carries no game subscription: no game_state_revision gates
      // through, exactly like the pre-game fixtures catalog.
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}
