/**
 * SPEC-CRWDQ-023 — ProgramSlot resolution by `program_slot_id` (D-GRH-21, AC3).
 *
 * A synchronous last-write-wins map: each `ProgramSlot` frame upserts the slot
 * keyed by `program_slot_id`, and the `PlannedStateActivator` resolves the slot
 * the incoming `PlannedState` references. `resolve` is synchronous (no fetch,
 * no promise) so activation can branch immediately on presence; `has` lets the
 * activator decide whether it must buffer until the slot frame arrives (AC4).
 *
 * Frame -> payload extraction lives here so the activator works in payloads,
 * never re-reading the permissive wire envelope. A frame missing
 * `program_slot_id` is ignored (it cannot be keyed); a frame whose
 * `primary_game_id` is absent normalizes to `null` (the "no live game" case).
 */
import type { ProgramSlotFrame } from '../wire';
import type { ProgramSlotPayload } from './types';

export class ProgramSlotResolver {
  private readonly slots = new Map<string, ProgramSlotPayload>();

  /** Upsert a slot from its wire frame. Last write wins per `program_slot_id`. */
  upsert(frame: ProgramSlotFrame): void {
    const programSlotId = frame['program_slot_id'];
    if (typeof programSlotId !== 'string' || programSlotId.length === 0) {
      // An unkeyable frame cannot be resolved later — nothing to store.
      return;
    }
    const rawGameId = frame['primary_game_id'];
    const primaryGameId =
      typeof rawGameId === 'string' && rawGameId.length > 0 ? rawGameId : null;
    this.slots.set(programSlotId, {
      program_slot_id: programSlotId,
      primary_game_id: primaryGameId,
      // D-GRH-14 ordered lists, normalized to `[]` so a resolved slot always
      // carries them (the multi-game / fixtures templates read them directly).
      game_ids: normalizeStringList(frame['game_ids']),
      fixture_ids: normalizeStringList(frame['fixture_ids']),
    });
  }

  /** The current slot for `programSlotId`, or `null` if none upserted yet. */
  resolve(programSlotId: string): ProgramSlotPayload | null {
    return this.slots.get(programSlotId) ?? null;
  }

  /** True iff a slot exists for `programSlotId` (drives buffer-vs-proceed). */
  has(programSlotId: string): boolean {
    return this.slots.has(programSlotId);
  }
}

/** Read a wire field as an ordered list of non-empty strings, else `[]`. */
function normalizeStringList(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}
