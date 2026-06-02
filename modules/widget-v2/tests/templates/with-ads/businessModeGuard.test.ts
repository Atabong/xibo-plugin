import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * D-GRH-30 / SPEC-CRWDQ-039: the with-ads catalog carries EXACTLY two composite
 * modes — `multiple_games_with_ads` and `fixtures_with_ads`. There is no
 * `single_game_with_ads` member and no bare `ad` business mode in the closed
 * enum. This guard fails if a future edit reintroduces either forbidden token in
 * the with-ads source, keeping the player aligned with the backend enum.
 */
const here = dirname(fileURLToPath(import.meta.url));
const withAdsSrc = join(here, '..', '..', '..', 'src', 'templates', 'with-ads');

function sourceFiles(): string[] {
  return readdirSync(withAdsSrc)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(withAdsSrc, f));
}

describe('with-ads business-mode guard (SPEC-CRWDQ-041 #56, D-GRH-30)', () => {
  it('references only multiple_games_with_ads and fixtures_with_ads — never single_game_with_ads', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not mention single_game_with_ads`).not.toContain(
        'single_game_with_ads',
      );
    }
  });

  it('uses no bare "ad" business-mode value (only the two composite modes)', () => {
    // The only quoted business-mode literals in the with-ads source are the two
    // composite modes; a literal 'ad' (or "ad") business mode is forbidden.
    const adAsMode = /(['"])ad\1/;
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(adAsMode.test(text), `${file} must not use 'ad' as a business mode`).toBe(false);
    }
  });

  it('every quoted business-mode literal is one of the two allowed composite modes', () => {
    const allowed = new Set(['multiple_games_with_ads', 'fixtures_with_ads']);
    const modeLiteral = /(['"])([a-z_]+_with_ads)\1/g;
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(modeLiteral)) {
        expect(allowed.has(match[2]!), `${file} uses disallowed mode ${match[2]}`).toBe(true);
      }
    }
  });
});
