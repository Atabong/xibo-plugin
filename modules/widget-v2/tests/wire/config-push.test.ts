/**
 * SPEC-CRWDQ-014 #27 AC1 — the ConfigPush wire twin is importable from the
 * `wire/` barrel and its shapes match the SPEC-CRWDQ-013 producer contract
 * (snake_case field names, UPPERCASE days, nine-member BusinessMode union,
 * three-state theme discriminant, 10-field BarPreferencesWire).
 *
 * These are compile-time-load-bearing assignments: if the barrel ever stops
 * re-exporting a type or its shape drifts from the backend, this file fails
 * to typecheck and `tsc --noEmit` (the gate) rejects the build.
 */
import { describe, it, expect } from 'vitest';
import {
  type ConfigPushPayload,
  type BarPreferencesWire,
  type ThemeChoiceWire,
  type ThemeWire,
  type BusinessHourWire,
  type BusinessMode,
  type DayOfWeek,
  type IntervalsWire,
  BUSINESS_MODES,
  DAYS_OF_WEEK,
} from '../../src/wire';

describe('ConfigPush wire twin (SPEC-CRWDQ-013 contract)', () => {
  it('exposes the nine-member BusinessMode union in semantic order', () => {
    const expected: BusinessMode[] = [
      'single_game',
      'multiple_games',
      'multiple_games_with_ads',
      'fixtures',
      'fixtures_with_live_game',
      'fixtures_with_ads',
      'recap',
      'safe_info',
      'ambient',
    ];
    expect([...BUSINESS_MODES]).toEqual(expected);
  });

  it('exposes the seven UPPERCASE DayOfWeek members', () => {
    const expected: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    expect([...DAYS_OF_WEEK]).toEqual(expected);
  });

  it('models the theme discriminant as a three-state union with ThemeWire alias', () => {
    const set: ThemeChoiceWire = { state: 'set', id: 't1' };
    const dflt: ThemeWire = { state: 'default' };
    const unset: ThemeChoiceWire = { state: 'unset' };
    expect(set.state).toBe('set');
    expect(dflt.state).toBe('default');
    expect(unset.state).toBe('unset');
  });

  it('models a BusinessHourWire with day_of_week + open_local + close_local', () => {
    const hour: BusinessHourWire = { day_of_week: 'MON', open_local: '09:00', close_local: '23:30' };
    expect(hour.day_of_week).toBe('MON');
  });

  it('models BarPreferencesWire with exactly the ten snake_case fields', () => {
    const prefs: BarPreferencesWire = {
      theme: { state: 'unset' },
      sports: ['nba'],
      leagues: ['nba'],
      region: null,
      state: null,
      city: null,
      timezone: 'America/New_York',
      business_hours: [],
      local_team_list: [],
      fallback_mode_order: ['ambient'],
    };
    expect(Object.keys(prefs).sort()).toEqual(
      [
        'business_hours',
        'city',
        'fallback_mode_order',
        'leagues',
        'local_team_list',
        'region',
        'sports',
        'state',
        'theme',
        'timezone',
      ].sort(),
    );
  });

  it('models IntervalsWire as the D-GRH-75 three-field closed set', () => {
    const intervals: IntervalsWire = {
      journal_sync_ms: 60_000,
      heartbeat_ms: 15_000,
      manifest_recheck_ms: 300_000,
    };
    expect(Object.keys(intervals).sort()).toEqual(
      ['heartbeat_ms', 'journal_sync_ms', 'manifest_recheck_ms'].sort(),
    );
  });

  it('models the full ConfigPushPayload envelope', () => {
    const payload: ConfigPushPayload = {
      message_type: 'ConfigPush',
      schema_version: 1,
      ts: '2026-05-30T00:00:00Z',
      bar_id: 'bar-1',
      display_id: null,
      preferences: {
        theme: { state: 'default' },
        sports: [],
        leagues: [],
        region: null,
        state: null,
        city: null,
        timezone: 'UTC',
        business_hours: [],
        local_team_list: [],
        fallback_mode_order: [],
      },
      cache_ceiling_bytes: 1_073_741_824,
      intervals: { journal_sync_ms: 60_000, heartbeat_ms: 15_000, manifest_recheck_ms: 300_000 },
      config_hash: 'h1',
    };
    expect(payload.message_type).toBe('ConfigPush');
    expect(payload.schema_version).toBe(1);
  });
});
