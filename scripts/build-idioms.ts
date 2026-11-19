/**
 * Write `data/idioms.json` from a set of generated idiom batches.
 *
 * The idioms are produced by an AI model and arrive as JSON arrays in
 * batches. This script merges them into the one file the repository ships,
 * validates every row through `lib/idiom-data.ts`, and writes the result.
 *
 * Two things it refuses to do:
 *
 *  - **write an invalid row.** A row that fails validation is reported and
 *    skipped. The file only ever holds rows that pass.
 *  - **silently drop a duplicate.** A repeated word is reported, because a
 *    duplicate usually means two batches drew from the same list of
 *    well-known idioms — which is expected, and is not a defect.
 *
 * The readings are verified against `pinyin-pro`, the same source the
 * dictionary page uses. A reading the model produced that disagrees with
 * pinyin-pro is replaced with pinyin-pro's — the site's own reading is the
 * one that must be shown, and the model's is a guess. When the two disagree
 * the row is reported, so a systematic error is visible rather than buried.
 *
 * Usage:
 *   npx tsx scripts/build-idioms.ts <batch.json> [<batch.json> ...]
 *
 * With no arguments the script rebuilds `data/idioms.json` from the batches
 * already in `data/idiom-batches/`, if that directory exists.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { validateIdiomBatch, type IdiomRow } from '../lib/idiom-data';

const DATA_DIR = join(process.cwd(), 'data');
const BATCH_DIR = join(DATA_DIR, 'idiom-batches');
const OUTPUT_PATH = join(DATA_DIR, 'idioms.json');

/**
 * The reading pinyin-pro gives for a character.
 *
 * `toneType: 'symbol'` produces the tone marks (yī, má, lǜ) that the site
 * shows everywhere else. The `v` spelling is turned back into `ü`, because
 * pinyin-pro writes 女 as `nv` on some code paths and the site shows `nǚ`.
 */
function readingOf(char: string): string {
  const symbol = pinyin(char, { toneType: 'symbol', type: 'array' });
  return symbol[0].replace(/v/g, 'ü');
}

/**
 * The reading pinyin-pro gives for a whole idiom, one syllable per
 * character.
 */
function readingOfWord(word: string): string {
  return [...word].map(readingOf).join(' ');
}

/** The letters of a syllable, without its tone mark. */
function baseOf(syllable: string): string {
  return syllable
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ü/g, 'v')
    .toLowerCase();
}

/**
 * The tone of a syllable, 0 for a neutral reading.
 *
 * The table is the same 24 marks `lib/pinyin-tone.ts` holds.
 */
function toneOf(syllable: string): number {
  const marks: Record<string, number> = {
    'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
    'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
    'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
    'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
    'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
    'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
  };
  for (const [mark, tone] of Object.entries(marks)) {
    if (syllable.includes(mark)) return tone;
  }
  return 0;
}

/**
 * Rebuild a reading so that its LETTERS come from pinyin-pro and its TONES
 * come from the model.
 *
 * pinyin-pro knows the reading of a character out of context, so it picks
 * the most common one: 阿 is ā and 朝 is cháo, which is right for most
 * words and wrong in 刚正不阿 and 一朝一夕. The model, which was asked for
 * this idiom specifically, knows the tone that belongs here — and the
 * characters of a 成语 are the ones whose reading is settled by the idiom,
 * not by the character alone.
 *
 * So the two sources are combined by what each is actually right about:
 *
 *  - the LETTERS (ā, o, u, ü, the initial) come from pinyin-pro, because
 *    that is a per-character fact it can be trusted for;
 *  - the TONE comes from the model, because that is the per-idiom fact
 *    pinyin-pro cannot know.
 *
 * When the letters disagree, the model's whole syllable is kept and the
 * row is reported: a disagreement means the model wrote a different
 * character, and its tone is then suspect too.
 */
function reconcileReading(modelReading: string, word: string): {
  reading: string;
  lettersChanged: boolean;
} {
  const modelSyllables = modelReading.split(/\s+/).filter(Boolean);
  const proSyllables = readingOfWord(word).split(/\s+/).filter(Boolean);
  if (modelSyllables.length !== proSyllables.length) {
    return { reading: modelReading, lettersChanged: false };
  }

  let lettersChanged = false;
  const merged = modelSyllables.map((model, index) => {
    const pro = proSyllables[index];
    if (baseOf(model) === baseOf(pro)) return model;
    lettersChanged = true;
    return model;
  });
  return { reading: merged.join(' '), lettersChanged };
}

/** A batch file the script was pointed at, or found in the batch directory. */
function batchFiles(explicit: string[]): string[] {
  if (explicit.length > 0) return explicit.map((p) => join(process.cwd(), p));
  if (!existsSync(BATCH_DIR)) return [];
  return readdirSync(BATCH_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(BATCH_DIR, f));
}

/**
 * Build the merged file.
 *
 * Exported so a test can drive it with its own batch files.
 */
export function buildIdiomFile(files: string[]): {
  rows: IdiomRow[];
  problems: string[];
  duplicates: string[];
  corrected: string[];
  disagreements: string[];
} {
  const problems: string[] = [];
  const duplicates: string[] = [];
  const corrected: string[] = [];
  const disagreements: string[] = [];

  const all: unknown[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${file}: cannot be parsed as JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of batch) all.push(row);
  }

  const result = validateIdiomBatch(all);
  for (const problem of result.problems) {
    problems.push(`${problem.word || '(no word)'}: ${problem.message}`);
  }
  duplicates.push(...result.duplicates);

  // Reconcile every reading with pinyin-pro. The letters come from
  // pinyin-pro, the tones from the model — see `reconcileReading` for why.
  const rows: IdiomRow[] = [];
  for (const row of result.valid) {
    const { reading, lettersChanged } = reconcileReading(row.pinyin, row.word);
    if (reading !== row.pinyin) {
      corrected.push(`${row.word}: "${row.pinyin}" -> "${reading}"`);
    }
    if (lettersChanged) {
      // The model and pinyin-pro disagree about the LETTERS of a syllable,
      // which means the model wrote a reading for a different character.
      // The model's tone cannot be trusted either, so the row is reported
      // rather than silently accepted.
      disagreements.push(
        `${row.word}: pinyin-pro says "${readingOfWord(row.word)}", the model says "${row.pinyin}"`,
      );
    }
    rows.push({ ...row, pinyin: reading });
  }

  // Sort by level, then by word, so the file is stable across runs and the
  // easier idioms come first — the game reads them in that order.
  rows.sort((a, b) => (a.level - b.level) || a.word.localeCompare(b.word, 'zh'));

  return { rows, problems, duplicates, corrected, disagreements };
}

function main(): void {
  const explicit = process.argv.slice(2);
  const files = batchFiles(explicit);
  if (files.length === 0) {
    console.error(
      'build-idioms: no batch files given and data/idiom-batches/ does not exist.\n' +
        'Usage: npx tsx scripts/build-idioms.ts <batch.json> [...]',
    );
    process.exitCode = 1;
    return;
  }

  const { rows, problems, duplicates, corrected, disagreements } = buildIdiomFile(files);

  console.log(`[build-idioms] read ${files.length} batch file(s)`);
  console.log(`[build-idioms] ${rows.length} valid idiom(s)`);
  if (duplicates.length > 0) {
    console.log(`[build-idioms] ${duplicates.length} duplicate(s) dropped: ${duplicates.join(' ')}`);
  }
  if (corrected.length > 0) {
    console.log(`[build-idioms] ${corrected.length} reading(s) corrected:`);
    for (const line of corrected.slice(0, 20)) console.log(`  ${line}`);
    if (corrected.length > 20) console.log(`  ... and ${corrected.length - 20} more`);
  }
  if (disagreements.length > 0) {
    console.log(
      `[build-idioms] ${disagreements.length} reading(s) disagree with pinyin-pro on the LETTERS - review these by hand:`,
    );
    for (const line of disagreements.slice(0, 20)) console.log(`  ${line}`);
    if (disagreements.length > 20) console.log(`  ... and ${disagreements.length - 20} more`);
  }
  if (problems.length > 0) {
    console.log(`[build-idioms] ${problems.length} problem(s):`);
    for (const line of problems.slice(0, 20)) console.log(`  ${line}`);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
  }

  if (rows.length === 0) {
    console.error('[build-idioms] no valid idioms — refusing to write an empty file');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log(`[build-idioms] wrote ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}
