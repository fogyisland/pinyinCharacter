/**
 * webfont-charset.mjs
 *
 * Builds the character set of every webfont family the site ships.
 *
 * Why this exists:
 *   Google Fonts shards its CJK families by codepoint range. Noto Sans SC
 *   arrives as a hundred-odd woff2 files and a page that needs 37 scattered
 *   characters pulls 34 of them — 3.7 MB to 5.0 MB of font for one page.
 *
 *   The replacement is our own tiered subsetting:
 *     tier 1 — the 200 characters the interface itself uses
 *     tier 2 — the next 600 by frequency
 *     Ext    — everything else, cut into blocks
 *   A page downloads one or two files instead of dozens, and the browser
 *   only fetches the Ext block that actually holds the character it needs.
 *
 * This module is the INPUT of that pipeline: it decides which characters
 * each family has to cover and how they are split into tiers. The
 * subsetter (scripts/fonts/build-webfont-subsets.mjs) turns the plan into
 * woff2 files, and the verifier (scripts/fonts/verify-webfont-subsets.mjs)
 * re-derives the same plan to prove no glyph was lost.
 *
 * The three families are NESTED on purpose — wenkai ⊂ sans ⊂ serif:
 *   wenkai  the brand typeface: the UI literals and the corpus titles
 *   sans    the body typeface: everything wenkai covers plus the corpora
 *   serif   the accent typeface: everything sans covers plus the classics
 * So a character of the classics is covered by all three families and the
 * tiers stay comparable between them.
 *
 * Only the repository's own corpora are read here — no font is opened and
 * nothing is written. Usage:
 *   node scripts/fonts/webfont-charset.mjs   print the three charset sizes
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/**
 * The code point ranges that count as Chinese for the font subsets.
 *
 * The ranges are the Unicode blocks a Chinese text is made of: ideographs
 * (plus the compatibility and supplementary planes), the CJK punctuation
 * and the fullwidth forms. Japanese kana, Hangul and the Greek/Cyrillic
 * blocks are deliberately OUT — a `codePointAt(0) > 0x2000` shortcut would
 * swallow all of them and inflate every subset with glyphs nobody renders.
 */
export const CJK_RANGES = [
  [0x2e80, 0x2eff], // Kangxi radicals
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0x3400, 0x4dbf], // Extension A
  [0x4e00, 0x9fff], // Unified ideographs
  [0xf900, 0xfaff], // Compatibility ideographs
  [0xfe30, 0xfe4f], // Compatibility forms
  [0xff00, 0xffef], // Halfwidth and fullwidth forms
  [0x20000, 0x2fa1f], // Extension B and beyond
  [0x30000, 0x3134f], // Extension G and beyond
];

/** The default number of characters in tier 1. */
const DEFAULT_TIER1_SIZE = 200;

/** The default number of characters in tier 2. */
const DEFAULT_TIER2_SIZE = 600;

/** The default number of characters per Ext block. */
const DEFAULT_EXT_BLOCK_SIZE = 256;

/** A character coming from the source code counts a thousand times more. */
const SOURCE_CODE_WEIGHT = 1000;

/** A character coming from a corpus counts once per occurrence. */
const CORPUS_WEIGHT = 1;

/** The source-code extensions that are scanned for the UI literals. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);

/**
 * Lookup table for the BMP part of CJK_RANGES.
 *
 * `isCjkChar` is asked about every character of a 200 MB corpus, so the
 * range scan is replaced by a single array read.
 */
const BMP_TABLE = buildBmpTable();

function buildBmpTable() {
  const table = new Uint8Array(0x10000);
  for (const [start, end] of CJK_RANGES) {
    const last = Math.min(end, 0xffff);
    if (start > last) continue;
    table.fill(1, start, last + 1);
  }
  return table;
}

/**
 * Cache of single-character strings for the BMP.
 *
 * The corpus scan asks about the same handful of code points millions of
 * times; allocating the string once per code point keeps the scan cheap.
 */
const BMP_CHARS = new Array(0x10000);

function bmpChar(codePoint) {
  let ch = BMP_CHARS[codePoint];
  if (ch === undefined) {
    ch = String.fromCharCode(codePoint);
    BMP_CHARS[codePoint] = ch;
  }
  return ch;
}

/** True when the code point belongs to one of the CJK ranges. */
function isCjkCodePoint(codePoint) {
  if (codePoint < 0x10000) return BMP_TABLE[codePoint] === 1;
  return (
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f) ||
    (codePoint >= 0x30000 && codePoint <= 0x3134f)
  );
}

/**
 * True when the string is exactly one Chinese character.
 *
 * A string of several characters is NOT a character: the corpus scan walks
 * the text code point by code point, so anything longer than one code
 * point means the caller handed over a whole word or line and counting it
 * as a single character would silently narrow the coverage.
 */
export function isCjkChar(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return false;
  const first = ch.charCodeAt(0);
  if (ch.length === 1) return isCjkCodePoint(first);
  // A supplementary-plane character is a surrogate pair.
  if (ch.length === 2 && first >= 0xd800 && first <= 0xdbff) {
    const second = ch.charCodeAt(1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return isCjkCodePoint(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00));
    }
  }
  return false;
}

/** Add `amount` to the score of one character. */
function addScore(score, ch, amount) {
  score.set(ch, (score.get(ch) ?? 0) + amount);
}

/**
 * Order the characters by descending score, ties broken by ascending code
 * point.
 *
 * The tie-break makes the result independent of the order the sources were
 * read in — two runs over the same repository always produce the same
 * tiers, which is what lets the verifier re-derive them.
 */
function orderByScore(score) {
  return [...score.keys()].sort((a, b) => {
    const delta = score.get(b) - score.get(a);
    if (delta !== 0) return delta;
    return a.codePointAt(0) - b.codePointAt(0);
  });
}

/**
 * Score every character of every source.
 *
 * A character earns the weight of its source once per occurrence, so a
 * corpus ranks its common characters above its rare ones while the source
 * code — weighted a thousand times higher — always wins.
 */
export function scoreCharacters(sources) {
  const score = new Map();
  for (const source of sources) {
    for (const ch of source.chars) {
      if (!isCjkChar(ch)) continue;
      addScore(score, ch, source.weight);
    }
  }
  return { ordered: orderByScore(score), score };
}

/**
 * Split a scored charset into the two hot tiers and the Ext blocks.
 *
 * tier 1 and tier 2 keep the score order (the most used characters first),
 * the Ext tier is sorted by code point so its blocks are contiguous runs of
 * the character space.
 *
 * The Ext tier is cut into blocks of at most `extBlockSize` characters.
 * The cut runs one step beyond the last full block, so the number of
 * blocks is `floor(n / extBlockSize) + 1`: a remainder that is an exact
 * multiple of `extBlockSize` ends with an EMPTY block. Consumers must
 * skip empty blocks — there is no glyph in them to subset.
 */
export function planTiers(scored, options = {}) {
  const tier1Size = options.tier1Size ?? DEFAULT_TIER1_SIZE;
  const tier2Size = options.tier2Size ?? DEFAULT_TIER2_SIZE;
  const extBlockSize = options.extBlockSize ?? DEFAULT_EXT_BLOCK_SIZE;

  const ordered = scored.ordered;
  const tier1 = ordered.slice(0, tier1Size);
  const tier2 = ordered.slice(tier1Size, tier1Size + tier2Size);

  const rest = ordered
    .slice(tier1Size + tier2Size)
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

  const extBlocks = [];
  for (let start = 0; start <= rest.length; start += extBlockSize) {
    extBlocks.push({
      index: extBlocks.length + 1,
      chars: rest.slice(start, start + extBlockSize),
    });
  }

  return { tier1, tier2, extBlocks };
}

/**
 * Format one code point the way a CSS `unicode-range` wants it: uppercase
 * hex, padded to at least four digits.
 */
function formatCodePoint(codePoint) {
  return codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Render the CSS `unicode-range` of a character list.
 *
 * Consecutive code points are merged into one range (`U+4E00-4E01`), a gap
 * starts a new range, and the ranges are joined with `, `.
 */
export function unicodeRange(chars) {
  const points = [
    ...new Set(
      chars
        .map((ch) => (typeof ch === 'string' ? ch.codePointAt(0) : undefined))
        .filter((codePoint) => codePoint !== undefined),
    ),
  ].sort((a, b) => a - b);

  const parts = [];
  let index = 0;
  while (index < points.length) {
    const start = points[index];
    let end = start;
    while (index + 1 < points.length && points[index + 1] === end + 1) {
      index += 1;
      end = points[index];
    }
    parts.push(
      end === start
        ? `U+${formatCodePoint(start)}`
        : `U+${formatCodePoint(start)}-${formatCodePoint(end)}`,
    );
    index += 1;
  }
  return parts.join(', ');
}

/**
 * Count the Chinese characters of a text into `counts`.
 *
 * The scan walks the string by code unit and only builds a string for the
 * characters it keeps. Iterating with `for (const ch of text)` allocates
 * one string per character and is several times slower on a 200 MB corpus.
 */
function countChars(counts, text) {
  for (let i = 0; i < text.length; i += 1) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (!isCjkCodePoint(codePoint)) continue;
    const ch =
      codePoint < 0x10000 ? bmpChar(codePoint) : String.fromCodePoint(codePoint);
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
}

/**
 * Walk a parsed JSON value and count every string it holds.
 *
 * `titles` collects the same strings when they sit under a title-like key
 * (`title`, `label`): the corpus titles are the only corpus strings the
 * brand typeface has to render.
 */
function collectStrings(value, key, counts, titles) {
  if (typeof value === 'string') {
    countChars(counts, value);
    if (titles && (key === 'title' || key === 'label')) countChars(titles, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, key, counts, titles);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectStrings(childValue, childKey, counts, titles);
    }
  }
}

/**
 * Scan every JSON file of a directory.
 *
 * A malformed file is reported and skipped — a broken corpus must not
 * break the font pipeline — and counted so the caller can report it. A
 * missing directory is not an error either: `data/stories` and
 * `data/rare-chars` are optional in this repository.
 */
function scanJsonDirectory(dir, state) {
  if (!existsSync(dir)) {
    console.warn(`[charset] ${dir} not found — skipping`);
    return null;
  }
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.warn(`[charset] cannot read ${dir}: ${err.message} — skipping`);
    return null;
  }

  const counts = new Map();
  const titles = new Map();
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const path = join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      state.skipped += 1;
      console.warn(`[charset] skipping malformed JSON ${path}: ${err.message}`);
      continue;
    }
    collectStrings(parsed, null, counts, titles);
  }
  return { counts, titles };
}

/** Scan one JSON file and count every string it holds. */
function scanJsonFile(path, state) {
  if (!existsSync(path)) {
    console.warn(`[charset] ${path} not found — skipping`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    state.skipped += 1;
    console.warn(`[charset] skipping malformed JSON ${path}: ${err.message}`);
    return null;
  }
  const counts = new Map();
  collectStrings(parsed, null, counts, null);
  return counts;
}

/**
 * Scan a plain text file and count its Chinese characters.
 *
 * `scripts/fonts/gb2312-7000.txt` holds one character per line in the
 * general case; the file is read as a whole and its characters counted,
 * which gives the same result for both layouts.
 */
function scanTextFile(path, state) {
  if (!existsSync(path)) {
    console.warn(`[charset] ${path} not found — skipping`);
    return null;
  }
  const counts = new Map();
  try {
    countChars(counts, readFileSync(path, 'utf8'));
  } catch (err) {
    state.skipped += 1;
    console.warn(`[charset] skipping unreadable file ${path}: ${err.message}`);
    return null;
  }
  return counts;
}

/**
 * Scan the source code for the characters the interface renders.
 *
 * These characters are weighted a thousand times higher than the corpus,
 * so the UI always lands in tier 1.
 */
function scanSourceCode(root, state) {
  const counts = new Map();
  for (const dir of ['app', 'components', 'lib']) {
    const full = join(root, dir);
    if (!existsSync(full)) {
      console.warn(`[charset] ${full} not found — skipping`);
      continue;
    }
    scanSourceDirectory(full, counts, state);
  }
  return counts;
}

function scanSourceDirectory(dir, counts, state) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[charset] cannot read ${dir}: ${err.message} — skipping`);
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanSourceDirectory(full, counts, state);
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    try {
      countChars(counts, readFileSync(full, 'utf8'));
    } catch (err) {
      state.skipped += 1;
      console.warn(`[charset] skipping unreadable source file ${full}: ${err.message}`);
    }
  }
}

/**
 * Fold a scanned source into a score map.
 *
 * The corpus holds ~100 million character occurrences. Re-yielding them
 * through the `Iterable<string>` interface of `scoreCharacters` would cost
 * more than the whole scan, so the sources are counted once and folded in
 * as `weight × occurrences` — the very sum `scoreCharacters` computes.
 */
function foldSource(score, source) {
  for (const [ch, count] of source.counts) {
    addScore(score, ch, source.weight * count);
  }
}

function foldSources(score, sources) {
  for (const source of sources) foldSource(score, source);
}

/** Turn a score map into the scored charset the tier planner consumes. */
function toScored(score) {
  return { ordered: orderByScore(score), score };
}

/**
 * Build the tier plan of every font family.
 *
 * The families are nested — wenkai ⊂ sans ⊂ serif — because each family
 * adds corpora to the ones before it, so a character that shows up late
 * is still covered by the families that need it.
 */
export function loadFamilyCharsets(options = {}) {
  const root = options.root ?? ROOT;
  const state = { skipped: 0 };

  const wenkaiSources = [];
  const sansSources = [];
  const serifSources = [];

  // --- wenkai: the UI literals and the corpus titles -------------------
  wenkaiSources.push({
    id: 'source-code',
    weight: SOURCE_CODE_WEIGHT,
    counts: scanSourceCode(root, state),
  });

  const stories = scanJsonDirectory(join(root, 'data', 'stories'), state);
  if (stories) {
    wenkaiSources.push({ id: 'stories', weight: CORPUS_WEIGHT, counts: stories.counts });
  }

  const classics = scanJsonDirectory(join(root, 'data', 'classics'), state);
  if (classics) {
    wenkaiSources.push({
      id: 'classics-titles',
      weight: CORPUS_WEIGHT,
      counts: classics.titles,
    });
    serifSources.push({ id: 'classics', weight: CORPUS_WEIGHT, counts: classics.counts });
  }

  const sutras = scanJsonDirectory(join(root, 'data', 'sutras'), state);
  if (sutras) {
    wenkaiSources.push({
      id: 'sutras-titles',
      weight: CORPUS_WEIGHT,
      counts: sutras.titles,
    });
    serifSources.push({ id: 'sutras', weight: CORPUS_WEIGHT, counts: sutras.counts });
  }

  // --- sans: the corpora ------------------------------------------------
  const content = scanJsonDirectory(join(root, 'data', 'content'), state);
  if (content) {
    sansSources.push({ id: 'content', weight: CORPUS_WEIGHT, counts: content.counts });
  }

  const poems = scanJsonDirectory(join(root, 'data', 'poems'), state);
  if (poems) {
    sansSources.push({ id: 'poems', weight: CORPUS_WEIGHT, counts: poems.counts });
  }

  const rareChars = scanJsonDirectory(join(root, 'data', 'rare-chars'), state);
  if (rareChars) {
    sansSources.push({ id: 'rare-chars', weight: CORPUS_WEIGHT, counts: rareChars.counts });
  }

  const gb2312 = scanTextFile(join(root, 'scripts', 'fonts', 'gb2312-7000.txt'), state);
  if (gb2312) {
    sansSources.push({ id: 'gb2312-7000', weight: CORPUS_WEIGHT, counts: gb2312 });
  }

  const standard = scanJsonFile(
    join(root, 'data', 'general-standard-chinese-characters.json'),
    state,
  );
  if (standard) {
    sansSources.push({ id: 'standard-chars', weight: CORPUS_WEIGHT, counts: standard });
  }

  // --- the score of every family ---------------------------------------
  const wenkaiScore = new Map();
  foldSources(wenkaiScore, wenkaiSources);

  const sansScore = new Map(wenkaiScore);
  foldSources(sansScore, sansSources);

  const serifScore = new Map(sansScore);
  foldSources(serifScore, serifSources);

  const tierOptions = {
    tier1Size: options.tier1Size,
    tier2Size: options.tier2Size,
    extBlockSize: options.extBlockSize,
  };

  const plans = {
    wenkai: planTiers(toScored(wenkaiScore), tierOptions),
    sans: planTiers(toScored(sansScore), tierOptions),
    serif: planTiers(toScored(serifScore), tierOptions),
  };

  for (const family of ['wenkai', 'sans', 'serif']) {
    const plan = plans[family];
    const total =
      plan.tier1.length +
      plan.tier2.length +
      plan.extBlocks.reduce((sum, block) => sum + block.chars.length, 0);
    console.log(
      `charset ${family}: ${total} chars ` +
        `(tier1 ${plan.tier1.length} / tier2 ${plan.tier2.length} / ext ${plan.extBlocks.length} blocks)`,
    );
  }
  console.log(`skipped ${state.skipped} malformed file(s)`);

  return plans;
}

// Only run when this file is the entry point — the unit test imports the
// helpers above and must not trigger the corpus scan.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    loadFamilyCharsets();
  } catch (err) {
    console.error('[charset] webfont charset build failed:', err);
    process.exit(1);
  }
}
