/**
 * SPEC-CRWDQ-014 #27 — config-push journal sink (D-GRH-29).
 *
 * Every `handle` call emits exactly one `config_push_received` journal event
 * recording whether the push was accepted, whether it was applied, and the
 * decision metadata (reject reason, hash-match reason, evicted keys, the
 * superseded prior hash). The render loop, ops dashboards, and drift
 * detection read these events; this module only defines the event shape and
 * the sink interface — the production sink batches to the WS journal channel
 * (out of scope here), and unit tests use an in-memory sink.
 */
import type { ConfigRejectReason } from './types';

export interface ConfigPushJournalEvent {
  type: 'config_push_received';
  accepted: boolean;
  applied: boolean;
  /** Server-supplied hash of the incoming push (null when unparseable). */
  configHash: string | null;
  /** Why a hash-equal push was not applied. */
  reason?: 'hash_match';
  /** Why a push was rejected. */
  rejectReason?: ConfigRejectReason;
  /** Preference-derived cache keys evicted on a replace. */
  evictedKeys?: string[];
  /** Prior pending hash superseded by this push's queued apply (AC9). */
  supersededBy?: string;
}

export interface ConfigJournal {
  record(event: ConfigPushJournalEvent): void;
}
