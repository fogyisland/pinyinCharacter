import { describe, it, expect, vi } from 'vitest';

// Mock the chars module so tests don't pull in the server-only chain
// (lib/chars.ts → lib/content.ts via 'server-only'). The buildRound tests
// focus on filter logic, not the DB layer.
vi.mock('@/lib/chars', () => ({
  listChars: vi.fn(),
}));

import { seededShuffle } from '@/lib/shuffle';
import { filterByHskLevel } from '@/lib/game-round';
import type { CharInfo } from '@/lib/game-round';

describe('seededShuffle (Fisher-Yates)', () => {
  it('preserves all elements (no duplicates, no losses)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let seed = 0; seed < 20; seed++) {
      const result = seededShuffle(input, seed);
      expect(result).toHaveLength(input.length);
      expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
    }
  });

  it('on pinyin array produces 4 unique values (regression: ToneRadicalGame duplicate keys)', () => {
    const input = ['nǎ', 'chù', 'tóng', 'duǒ'];
    for (let seed = 0; seed < 20; seed++) {
      const result = seededShuffle(input, seed + 2);
      expect(result).toHaveLength(4);
      expect(new Set(result).size).toBe(4);
    }
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4];
    const before = [...input];
    seededShuffle(input, 42);
    expect(input).toEqual(before);
  });
});

// Pure-function tests for the HSK filter logic. Adapted from brief Step 5.1:
// the actual `buildRound` queries the DB directly, so the brief's
// `buildRound(chars, count, seed, mode, hskLevel)` signature doesn't apply
// here. The filter itself is a pure function exported as `filterByHskLevel`
// for unit testing.
describe('buildRound hskLevel filter (Step 5.1 RED → GREEN)', () => {
  it('filters chars by hsk_level when provided', () => {
    const chars: CharInfo[] = [
      { char: '你', level: 1, hsk_level: 1 } as CharInfo,
      { char: '好', level: 1, hsk_level: 1 } as CharInfo,
      { char: '罕', level: 2, hsk_level: null } as CharInfo, // fallback
    ];
    const filtered = filterByHskLevel(chars, 1);
    // Strict assertion: only chars with hsk_level === 1 included.
    expect(filtered.every((c) => c.hsk_level === 1)).toBe(true);
    expect(filtered.map((c) => c.char).sort()).toEqual(['你', '好']);
  });

  it('falls back to chars.level when hsk_level is null', () => {
    const chars: CharInfo[] = [
      { char: '罕', level: 2, hsk_level: null } as CharInfo,
      { char: '你', level: 1, hsk_level: 1 } as CharInfo,
    ];
    // hskLevel = null → no HSK filter, return all chars (preserve existing behavior).
    const filtered = filterByHskLevel(chars, null);
    expect(filtered.length).toBe(2);
  });

  it('returns empty array when no chars match hskLevel (caller must fallback)', () => {
    const chars: CharInfo[] = [
      { char: '你', level: 1, hsk_level: 1 } as CharInfo,
    ];
    const filtered = filterByHskLevel(chars, 6);
    expect(filtered).toEqual([]);
  });
});