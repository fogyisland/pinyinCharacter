export type Difficulty = 'easy' | 'medium' | 'hard';
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

export const DRAG_MATCH_CONFIG = {
  easy:   { count: 6, source: 'chars-level-1' as const },
  medium: { count: 8, source: 'chars-level-1-2' as const },
  hard:   { count: 12, source: 'chars-all' as const },
};

export const TONE_RADICAL_CONFIG = {
  easy:   { count: 3 },
  medium: { count: 4 },
  hard:   { count: 6 },
};

export const PINYIN_INPUT_CONFIG = {
  easy:   { maxCandidates: 3 },
  medium: { maxCandidates: 5 },
  hard:   { maxCandidates: 9 },
};
