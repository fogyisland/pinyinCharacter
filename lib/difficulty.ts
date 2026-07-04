export type Difficulty = 'easy' | 'medium' | 'hard';
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

export type CharSource = 'chars-level-1' | 'chars-level-1-2' | 'chars-all';

export const DRAG_MATCH_CONFIG = {
  easy:   { count: 6, source: 'chars-level-1' as const },
  medium: { count: 8, source: 'chars-level-1-2' as const },
  hard:   { count: 12, source: 'chars-all' as const },
};

// 2026-07-03: added `source` so easy pulls only level-1 chars (simple,
// common — first graders' vocab) and hard pulls from all chars. The
// previous version used `count` only, so "hard" had the same character
// pool as "medium" and got boring / repetitive; combined with the
// higher count (6) it overflowed the pinyin-bank and produced invalid
// rounds. Mirrors the DRAG_MATCH_CONFIG pattern (3-tier source).
export const TONE_RADICAL_CONFIG = {
  easy:   { count: 3, source: 'chars-level-1' as const },
  medium: { count: 4, source: 'chars-level-1-2' as const },
  hard:   { count: 6, source: 'chars-all' as const },
};

// 2026-07-03: 拼音接龙 (pinyin solitaire) had no difficulty at all —
// the server always returned the same full pool and the game got very
// hard because rare chars (level 2+) break the chain (no matching next
// pinyin). Tier source by level so easy = common chars with many
// chain-able neighbors. `chainMinLen` is the early-stop threshold for
// short-game mode (optional, can be ignored by the server for now).
export const CHAIN_GAME_CONFIG = {
  easy:   { source: 'chars-level-1' as const },
  medium: { source: 'chars-level-1-2' as const },
  hard:   { source: 'chars-all' as const },
};

export const PINYIN_INPUT_CONFIG = {
  easy:   { maxCandidates: 3 },
  medium: { maxCandidates: 5 },
  hard:   { maxCandidates: 9 },
};

import type { HskLevel as _HskLevel } from './reveal';
// HskLevel re-export kept loose: importers can also import from lib/reveal directly.
export type HskLevel = _HskLevel;

export function sourceForHsk(level: HskLevel): CharSource {
  if (level === 1) return 'chars-level-1';
  if (level === 2 || level === 3) return 'chars-level-1-2';
  return 'chars-all';
}

export interface GameConfig {
  hskLevel?: HskLevel;
}
