/**
 * Validation for generated idiom rows.
 *
 * The idioms in `data/idioms.json` are written by an AI model, so they are
 * the least trustworthy data this repository ships. Nothing downstream is
 * allowed to trust them: the importer validates every row before it reaches
 * the database, and the validator is the single place that decides what a
 * well-formed idiom row is.
 *
 * The rules, and why each one exists:
 *
 *  - **exactly four characters.** A 成语 is four characters by definition.
 *    Three-character idioms (三人成虎) and five-character ones (小巫见大巫)
 *    exist, but the game board is four slots wide, so the game only ships
 *    four-character ones. A row of any other length cannot be placed.
 *
 *  - **every character is a Chinese character.** A row containing a latin
 *    letter or a digit is corruption, not an idiom.
 *
 *  - **the reading has four entries.** One per character, in order. The
 *    game shows the reading of the character under the cursor, so a reading
 *    of the wrong length is a display bug, not a cosmetic one.
 *
 *  - **the reading uses no plain-vowel vowels.** The unmarked vowels a, e,
 *    i, o, u are what a dropped tone mark leaves behind (ma instead of má).
 *    Every syllable in a Mandarin reading carries a tone, so an unmarked
 *    vowel means the reading lost information. The exception is `ê` and the
 *    syllable `er`, neither of which is a problem here — `ê` is not a
 *    Mandarin reading and `er` is written with a plain `e`.
 *
 *  - **the meaning is not empty.** A row with no meaning gives the player
 *    nothing to learn.
 *
 *  - **the level is 1-4 and the category is known.** Both are used to group
 *    and filter the game's questions, so an unknown value would either be
 *    silently dropped from every filter or crash the grouping code.
 *
 * The validator returns every problem it finds rather than the first one, so
 * a bad batch can be fixed in one pass instead of one row per run.
 */

/** The categories an idiom row may carry. */
export const IDIOM_CATEGORIES = [
  '勤学',
  '品格',
  '情绪',
  '自然',
  '人事',
  '言语',
  '处境',
  '动作',
  '时间',
  '数量',
] as const;

export type IdiomCategory = (typeof IDIOM_CATEGORIES)[number];

/** One idiom as it appears in `data/idioms.json`. */
export interface IdiomRow {
  /** The four characters, e.g. "一帆风顺". */
  word: string;
  /** Space-separated tone-marked readings, one per character. */
  pinyin: string;
  /** A Chinese explanation of the meaning. */
  meaning: string;
  /** Difficulty, 1 (easiest) to 4 (literary). */
  level: number;
  /** The theme the idiom belongs to. */
  category: IdiomCategory | string;
}

/** One problem found in a row. */
export interface IdiomProblem {
  /** The word the problem belongs to, or '' when the row has no word. */
  word: string;
  /** What is wrong, in English, for the build log. */
  message: string;
}

/**
 * The characters a Chinese idiom is built from.
 *
 * The CJK Unified Ideographs block plus the extension A block, which covers
 * every character a standard idiom uses. `〇` (U+3007) is included because
 * it appears in 一举两得-style numerals written as characters.
 */
const HANZI_RE = /^[㐀-䶿一-鿿〇]+$/;

/**
 * The tone-marked vowels.
 *
 * Mandarin puts the tone mark on the NUCLEUS of a syllable, not on every
 * vowel in it: iè marks the `i` and leaves the `e` plain, qiú marks the `u`
 * and leaves the `i` plain, liàn marks the `a`. So a syllable "has a tone
 * mark" when it contains at least one of these — not when every vowel in it
 * is marked.
 */
const TONE_MARKED_VOWELS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';

/**
 * A syllable that carries no tone mark at all.
 *
 * Every Mandarin syllable carries a tone, so a syllable made only of plain
 * vowels is a reading that lost its mark (ma instead of má). The exception
 * is `er`, which is written with an unmarked `e` even in a toned form
 * (èr), and the neutral syllable `ê`.
 *
 * This checks for the PRESENCE of a marked vowel, not the absence of a
 * plain one. Checking for a plain vowel would reject every correct
 * multi-vowel syllable, because Mandarin never marks the off-glide: iè
 * would fail on its `e`, qiú on its `i`, liàn on its `n`-adjacent vowels.
 */
function hasToneMark(syllable: string): boolean {
  for (const char of syllable) {
    if (TONE_MARKED_VOWELS.includes(char)) return true;
  }
  return false;
}

/**
 * A syllable that should have carried a `ü` but was typed as `u` or `v`.
 *
 * On a keyboard without `ü`, `ü` is written as `v`: 女 is typed `nv`, 绿 as
 * `lv`. A model that generates a reading this way produces `nv` — and the
 * syllable has no marked vowel at all, so the tone check does not fire on
 * it. Worse, `ju`, `qu`, `xu` are *correct* readings whose `u` really is
 * an `ü`, so the check has to distinguish them rather than reject every
 * `u`.
 *
 * The rule: `j`, `q`, `x` plus a vowel is always an `ü` spelling, so it is
 * fine. Everywhere else, a bare `v` standing in for `ü` is a defect.
 */
function hasUnmarkedUmlaut(syllable: string): boolean {
  if (/^[jqx]/.test(syllable)) return false;
  return syllable.includes('v');
}

/**
 * Validate one row.
 *
 * Returns the problems found; an empty array means the row is well formed.
 */
export function validateIdiomRow(row: unknown): IdiomProblem[] {
  const problems: IdiomProblem[] = [];

  if (typeof row !== 'object' || row === null) {
    return [{ word: '', message: 'row is not an object' }];
  }
  const candidate = row as Partial<IdiomRow>;
  const word = typeof candidate.word === 'string' ? candidate.word : '';
  const report = (message: string): void => {
    problems.push({ word, message });
  };

  if (!word) {
    report('missing word');
  } else {
    if ([...word].length !== 4) {
      report(`word must have exactly 4 characters, has ${[...word].length}`);
    }
    if (!HANZI_RE.test(word)) {
      report('word contains a character that is not a Chinese character');
    }
  }

  const pinyin = typeof candidate.pinyin === 'string' ? candidate.pinyin.trim() : '';
  if (!pinyin) {
    report('missing pinyin');
  } else {
    const syllables = pinyin.split(/\s+/).filter(Boolean);
    if (syllables.length !== 4) {
      report(`pinyin must have 4 syllables, has ${syllables.length}`);
    }
    for (const syllable of syllables) {
      if (hasUnmarkedUmlaut(syllable)) {
        report(`pinyin syllable "${syllable}" writes ü as "v"`);
        continue;
      }
      if (!hasToneMark(syllable)) {
        report(`pinyin syllable "${syllable}" has no tone mark`);
      }
    }
  }

  const meaning = typeof candidate.meaning === 'string' ? candidate.meaning.trim() : '';
  if (!meaning) {
    report('missing meaning');
  }

  const level = candidate.level;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 4) {
    report(`level must be an integer from 1 to 4, got ${String(level)}`);
  }

  const category = typeof candidate.category === 'string' ? candidate.category : '';
  if (!IDIOM_CATEGORIES.includes(category as IdiomCategory)) {
    report(`category "${category}" is not one of the ${IDIOM_CATEGORIES.length} known categories`);
  }

  return problems;
}

/**
 * Validate a whole batch and drop the exact duplicates.
 *
 * Two agents working from the same list of well-known idioms will produce
 * the same idiom twice; the second copy is dropped rather than reported,
 * because a duplicate is not a defect in either row — it is a duplicate.
 *
 * The first occurrence wins, so the order of the file decides which copy is
 * kept, and the file stays stable across re-runs.
 */
export function validateIdiomBatch(rows: unknown): {
  valid: IdiomRow[];
  problems: IdiomProblem[];
  duplicates: string[];
} {
  if (!Array.isArray(rows)) {
    return { valid: [], problems: [{ word: '', message: 'batch is not an array' }], duplicates: [] };
  }

  const valid: IdiomRow[] = [];
  const problems: IdiomProblem[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const rowProblems = validateIdiomRow(row);
    if (rowProblems.length > 0) {
      problems.push(...rowProblems);
      continue;
    }
    const idiom = row as IdiomRow;
    if (seen.has(idiom.word)) {
      duplicates.push(idiom.word);
      continue;
    }
    seen.add(idiom.word);
    valid.push(idiom);
  }

  return { valid, problems, duplicates };
}
