import type { QuestCharPayload } from '@/lib/game-quest-types';
import type { CharSnapshot } from '@/lib/game-progress';

/**
 * The React-free helpers of the quest flow.
 *
 * They live here so the runner component stays a component: the reveal rule
 * is a pure function of the round's shape, and it is the load-bearing detail
 * of the whole mode (spec §7.2) - the pinyin stays off the char card until
 * ② is answered, because ②'s four options are the four tone forms of
 * exactly that syllable.
 */

/** The kind of a round - the first pass over the level, or the remediation. */
export type QuestRoundKind = 'main' | 'remediation';

/** The part of a round the reveal rule reads. */
export interface QuestRevealRound {
  kind: QuestRoundKind;
  /** For each char: the original question indices this round asks, in order. */
  questionIndices: number[][];
  /** For each char: how many of its round questions are already answered. */
  answeredCounts: number[];
}

/** Which facets of the char card may be shown right now. */
export interface Facets {
  pinyin: boolean;
  radical: boolean;
  meaning: boolean;
}

/** The fields a char contributes to both books - the collection book adds the story flag. */
export function charSnapshot(char: QuestCharPayload): CharSnapshot {
  return {
    pinyin: char.pinyin,
    plainPinyin: char.plainPinyin,
    tone: char.tone,
    toneName: char.toneName,
    radical: char.radical,
    meaningShort: char.meaningShort,
  };
}

/** ① and ② both test the pinyin - ②'s options are the four tone forms of that syllable. */
export function testsPinyin(questionIndex: number): boolean {
  return questionIndex === 0 || questionIndex === 1;
}

export function testsRadical(questionIndex: number): boolean {
  return questionIndex === 2;
}

export function testsMeaning(questionIndex: number): boolean {
  return questionIndex === 3;
}

/**
 * The reveal rule (§7.2) - a facet is hidden while a pending question in the
 * current round tests it.
 */
export function revealedFacets(
  charIndex: number,
  questionIndex: number,
  round: QuestRevealRound,
): Facets {
  const indices = round.questionIndices[charIndex] ?? [];
  // Everything before the current question is answered; the current one
  // counts as pending until the learner has answered it.
  const answeredCount = Math.max(round.answeredCounts[charIndex] ?? 0, questionIndex);
  const pending = indices.slice(answeredCount);
  let pinyin = !pending.some(testsPinyin);
  const radical = !pending.some(testsRadical);
  const meaning = !pending.some(testsMeaning);
  if (round.kind === 'remediation' && indices.some(testsPinyin)) {
    // A remediation round re-hides the facet it re-tests.
    pinyin = false;
  }
  return { pinyin, radical, meaning };
}
