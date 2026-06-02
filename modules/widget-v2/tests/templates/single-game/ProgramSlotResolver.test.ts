import { describe, it, expect } from 'vitest';
import { ProgramSlotResolver } from '../../../src/render/ProgramSlotResolver';
import type { ProgramSlotFrame } from '../../../src/wire';

const slot = (
  id: string,
  primaryGameId: string | null,
  gameIds?: unknown,
  fixtureIds?: unknown,
): ProgramSlotFrame =>
  ({
    message_type: 'ProgramSlot',
    program_slot_id: id,
    primary_game_id: primaryGameId,
    ...(gameIds === undefined ? {} : { game_ids: gameIds }),
    ...(fixtureIds === undefined ? {} : { fixture_ids: fixtureIds }),
  }) as unknown as ProgramSlotFrame;

describe('ProgramSlotResolver', () => {
  it('resolves an upserted slot to its payload synchronously', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'game-A'));
    expect(resolver.resolve('slot-1')).toEqual({
      program_slot_id: 'slot-1',
      primary_game_id: 'game-A',
      game_ids: [],
      fixture_ids: [],
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

  it('preserves the order of a multi-game game_ids list (D-GRH-14)', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'g2', ['g1', 'g2', 'g3']));
    expect(resolver.resolve('slot-1')?.game_ids).toEqual(['g1', 'g2', 'g3']);
  });

  it('normalizes an absent or non-array game_ids to an empty list', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'g1'));
    expect(resolver.resolve('slot-1')?.game_ids).toEqual([]);
    resolver.upsert(slot('slot-2', 'g1', 'not-an-array'));
    expect(resolver.resolve('slot-2')?.game_ids).toEqual([]);
  });

  it('drops non-string and empty entries from game_ids', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'g1', ['g1', '', 7, 'g2', null]));
    expect(resolver.resolve('slot-1')?.game_ids).toEqual(['g1', 'g2']);
  });

  it('preserves the order of a fixtures fixture_ids list (kickoff ascending)', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', null, [], ['eA', 'eB', 'eC']));
    expect(resolver.resolve('slot-1')?.fixture_ids).toEqual(['eA', 'eB', 'eC']);
  });

  it('normalizes an absent or non-array fixture_ids to an empty list', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', 'g1'));
    expect(resolver.resolve('slot-1')?.fixture_ids).toEqual([]);
    resolver.upsert(slot('slot-2', null, [], 'not-an-array'));
    expect(resolver.resolve('slot-2')?.fixture_ids).toEqual([]);
  });

  it('drops non-string and empty entries from fixture_ids', () => {
    const resolver = new ProgramSlotResolver();
    resolver.upsert(slot('slot-1', null, [], ['eA', '', 7, 'eB', null]));
    expect(resolver.resolve('slot-1')?.fixture_ids).toEqual(['eA', 'eB']);
  });
});
