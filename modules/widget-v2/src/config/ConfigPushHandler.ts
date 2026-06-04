/**
 * SPEC-CRWDQ-014 #27 — ConfigPush consumer (AC2, AC8, AC9).
 *
 * The single entry point the WS dispatcher calls for `ConfigPush` frames.
 * `handle` is total: it NEVER throws on any input (AC2). It validates the
 * closed shape, compares the server hash against the persisted snapshot, and
 * either no-ops (hash match), persists + evicts + queues an apply (hash
 * differs / first push), or rejects. Exactly one journal event is emitted
 * per call (D-GRH-29).
 *
 * The handler holds NO render-loop port (AC9): its only render coupling is
 * `ApplyPreferenceState.queueApply`, whose pending slot the render loop reads
 * at a dwell boundary. It never forces a transition or PlannedState
 * activation. The single pending slot means a second push before a boundary
 * supersedes the first; the handler journals the superseded prior hash.
 */
import type { ApplyPreferenceState } from './ApplyPreferenceState';
import type { ConfigJournal } from './Journal';
import type { PreferenceStore } from './PreferenceStore';
import type { ConfigPushFrame, ConfigPushOutcome } from './types';
import { validateConfigPush } from './validate';

/**
 * Best-effort read of a frame's `config_hash` for journaling a REJECTED push.
 * Returns the hash only when it is a present, non-empty string; otherwise null
 * (absent / unparseable / wrong type) — matching the ConfigPushJournalEvent
 * contract where `configHash` is null exactly when the hash can't be read.
 */
function readFrameConfigHash(frame: unknown): string | null {
  if (typeof frame !== 'object' || frame === null) return null;
  const hash = (frame as Record<string, unknown>)['config_hash'];
  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

export class ConfigPushHandler {
  /**
   * Hash of the last apply this handler queued, or null before any. Tracked
   * here (not in the slot) because the slot stores preferences, not the hash,
   * and the journal needs the prior hash to record a supersede (AC9). A queued
   * apply is only genuinely superseded if the render loop has NOT yet drained
   * the slot — so the supersede journal is gated on `apply.hasPending()`, not
   * on this hash alone (it would otherwise go stale after a boundary read).
   */
  private pendingApplyHash: string | null = null;

  constructor(
    private readonly store: PreferenceStore,
    private readonly apply: ApplyPreferenceState,
    private readonly journal: ConfigJournal,
  ) {}

  async handle(frame: ConfigPushFrame): Promise<ConfigPushOutcome> {
    try {
      return await this.handleInner(frame);
    } catch {
      // AC2 — a totally unexpected failure (e.g. a storage quota throw) must
      // still produce an outcome rather than propagate. Journal it as a
      // rejected schema-level fault and report `rejected`.
      this.journal.record({
        type: 'config_push_received',
        accepted: false,
        applied: false,
        configHash: null,
        rejectReason: 'schema_invalid',
      });
      return { kind: 'rejected', reason: 'schema_invalid' };
    }
  }

  private async handleInner(frame: ConfigPushFrame): Promise<ConfigPushOutcome> {
    const result = validateConfigPush(frame);
    if (!result.ok) {
      // configHash is null ONLY when the frame's config_hash is absent or
      // unparseable (ConfigPushJournalEvent doc). A reject for a downstream
      // reason (theme/timezone) on a frame that DID carry a valid hash string
      // still journals that hash so the entry can be correlated.
      this.journal.record({
        type: 'config_push_received',
        accepted: false,
        applied: false,
        configHash: readFrameConfigHash(frame),
        rejectReason: result.reason,
      });
      return { kind: 'rejected', reason: result.reason };
    }

    const { payload } = result;
    const configHash = payload.config_hash;
    const prior = await this.store.load();

    // AC8 — hash-equal: zero writes/evictions/queueApply, one journal entry.
    if (prior !== null && prior.configHash === configHash) {
      this.journal.record({
        type: 'config_push_received',
        accepted: true,
        applied: false,
        configHash,
        reason: 'hash_match',
      });
      return { kind: 'unchanged', configHash };
    }

    // Hash differs (or first-ever push): evict + queue the apply FIRST, then
    // persist the durable hash. If eviction throws after a premature save, the
    // hash would already be persisted and the next identical re-push would
    // hash-match and skip eviction+apply (preferences never applied). Persist
    // only once the fallible eviction+queue have succeeded.
    const evictedKeys = await this.store.evictPreferenceDerivedCache();

    // AC9 — single pending slot: a prior un-consumed apply is superseded. Only
    // genuine if an apply is still slotted; once the render loop drained it at
    // a dwell boundary, `pendingApplyHash` is stale and there is nothing to
    // supersede.
    const supersededBy = this.apply.hasPending() ? this.pendingApplyHash : null;
    this.apply.queueApply(payload.preferences);
    this.pendingApplyHash = configHash;

    await this.store.save({ payload, configHash });

    this.journal.record({
      type: 'config_push_received',
      accepted: true,
      applied: true,
      configHash,
      evictedKeys,
      ...(supersededBy !== null ? { supersededBy } : {}),
    });

    if (prior === null) {
      // First-ever push: stored as a replace, journaled/reported as first_push.
      return { kind: 'first_push', preferences: payload.preferences, configHash };
    }
    return { kind: 'replaced', previousHash: prior.configHash, configHash, evictedKeys };
  }
}
