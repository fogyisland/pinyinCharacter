/**
 * The 组词 reader — SERVER ONLY.
 *
 * `data/char-words.json` is 0.5 MB, so it is read from disk on demand and
 * kept, not imported: a client bundle would carry a whole dictionary for a
 * section that shows a handful of words.
 *
 * The table is the build product of `scripts/build-char-words.ts`:
 * `npm run dict:words`. See that script's header for why the floor is 500
 * and the cap 10 — 学 gets 学生 学院 大学 学校 学习 科学, which is what a
 * teacher writes on the board.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One word of a character's list. */
export interface WordEntry {
  word: string;
  pinyin: string;
  freq: number;
}

/** char → its words, most common first. */
export type WordTable = Record<string, WordEntry[]>;

/** The table, read once and kept. */
let cached: WordTable | null = null;

/** Read the table, or throw with a message that names the build command. */
function loadTable(): WordTable {
  if (cached) return cached;
  const path = join(process.cwd(), 'data', 'char-words.json');
  try {
    cached = JSON.parse(readFileSync(path, 'utf-8')) as WordTable;
    return cached;
  } catch (error) {
    throw new Error(
      `The word table could not be read from ${path}. Build it with \`npm run dict:words\`.`,
      { cause: error },
    );
  }
}

/**
 * The words a character appears in.
 *
 * Returns `[]` rather than throwing when the table has no entry for the
 * character — most characters have none at the shipped frequency floor, and
 * the page hides the section in that case. A MULTI-character "character"
 * (the dictionary only serves single characters) also returns `[]`.
 *
 * @param table the word table.
 * @param char one character.
 * @returns its words, most common first.
 */
export function getCharWords(table: WordTable, char: string): WordEntry[] {
  if (Array.from(char).length !== 1) return [];
  return table[char] ?? [];
}

/**
 * The words a character appears in, from the shipped table.
 *
 * @param char one character.
 * @returns its words; empty when the table knows none.
 */
export function wordsForChar(char: string): WordEntry[] {
  return getCharWords(loadTable(), char);
}

/** Drop the cache; a test that replaces the file needs this. */
export function __resetCharWordsCache(): void {
  cached = null;
}
