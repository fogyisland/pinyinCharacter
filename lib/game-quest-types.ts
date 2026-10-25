/**
 * The quest level + question contract.
 *
 * These types are the boundary between the data layer (which resolves the raw
 * per-char facts) and the pure builder in lib/game-quest.ts. Nothing here
 * imports anything: the types are shared by the server routes, the client UI
 * and the unit tests.
 */

export type QuestQuestionKind = 'pinyin' | 'tone' | 'radical' | 'meaning';

export interface QuestQuestion {
  kind: QuestQuestionKind;
  options: string[];
  answerIndex: number;
}

/** One char's raw facts, as the data layer resolved them. */
export interface QuestCharFact {
  char: string;
  /** Tone-marked reading, e.g. "ài". */
  reading: string;
  radical: string;
  /** The full `dict.meaning_zh` phrase (one string, not a list). */
  meaningZh: string;
  /** Alternate readings, tone-marked, e.g. ["bù", "fǒu"]. */
  pinyinAlt: string[];
  hasStory: boolean;
}

export interface QuestSyllable {
  syllable: string;
  /** '' for a 零声母 syllable. */
  initial: string;
  /** Toneless final. */
  final: string;
}

/** Everything the question builders need about one HSK tier. */
export interface QuestTier {
  tier: number;
  /** Rows in the tier, before eligibility filtering. */
  tierSize: number;
  /** Chars dropped from the eligible pool. */
  skipped: number;
  /** The eligible pool, swept and sliced into levels of 5. */
  levels: QuestCharFact[][];
  /** The tier's plain-syllable vocabulary, sorted alphabetically. */
  syllables: QuestSyllable[];
  /** The tier's radical vocabulary, sorted by code point. */
  radicals: string[];
  /**
   * The tier's meaning-clause pool, in the tier's row order.
   *
   * Only clauses of **at least 2 characters** enter the pool: a 1-character
   * clause (e.g. 视's 看) cannot be a ④ distractor, because ④'s survival
   * filter requires `candidate.length >= 2`. The pool and the ④ candidate
   * list therefore share the same ≥2-character rule and produce identical
   * candidate lists.
   */
  clauses: string[];
}

/** One char as the API returns it. */
export interface QuestCharPayload {
  char: string;
  pinyin: string;
  plainPinyin: string;
  tone: 1 | 2 | 3 | 4;
  toneName: string;
  radical: string;
  meaningZh: string;
  meaningShort: string;
  hasStory: boolean;
  questions: QuestQuestion[];
}

export interface QuestLevelPayload {
  hsk: number;
  level: number;
  levelCount: number;
  tierSize: number;
  skipped: number;
  chars: QuestCharPayload[];
}
