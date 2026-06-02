import { describe, it, expect } from 'vitest';
import { badgeAssetId, slugLeague } from '../../../src/templates/fixtures/badgeAssetId';

describe('badgeAssetId convention (AC8)', () => {
  it('builds badge:<sport>:<leagueName-slug>', () => {
    expect(badgeAssetId('football', 'Premier League')).toBe('badge:football:premier-league');
  });

  it('lower-cases the sport segment', () => {
    expect(badgeAssetId('Basketball', 'NBA')).toBe('badge:basketball:nba');
  });

  it('slugifies punctuation and collapses separators', () => {
    expect(slugLeague("Ligue 1 — McDonald's")).toBe('ligue-1-mcdonald-s');
    expect(slugLeague('  La Liga  ')).toBe('la-liga');
  });
});
