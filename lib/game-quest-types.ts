/**
 * The quest level + question contract.
 *
 * These types are the boundary between the data layer (which resolves the raw
 * per-char facts) and the pure builder in lib/game-quest.ts. Nothing here
 * imports anything: the types are shared by the server routes, the client UI
 * and the unit tests.
 */

export type QuestQuestionKind = 'pinyin' | 'tone' | 'radical' | 'meaning';

/**
 * The error code for "this HSK tier has no chars at all".
 *
 * ## Why this code exists
 *
 * `chars.hsk_level` is not filled by a migration — it is filled by
 * `scripts/import-hsk.ts`, a separate script that DEPLOY.md §9 lists as a
 * mandatory first-deployment step. A deployment that ships the code without
 * running it leaves every `hsk_level` NULL, so a query for one tier returns
 * zero rows.
 *
 * Without this code the two very different failures of a tier load look the
 * same:
 *
 *   - the tier is empty (a deployment step was skipped) — the fix is one
 *     command, and it is the same for every level of every tier;
 *   - the level is beyond the tier's level count (the char pool grew and the
 *     level moved) — the fix is to pick another level.
 *
 * The first is a **503**: the server is fine, its data is not ready, and a
 * retry will succeed once the import has run. The second stays a **404**:
 * that level will never come back for this process.
 *
 * Both codes are declared here because the server routes and the client
 * components share this module — it imports nothing, so both sides can use it.
 */
export const HSK_LEVELS_NOT_IMPORTED = 'hsk_level_not_imported';

/**
 * The message the server sends with {@link HSK_LEVELS_NOT_IMPORTED}.
 *
 * It names the command that fixes it, because the reader of this message is
 * an operator (or a learner who is reporting the problem), and "the tier is
 * empty" on its own is not actionable.
 */
export const HSK_LEVELS_NOT_IMPORTED_MESSAGE =
  '这一层的汉字还没有导入 —— 服务器上缺少 HSK 分级数据。请在服务器上运行：npx tsx scripts/import-hsk.ts';

/**
 * The Chinese text the client shows for {@link HSK_LEVELS_NOT_IMPORTED}.
 *
 * The learner cannot fix it either, so the text says who can — an
 * administrator — instead of pretending a retry would help.
 */
export const HSK_LEVELS_NOT_IMPORTED_TEXT =
  '这一层还没有汉字 —— 需要管理员先导入 HSK 分级数据，请稍后再试';

/**
 * Whether a tier holds no chars at all.
 *
 * `tierSize` is the number of rows the tier was built from, before the
 * eligibility filter. A tier of zero means the **query** returned nothing —
 * not that every char was filtered out (that would leave `tierSize > 0` with
 * `skipped === tierSize`).
 *
 * The distinction matters: "the tier is empty" has one cause and one fix,
 * while "every char of this tier is ineligible" is a content problem that
 * the import command does not solve.
 */
export function isHskTierEmpty(tier: { tierSize: number }): boolean {
  return tier.tierSize === 0;
}

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
   * filter requires `candidate.length >= 2`.
   *
   * The pool is a **superset** of ④'s candidate list — ④ additionally drops
   * the clause that contains the char itself and the ones that share a
   * 2-gram with it. (`scripts/verify-quest-numbers.mjs` does NOT apply the
   * ≥2-character rule to its own pool, so it prints 150 clauses where this
   * pool holds 149; the difference is 视's 看.)
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
