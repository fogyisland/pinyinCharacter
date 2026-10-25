import { describe, it, expect } from 'vitest';
import { seededShuffle } from '@/lib/shuffle';

describe('seededShuffle — the §0 #8 PRNG repair', () => {
  it('spreads the answer across all four slots (regression: 99.9% in slot 3)', () => {
    const counts = [0, 0, 0, 0];
    for (let seed = 0; seed < 500; seed++) {
      const out = seededShuffle(['correct', 'w1', 'w2', 'w3'], seed);
      counts[out.indexOf('correct')]! += 1;
    }
    // Each slot ≥ 10% of the 500 combinations.
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(50);
  });

  it('is a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    const before = [...input];
    const out = seededShuffle(input, 42);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
    expect(input).toEqual(before);
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect(seededShuffle(input, 7)).toEqual(seededShuffle(input, 7));
    expect(seededShuffle(input, 7)).not.toEqual(seededShuffle(input, 8));
  });
});
