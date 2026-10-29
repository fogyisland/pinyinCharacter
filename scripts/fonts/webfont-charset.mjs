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
 *     hot — the 300 characters the interface itself uses, in one file
 *     Ext — everything else, cut into blocks of 16 CODE POINTS
 *   A page downloads the hot file plus the one or two Ext blocks that hold
 *   the characters it needs, and the browser fetches an Ext block only when
 *   a character of that block is actually painted.
 *
 *   The Ext tier is cut by code point window rather than by character count
 *   because a window is a contiguous run of the code point space: a block
 *   holds the characters of one window, and its `unicode-range` is the exact
 *   union of the code points it carries. A min–max span would claim the
 *   code points the block does NOT have, and the browser would pick that
 *   face for a character it cannot draw — tofu instead of a fallback.
 *
 * This module is the INPUT of that pipeline: it decides which characters
 * each family has to cover and how they are split into tiers. The
 * subsetter (scripts/fonts/build-webfont-subsets.mjs) turns the plan into
 * woff2 files, and the verifier (scripts/fonts/verify-webfont-subsets.mjs)
 * re-derives the same plan to prove no glyph was lost.
 *
 * The three families are NESTED on purpose — wenkai ⊂ sans ⊂ serif:
 *   wenkai  the brand typeface: the UI literals, the corpus titles, the
 *           rare characters and the dictionary radicals
 *   sans    the body typeface: everything wenkai covers plus the corpora
 *   serif   the accent typeface: everything sans covers plus the classics
 * and the sutras
 * So a character of the classics is covered by all three families and the
 * tiers stay comparable between them.
 *
 * Only the repository's own corpora are read here — no font is opened and
 * nothing is written. This is BUILD TIME ONLY: the scan reads ~235 MB and
 * takes seconds, it must never run inside a request. Usage:
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

/** The default number of characters in the hot tier. */
const DEFAULT_TIER1_SIZE = 300;

/** The default width of an Ext block, in code points. */
const DEFAULT_EXT_BLOCK_SIZE = 16;

/**
 * The tier plan of every family, before the caller overrides it.
 *
 * sans and serif carry a hot tier of the 300 characters the interface
 * uses most; wenkai has NO hot tier, because every character it holds is
 * rare enough that a file of the 16 most used ones would be wasted weight.
 */
const FAMILY_DEFAULTS = {
  sans: { tier1Size: 300, extBlockSize: 16 },
  serif: { tier1Size: 300, extBlockSize: 16 },
  wenkai: { tier1Size: 0, extBlockSize: 16 },
};

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
 * Split a scored charset into the hot tier and the Ext blocks.
 *
 * The hot tier keeps the score order — the most used characters first —
 * and holds `tier1Size` characters (none at all for wenkai).
 *
 * The Ext tier is the rest, sorted by code point and cut into code point
 * WINDOWS: the window of a character is `floor(codePoint / extBlockSize)`,
 * so a block holds every character of one window and its code point span
 * never overlaps another block's. A window that holds no character produces
 * no block — there is no glyph in it to subset.
 */
export function planTiers(scored, options = {}) {
  const tier1Size = options.tier1Size ?? DEFAULT_TIER1_SIZE;
  const extBlockSize = options.extBlockSize ?? DEFAULT_EXT_BLOCK_SIZE;

  if (!Number.isInteger(extBlockSize) || extBlockSize <= 0) {
    throw new TypeError(
      `extBlockSize must be a positive integer number of code points, got ${extBlockSize}`,
    );
  }
  if (!Number.isInteger(tier1Size) || tier1Size < 0) {
    throw new TypeError(`tier1Size must be a non negative integer, got ${tier1Size}`);
  }

  const ordered = scored.ordered;
  const hot = ordered.slice(0, tier1Size);
  const hotSet = new Set(hot);
  const tail = ordered
    .filter((ch) => !hotSet.has(ch))
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

  const windows = new Map();
  for (const ch of tail) {
    const codePoint = ch.codePointAt(0);
    const window = Math.floor(codePoint / extBlockSize);
    let block = windows.get(window);
    if (block === undefined) {
      block = { index: windows.size + 1, chars: [], lo: codePoint, hi: codePoint };
      windows.set(window, block);
    }
    block.chars.push(ch);
    if (codePoint < block.lo) block.lo = codePoint;
    if (codePoint > block.hi) block.hi = codePoint;
  }

  return { hot, extBlocks: [...windows.values()] };
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
 *
 * The result is the EXACT union of the code points — never a min–max span.
 * A span would claim code points the font does not carry, and the browser
 * would pick that face for a character it cannot draw.
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
 * The counts are keyed by CODE POINT, not by string: the corpus holds about
 * a hundred million character occurrences and allocating a string for each
 * one of them costs more than the whole scan. The string of a code point is
 * built once, when the counts are folded into the score.
 *
 * The scan walks the string by code unit. Iterating with
 * `for (const ch of text)` allocates one string per character and is
 * several times slower.
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
    counts.set(codePoint, (counts.get(codePoint) ?? 0) + 1);
  }
}

/**
 * Walk a parsed JSON value and count every string it holds.
 */
function collectStrings(value, counts) {
  if (typeof value === 'string') {
    countChars(counts, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, counts);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const childValue of Object.values(value)) collectStrings(childValue, counts);
  }
}

/**
 * Count the characters of the titles of the entries of a corpus file.
 *
 * A corpus file is either one entry (a top level object) or a list of
 * entries (a top level array). The title of an entry is its `title` field,
 * or its `label` field when it has none — the sutra files name their sutras
 * `label`, the classic files name their books `title`.
 *
 * Only the TOP level is read. The nested `label` fields of a classic file
 * are its chapter names, which the site never paints in the brand face, and
 * the sutra manifest is an index of the corpus rather than an entry of it.
 */
function collectEntryTitles(value, titles) {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const title =
      typeof entry.title === 'string'
        ? entry.title
        : typeof entry.label === 'string'
          ? entry.label
          : null;
    if (title !== null) countChars(titles, title);
  }
}

/**
 * Count the character of a rare content file.
 *
 * `data/content/<char>.json` holds a `rare` object for the 1 412
 * characters that are rare in the corpus. The character itself is the
 * `char` field; its story (`rare.story`) is NOT part of the brand face —
 * the story pages paint the story in the body face, and a brand face that
 * carries every story makes every page pay for them. The story page does
 * paint the rare CHARACTER itself in the brand face, so the character has
 * to be covered.
 */
function collectRareChar(value, rares) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (!value.rare || typeof value.rare !== 'object' || Array.isArray(value.rare)) return;
  if (typeof value.char === 'string') countChars(rares, value.char);
}

/**
 * Scan every JSON file of a directory.
 *
 * A malformed file is reported and skipped — a broken corpus must not
 * break the font pipeline — and counted so the caller can report it. A
 * missing directory is not an error either: a corpus the repository does
 * not have is skipped with a note.
 *
 * `wanted` selects what the caller needs from the files: the strings of
 * every value (`strings`), the titles of the entries (`titles`) and the
 * rare characters (`rares`).
 */
function scanJsonDirectory(dir, state, wanted = { strings: true, titles: false, rares: false }) {
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
  const rares = new Map();
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
    if (wanted.strings) collectStrings(parsed, counts);
    if (wanted.titles) collectEntryTitles(parsed, titles);
    if (wanted.rares) collectRareChar(parsed, rares);
  }
  return { counts, titles, rares };
}

/**
 * Scan one JSON file and count every string it holds.
 */
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
  collectStrings(parsed, counts);
  return counts;
}

/**
 * Scan one JSON file and count the strings of its top level values only.
 *
 * `data/radicals.json` maps 70 234 characters to their radical. The KEYS
 * are a lookup table behind `chars.radical` and are never painted; only the
 * 214 radical VALUES are rendered — the game draws a radical in the brand
 * face — so only they are counted.
 */
function scanJsonFileValues(path, state) {
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
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string') countChars(counts, value);
    }
  }
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
 * so the UI always lands in the hot tier.
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
 *
 * The counts are keyed by code point, so the string of a character is
 * built here, once, for the few thousand characters the corpus holds.
 */
function foldSource(score, counts, weight) {
  if (!counts) return;
  for (const [codePoint, count] of counts) {
    addScore(score, String.fromCodePoint(codePoint), weight * count);
  }
}

/** Turn a score map into the scored charset the tier planner consumes. */
function toScored(score) {
  return { ordered: orderByScore(score), score };
}

/**
 * The plans of a root, computed once per process.
 *
 * The scan reads the whole corpus, so a process that asks twice (the unit
 * test does, the build script does not) must not read it twice.
 */
const planCache = new Map();

/**
 * Build the tier plan of every font family.
 *
 * The families are nested — wenkai ⊂ sans ⊂ serif — because each family
 * adds corpora to the ones before it, so a character that shows up late
 * is still covered by the families that need it.
 */
export function loadFamilyCharsets(options = {}) {
  const root = options.root ?? ROOT;
  const cached = planCache.get(root);
  if (cached) return cached;

  const state = { skipped: 0 };

  // --- wenkai: the brand face ------------------------------------------
  // The UI literals, the corpus titles, the rare characters and the
  // dictionary radicals — everything the site paints in the brand face.
  const wenkaiScore = new Map();
  foldSource(wenkaiScore, scanSourceCode(root, state), SOURCE_CODE_WEIGHT);

  const classics = scanJsonDirectory(join(root, 'data', 'classics'), state, {
    strings: true,
    titles: true,
    rares: false,
  });
  foldSource(wenkaiScore, classics?.titles, CORPUS_WEIGHT);

  const sutras = scanJsonDirectory(join(root, 'data', 'sutras'), state, {
    strings: true,
    titles: true,
    rares: false,
  });
  foldSource(wenkaiScore, sutras?.titles, CORPUS_WEIGHT);

  // The rare characters come out of the same pass over data/content that
  // the body face needs, so the corpus is read once.
  const content = scanJsonDirectory(join(root, 'data', 'content'), state, {
    strings: true,
    titles: false,
    rares: true,
  });
  foldSource(wenkaiScore, content?.rares, CORPUS_WEIGHT);

  const radicals = scanJsonFileValues(join(root, 'data', 'radicals.json'), state);
  foldSource(wenkaiScore, radicals, CORPUS_WEIGHT);

  // --- sans: the body face ---------------------------------------------
  const sansScore = new Map(wenkaiScore);
  foldSource(sansScore, content?.counts, CORPUS_WEIGHT);

  const poems = scanJsonDirectory(join(root, 'data', 'poems'), state, {
    strings: true,
    titles: false,
    rares: false,
  });
  foldSource(sansScore, poems?.counts, CORPUS_WEIGHT);

  const gb2312 = scanTextFile(join(root, 'scripts', 'fonts', 'gb2312-7000.txt'), state);
  foldSource(sansScore, gb2312, CORPUS_WEIGHT);

  const standard = scanJsonFile(
    join(root, 'data', 'general-standard-chinese-characters.json'),
    state,
  );
  foldSource(sansScore, standard, CORPUS_WEIGHT);

  // --- serif: the accent face ------------------------------------------
  const serifScore = new Map(sansScore);
  foldSource(serifScore, sutras?.counts, CORPUS_WEIGHT);
  foldSource(serifScore, classics?.counts, CORPUS_WEIGHT);

  // --- the plan of every family -----------------------------------------
  const plans = {
    wenkai: planTiers(toScored(wenkaiScore), familyOptions('wenkai', options.families)),
    sans: planTiers(toScored(sansScore), familyOptions('sans', options.families)),
    serif: planTiers(toScored(serifScore), familyOptions('serif', options.families)),
  };

  for (const family of ['wenkai', 'sans', 'serif']) {
    const plan = plans[family];
    const total =
      plan.hot.length +
      plan.extBlocks.reduce((sum, block) => sum + block.chars.length, 0);
    console.log(
      `charset ${family}: ${total} chars (hot ${plan.hot.length} / ext ${plan.extBlocks.length} blocks)`,
    );
  }
  console.log(`skipped ${state.skipped} malformed file(s)`);

  planCache.set(root, plans);
  return plans;
}

/**
 * The tier options of one family: the defaults, overridden by the caller.
 */
function familyOptions(family, overrides) {
  return { ...FAMILY_DEFAULTS[family], ...(overrides?.[family] ?? {}) };
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
