/**
 * charset.mjs
 *
 * Builds the character set that the ancient-script fonts must cover.
 *
 * Shared by scripts/fonts/subset-ancient-fonts.mjs (which subsets to it) and
 * scripts/fonts/verify-ancient-subsets.mjs (which proves the subset did not
 * lose any glyph). Keeping ONE builder for both is what makes the
 * verification meaningful — if the two scripts built their charsets
 * differently, the verifier would happily pass while the real site still
 * showed tofu.
 *
 * Sources, in order:
 *   scripts/fonts/gb2312-7000.txt — 7k common chars + latin + punctuation
 *   data/content/<char>.json      — every char in the dictionary
 *   data/era-coverage.json         — every char with an era glyph
 *   data/general-standard-chinese-characters.json — the full 通用规范汉字表
 *   data/poems/*.json              — the poem lines (rendered in 隶书 / 篆书)
 *
 * Why poems are in here, and why ONLY the poem lines:
 *   The poem viewer lets the reader switch the typeface to 隶书 or 篆书
 *   (components/poetry/PoemViewer.tsx → POEM_FONT_CSS), which are the very
 *   fonts we subset. Dropping the poem characters would leave those lines
 *   full of tofu — a visible regression versus the full TTF that used to be
 *   shipped. The title, the author and the 赏析 are rendered in Noto Serif
 *   SC, and the sutra / classic texts likewise (font-serif), so those
 *   corpora are deliberately NOT part of this charset: adding them would
 *   grow every subset by megabytes for glyphs nobody renders in these faces.
 *
 * Supplementary-plane chars are excluded: these fonts have no glyphs for
 * them anyway, and mysql2 corrupts them in queries (memory
 * mysql2-supp-plane-bug).
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const GLYPHS_FILE = resolve(__dirname, 'gb2312-7000.txt');
const CONTENT_DIR = resolve(ROOT, 'data', 'content');
const COVERAGE_FILE = resolve(ROOT, 'data', 'era-coverage.json');
const STANDARD_FILE = resolve(ROOT, 'data', 'general-standard-chinese-characters.json');
const POEMS_DIR = resolve(ROOT, 'data', 'poems');

/** True when the character lives in the BMP (and can be addressed by UTF-16). */
export function isBmp(ch) {
  const cp = ch.codePointAt(0);
  return cp != null && cp <= 0xffff;
}

/**
 * Add the poem lines of every data/poems/*.json to `chars`.
 *
 * Only the `content` array is used — those are the lines rendered with the
 * user-selectable typeface. A malformed file is reported and skipped, never
 * fatal: a broken corpus must not break the font pipeline.
 */
async function addPoemLines(chars) {
  if (!existsSync(POEMS_DIR)) {
    console.warn(`[charset] data/poems/ not found: ${POEMS_DIR} — skipping`);
    return;
  }
  let files;
  try {
    files = await readdir(POEMS_DIR);
  } catch (err) {
    console.warn(`[charset] cannot read data/poems/: ${err.message} — skipping`);
    return;
  }
  let count = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const poem = JSON.parse(await readFile(join(POEMS_DIR, file), 'utf8'));
      const lines = Array.isArray(poem?.content) ? poem.content : [];
      for (const line of lines) {
        if (typeof line !== 'string') continue;
        // Split into single characters — the set must hold CODE POINTS, not
        // whole lines, otherwise the verifier would only ever probe the
        // first character of every poem line.
        for (const ch of line) chars.add(ch);
      }
      count++;
    } catch (err) {
      console.warn(`[charset] skipping unreadable poem file ${file}: ${err.message}`);
    }
  }
  console.log(`[charset] data/poems: ${count} files (lines only)`);
}

/**
 * Build the full charset.
 * @returns {Promise<string[]>} BMP characters, deduplicated.
 */
export async function buildCharset() {
  const chars = new Set();

  if (!existsSync(GLYPHS_FILE)) {
    console.error(
      `[charset] missing ${GLYPHS_FILE} — run npx tsx scripts/fonts/build-gb2312-7000.ts first`,
    );
    process.exit(1);
  }
  for (const ch of await readFile(GLYPHS_FILE, 'utf8')) chars.add(ch);

  // Every char the dictionary can show.
  let contentFiles = [];
  try {
    contentFiles = await readdir(CONTENT_DIR);
  } catch {
    console.warn('[charset] data/content/ not found — using gb2312 charset only');
  }
  for (const file of contentFiles) {
    if (!file.endsWith('.json')) continue;
    const char = file.slice(0, -'.json'.length);
    if (char) chars.add(char);
  }
  console.log(`[charset] data/content: ${contentFiles.length} files`);

  // Every char with an era glyph.
  if (existsSync(COVERAGE_FILE)) {
    const coverage = JSON.parse(await readFile(COVERAGE_FILE, 'utf8'));
    for (const char of Object.keys(coverage)) chars.add(char);
    console.log(`[charset] data/era-coverage.json: ${Object.keys(coverage).length} chars`);
  } else {
    console.warn('[charset] data/era-coverage.json not found — skipping');
  }

  // The full 通用规范汉字表 — 200 of these 8105 chars have no content JSON
  // yet but DO exist in the chars table, so /etymology/<char> can request
  // them and they must still render.
  if (existsSync(STANDARD_FILE)) {
    const standard = JSON.parse(await readFile(STANDARD_FILE, 'utf8'));
    for (const char of standard) chars.add(char);
    console.log(`[charset] 通用规范汉字表: ${standard.length} chars`);
  } else {
    console.warn('[charset] data/general-standard-chinese-characters.json not found — skipping');
  }

  // The poem lines — the only body text rendered in these faces.
  await addPoemLines(chars);

  const kept = [...chars].filter((ch) => isBmp(ch));

  // Every element must be exactly ONE code point. A stray multi-character
  // string would silently narrow the verification (only the first character
  // would ever be probed), so fail loudly instead.
  const bad = kept.find((ch) => [...ch].length !== 1);
  if (bad) {
    console.error(`[charset] charset contains a multi-character entry: ${JSON.stringify(bad)}`);
    process.exit(1);
  }

  return kept;
}
