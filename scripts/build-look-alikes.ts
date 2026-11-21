/**
 * Build the 形近字 (look-alike) table.
 *
 * ## Why a build product
 *
 * Comparing every pair of the 3500 一级字 is 1.5 million stroke-matrix
 * comparisons — 1.9 s with the signature prefilter, ~11 minutes without it.
 * Either way it does not belong on a page request, so the table is computed
 * once and shipped as data.
 *
 * ## Source of characters
 *
 * `data/general-standard-chinese-characters.json` (8105 characters, sorted).
 * Only the first 3500 (通用规范 一级字) take part: a learner does not confuse
 * 未 with 耒, and the rare characters would drown the lists in noise.
 *
 * ## What it writes
 *
 *     data/look-alikes.json   { "未": ["末","朱","米",...], ... }
 *
 * Plain strings, not objects: the detail page only needs the names, and the
 * comparison numbers are recomputed live for the two characters on screen
 * (they are milliseconds). The build's numbers were only used to decide
 * WHICH pairs belong in the list.
 *
 * ## Measured
 *
 *   3500 characters (all have stroke data) → ~2200 chars with look-alikes,
 *   3865 entries, 23 KB, 1.9 s.
 *
 * ## Running it
 *
 *     npm run lookalike:build
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLookAlikeTable,
  prepareChar,
  type PreparedChar,
  type Stroke,
} from '../lib/look-alike';

/** Where the stroke data lives. */
const STROKE_DIR = join(process.cwd(), 'public', 'strokes');

/** Where the standard character table lives. */
const STANDARD_FILE = join(process.cwd(), 'data', 'general-standard-chinese-characters.json');

/** Where the look-alike table is written. */
const OUTPUT_FILE = join(process.cwd(), 'data', 'look-alikes.json');

/** How many of the standard table's characters take part (一级字). */
const LEVEL1_COUNT = 3500;

/**
 * Load the 一级字 that have stroke data.
 *
 * A character without stroke data cannot be compared, and silently skipping
 * it is correct: the table is an index, not a claim that the character has
 * no look-alikes.
 */
export function loadLevel1Chars(): Array<{ char: string; strokes: Stroke[] }> {
  const standard = JSON.parse(readFileSync(STANDARD_FILE, 'utf-8')) as string[];
  const level1 = standard.slice(0, LEVEL1_COUNT);
  const available = new Set(
    readdirSync(STROKE_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', '')),
  );
  const out: Array<{ char: string; strokes: Stroke[] }> = [];
  for (const char of level1) {
    if (!available.has(char)) continue;
    const raw = JSON.parse(
      readFileSync(join(STROKE_DIR, `${char}.json`), 'utf-8'),
    ) as { medians: Stroke[] };
    if (Array.isArray(raw.medians) && raw.medians.length > 0) {
      out.push({ char, strokes: raw.medians });
    }
  }
  return out;
}

/**
 * Build the table from prepared characters and return the JSON-ready shape.
 *
 * Kept separate from `main` so a test can drive it with a handful of
 * characters instead of the whole corpus.
 *
 * @param corpus prepared characters.
 * @returns plain `char → [look-alike char]` plus the build statistics.
 */
export function buildTableJson(corpus: readonly PreparedChar[]): {
  table: Record<string, string[]>;
  characters: number;
  entries: number;
  pairsMeasured: number;
  pairsConsidered: number;
} {
  const { table, pairsMeasured, pairsConsidered } = buildLookAlikeTable(corpus);
  const plain: Record<string, string[]> = {};
  let entries = 0;
  for (const [char, list] of Object.entries(table)) {
    plain[char] = list.map((entry) => entry.char);
    entries += plain[char].length;
  }
  return {
    table: plain,
    characters: Object.keys(plain).length,
    entries,
    pairsMeasured,
    pairsConsidered,
  };
}

function main(): void {
  const started = Date.now();
  const chars = loadLevel1Chars();
  console.log(`loaded ${chars.length} 一级字 with stroke data`);

  const prepared = chars.map((entry) => prepareChar(entry.char, entry.strokes));
  const result = buildTableJson(prepared);

  const json = JSON.stringify(result.table);
  writeFileSync(OUTPUT_FILE, json, 'utf-8');

  const seconds = (Date.now() - started) / 1000;
  console.log(`\ncompared ${result.pairsMeasured} of ${result.pairsConsidered} candidate pairs`);
  console.log(`${result.characters} characters, ${result.entries} entries`);
  console.log(`Written to ${OUTPUT_FILE} (${(json.length / 1024).toFixed(0)} KB) in ${seconds.toFixed(1)}s`);

  // Spot checks: pairs a teacher would expect.
  for (const [char, expected] of [
    ['未', '末'],
    ['己', '已'],
    ['土', '士'],
    ['大', '太'],
    ['木', '本'],
    ['干', '千'],
  ] as Array<[string, string]>) {
    const list = result.table[char] ?? [];
    const present = list.includes(expected);
    console.log(`  ${char}: ${list.slice(0, 8).join(' ')}${present ? '' : `   <-- MISSING ${expected}`}`);
  }
}

// Run only when this file IS the entry point: a test that imports the
// helpers must not scan the corpus.
const entry = process.argv[1] ?? '';
if (entry.endsWith('build-look-alikes.ts') || entry.endsWith('build-look-alikes.js')) {
  main();
}
