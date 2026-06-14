import { describe, it, expect } from 'vitest';
import { applyDifficulty } from '@/lib/pinyin-input-difficulty';
import { PINYIN_INPUT_CONFIG } from '@/lib/difficulty';

describe('applyDifficulty', () => {
  it('easy: limits to 3 candidates', () => {
    const out = applyDifficulty(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'}],
      'easy',
    );
    expect(out).toHaveLength(3);
    expect(out.map(c => c.char)).toEqual(['a','b','c']);
  });

  it('medium: limits to 5 candidates', () => {
    const out = applyDifficulty(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'},{char:'f'},{char:'g'}],
      'medium',
    );
    expect(out).toHaveLength(5);
  });

  it('hard: returns all up to 9 (does not slice below 9)', () => {
    const out = applyDifficulty(
      Array.from({length: 12}, (_, i) => ({char: String(i)})),
      'hard',
    );
    expect(out).toHaveLength(9);
  });

  it('PINYIN_INPUT_CONFIG matches mapping', () => {
    expect(PINYIN_INPUT_CONFIG.easy.maxCandidates).toBe(3);
    expect(PINYIN_INPUT_CONFIG.medium.maxCandidates).toBe(5);
    expect(PINYIN_INPUT_CONFIG.hard.maxCandidates).toBe(9);
  });
});
