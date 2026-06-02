/**
 * SPEC-CRWDQ-023 — render-orchestration journal sink (D-GRH-29).
 *
 * The transport and config modules each own their own narrow journal event
 * union; the render layer owns its own here so its event types stay a closed,
 * reviewable set without coupling to those modules. Production binds the
 * LocalStorage/WS-channel sink (out of scope); tests bind an in-memory
 * recorder (a real sink, not a mock — INV-FACTORY-17 treats the journal as a
 * system boundary).
 */

/** Closed set of render-orchestration journal events this spec emits. */
export type RenderJournalEventType =
  | 'game_event_seq_regression'
  | 'template_buffer_timeout'
  | 'template_render_fallback'
  | 'transition_catalog_miss'
  | 'dwell_boundary_reached'
  // --- part 2: reconcile dispatch (AC4) ---
  | 'template_reconcile_dropped'
  | 'template_reconcile_skipped'
  | 'template_reconcile_dispatched'
  // --- part 2: overlay-ad branch (AC7) ---
  | 'ad_slot_payload_unavailable'
  // --- multiple_games template (SPEC-CRWDQ-031) ---
  | 'template_input_invalid'
  | 'multi_game_reconciled'
  // --- fixtures template (SPEC-CRWDQ-034) ---
  | 'fixture_cache_miss'
  | 'fixtures_reconciled'
  | 'template_locale_refresh'
  // --- recap template (SPEC-CRWDQ-046) ---
  | 'recap_no_gamestate'
  | 'recap_premature'
  | 'recap_late_event'
  // --- with-ads composite templates (SPEC-CRWDQ-041) ---
  | 'ad_asset_cache_miss'
  | 'ad_slot_rendered'
  | 'ad_slot_completed'
  // --- ambient template (SPEC-CRWDQ-053) ---
  | 'ambient_video_deferred'
  | 'ambient_empty_manifest'
  | 'ambient_creative_advanced'
  | 'ambient_playlist_refreshed';

export interface RenderJournalEntry {
  type: RenderJournalEventType;
  /** Free-form decision metadata (game_id, seq, reason, animation_id, …). */
  [key: string]: unknown;
}

export interface RenderJournal {
  record(entry: RenderJournalEntry): void;
}
