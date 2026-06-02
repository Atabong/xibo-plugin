/**
 * SPEC-CRWDQ-053 (part 1) — the `ambient` adapter that plugs the ambient
 * template into the SHARED SPEC-CRWDQ-023 `PlannedStateActivator`, the SAME
 * orchestration single_game / multiple_games / fixtures / recap / safe_info use
 * — never a forked activator (INV-FACTORY-19).
 *
 * The activator owns the whole lifecycle: resolving the referenced ProgramSlot
 * (ambient carries a non-null `program_slot_id` per D-GRH-27 — an EMPTY slot,
 * but a real one, so it flows through the normal resolve / re-push-buffer path,
 * NOT a slot-less shortcut), running the PlannedState-level transition once,
 * arming + owning the PlannedState-level dwell (the shared dwell-boundary theme
 * swap is independent of the template's own creative rotation), the supersede
 * flow (cancel dwell, outgoing transition, `detach()`). This adapter contributes
 * ONLY the mode-specific mount and the D-GRH-27 empty-manifest fallback.
 *
 * The fallback (AC3): when {@link AmbientPlaylist.resolve} is empty — no
 * `ambient:*` assets, or every one filtered out as video — the adapter journals
 * `ambient_empty_manifest` and mounts the SPEC-CRWDQ-052 {@link SafeInfoTemplate}
 * into the SAME host with `source = { kind: 'backend_planned', reason:
 * 'no_content' }`, so the DOM ends with `<section class="crowdaq-safe-info">`
 * rather than `crowdaq-ambient`. The activator never sees the fallback as a
 * decline — a `TemplateInstance` is always returned (the safe panel's), so the
 * dwell still arms and supersede still detaches the safe panel cleanly.
 *
 * Ambient subscribes to NO games (it reads only the asset cache, D-GRH-27), so
 * `subscribedGameIds` is empty and no `game_state_revision` ever gates through.
 *
 * Register with `activator.registerTemplate('ambient', makeAmbientAdapter(...))`.
 */
import type { TemplateAdapter, TemplateMount } from '../../render/PlannedStateActivator';
import type { RenderJournal } from '../../render/RenderJournal';
import type { AssetManifestStore } from '../../render/AssetManifestStore';
import type { DwellTimer } from '../../render/DwellTimer';
import {
  SafeInfoTemplate,
  type SafeBarPreferences,
} from '../safe-info/SafeInfoTemplate';
import { AmbientTemplate } from './AmbientTemplate';
import type { AmbientPlaylist } from './AmbientPlaylist';

export interface AmbientAdapterDeps {
  template: AmbientTemplate;
  /** The SPEC-CRWDQ-052 fallback target for the empty-manifest path (AC3). */
  safeInfoTemplate: SafeInfoTemplate;
  /** The venue-brand asset source the safe fallback reads synchronously. */
  assetManifestStore: AssetManifestStore;
  journal: RenderJournal;
  /**
   * Factory for a fresh {@link AmbientPlaylist} per mount (it closes over the
   * AssetManifestStore). A factory rather than a shared instance so each mount
   * re-resolves against the live applied manifest with no cross-mount state.
   */
  makePlaylist: () => AmbientPlaylist;
  /**
   * Factory for the per-mount rotation {@link DwellTimer}. This is the ambient
   * template's OWN creative-rotation timer — distinct from the activator's
   * PlannedState-level dwell — so each mount gets a clean one the template
   * cancels on `detach()`.
   */
  makeDwell: () => DwellTimer;
  /**
   * Active bar preferences (D-GRH-73) for the safe fallback's venue branding.
   * Null on a cold boot — the safe panel then renders the wordmark only.
   */
  barPreferences: () => SafeBarPreferences | null;
}

/** Build the `ambient` adapter for `PlannedStateActivator.registerTemplate`. */
export function makeAmbientAdapter(deps: AmbientAdapterDeps): TemplateAdapter {
  return {
    mount(args): TemplateMount {
      const playlist = deps.makePlaylist();
      const creatives = playlist.resolve();

      // D-GRH-27 fallback: an empty playlist (no ambient:* assets, or every one
      // filtered as video) routes the activation to safe_info in this host —
      // NOT a decline; the activator gets a real instance so the dwell arms and
      // supersede detaches the safe panel through the normal flow.
      if (creatives.length === 0) {
        deps.journal.record({ type: 'ambient_empty_manifest' });
        const instance = deps.safeInfoTemplate.mount(args.host, {
          programSlot: args.slot,
          theme: args.theme,
          barPreferences: deps.barPreferences(),
          assetManifestStore: deps.assetManifestStore,
          source: { kind: 'backend_planned', reason: 'no_content' },
        });
        return { instance, subscribedGameIds: new Set<string>() };
      }

      const instance = deps.template.mount(args.host, {
        theme: args.theme,
        dwellTargetMs: args.payload.dwell_target_ms,
        playlist,
        dwell: deps.makeDwell(),
        journal: deps.journal,
      });
      // Ambient reads only the asset cache: it subscribes to NO games, so no
      // game_state_revision ever gates through to a reconcile hook (D-GRH-27).
      return { instance, subscribedGameIds: new Set<string>() };
    },
  };
}
