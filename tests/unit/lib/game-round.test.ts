import { describe, it, expect } from 'vitest';
import { seededShuffle } from '@/lib/shuffle';

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