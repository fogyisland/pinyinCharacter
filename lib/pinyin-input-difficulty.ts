import { PINYIN_INPUT_CONFIG, type Difficulty } from './difficulty';

export function applyDifficulty<T>(candidates: T[], difficulty: Difficulty): T[] {
  return candidates.slice(0, PINYIN_INPUT_CONFIG[difficulty].maxCandidates);
}
