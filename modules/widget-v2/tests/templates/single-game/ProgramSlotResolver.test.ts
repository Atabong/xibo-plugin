import { describe, it, expect } from 'vitest';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import type { ProgramSlotFrame } from '../../../src/wire';

const slot = (id: string, primaryGameId: string | null): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
  }) as unknown as ProgramSlotFrame;

describe('ProgramSlotResolver', () => {
  it('resolves an upserted slot to its payload synchronously', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'game-A'));
    expect(resolver.resolve('slot-1')).toEqual({
      program_slot_id: 'slot-1',
      primary_game_id: 'game-A',
    });
  });

  it('returns null for a slot id that was never upserted', () => {
    const resolver = new ProgramSlotResolver();
    expect(resolver.resolve('absent')).toBeNull();
  });

  it('reports presence via has() so the activator can decide to buffer', () => {
    const resolver = new ProgramSlotResolver();
    expect(resolver.has('slot-1')).toBe(false);
    resolver.upsert(slot('slot-1', 'game-A'));
    expect(resolver.has('slot-1')).toBe(true);
  });

  it('applies last-write-wins on a repeated program_slot_id', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'game-A'));
    resolver.upsert(slot('slot-1', 'game-B'));
    expect(resolver.resolve('slot-1')?.primary_game_id).toBe('game-B');
  });

  it('normalizes an absent primary_game_id to null (no live game)', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', null));
    expect(resolver.resolve('slot-1')?.primary_game_id).toBeNull();
  });
});
