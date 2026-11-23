/**
 * 例句 reader — SERVER ONLY.
 *
 * `data/examples.json` is 691 KB, so it is read from disk on demand and kept
 * rather than imported: a client bundle would carry a corpus for a list of
 * two sentences.
 *
 * The file is the build product of `scripts/build-examples.py`:
 * `npm run examples:build`. See that script's header for the source
 * (Tatoeba, CC-BY 2.0 FR) and the filters (English translation required,
 * simplified characters only, 6–30 characters).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One example pair. */
export interface ExampleEntry {
  zh: string;
  en: string;
}

/** word → its example sentences, shortest first. */
export type ExampleTable = Record<string, ExampleEntry[]>;

/** The table, read once and kept. */
let cached: ExampleTable | null = null;

/**
 * Read the table, or throw with a message that names the build command.
 */
function loadTable(): ExampleTable {
  if (cached) return cached;
  const path = join(process.cwd(), 'data', 'examples.json');
  try {
    cached = JSON.parse(readFileSync(path, 'utf-8')) as ExampleTable;
    return cached;
  } catch (error) {
    throw new Error(
      `The example table could not be read from ${path}. Build it with \`npm run examples:build\`.`,
      { cause: error },
    );
  }
}

/**
 * The example sentences for a word.
 *
 * Returns `[]` for a single character: the dictionary asks for WORDS, and a
 * single character matches hundreds of sentences, none of them illustrative.
 *
 * @param table the example table.
 * @param word a 组词 word (2–4 characters).
 * @returns the sentences, shortest first; empty when there are none.
 */
export function getExamples(table: ExampleTable, word: string): ExampleEntry[] {
  if (Array.from(word).length < 2) return [];
  return table[word] ?? [];
}

/**
 * The example sentences for a word, from the shipped table.
 *
 * @param word a 组词 word.
 */
export function examplesForWord(word: string): ExampleEntry[] {
  return getExamples(loadTable(), word);
}

/** Drop the cache; a test that replaces the file needs this. */
export function __resetExamplesCache(): void {
  cached = null;
}
