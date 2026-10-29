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
 *     hot — the characters the MEASURED pages paint, in one file
 *     Ext — everything else, cut into blocks of 6 CHARACTERS
 *   A page downloads the hot file plus the one or two Ext blocks that hold
 *   the characters it needs, and the browser fetches an Ext block only when
 *   a character of that block is actually painted.
 *
 *   WHICH characters the hot file holds is free: its size is fixed, so
 *   the corpus frequency cannot improve on the measured answer. The hot
 *   tier is therefore SEEDED with the union of the characters the four
 *   measured pages paint in each family — read from
 *   data/font-page-profiles.json, the only evidence of what the pages
 *   really draw — ordered by how many pages painted them, and the
 *   remaining slots are filled by the corpus frequency order. The seed is
 *   never truncated: a painted character that fell out of the hot tier
 *   would have no glyph in it, and the page would show a tofu box.
 *
 *   All THREE families carry a 300 character hot tier, the brand face
 *   included. It used to have none, on the theory that every character it
 *   holds is rare enough to make 300 slots a waste; the measurement says
 *   the opposite — the poetry page paints its titles in the brand face and
 *   needed 120 font files without a hot tier.
 *
 *   The Ext tier keeps the FREQUENCY ORDER and slices it into blocks of a
 *   fixed character count. The cost of a subset file is not the glyphs
 *   alone: every file carries a fixed overhead of about 1 000 bytes that
 *   cannot be squeezed out, so a narrow block is more expensive per
 *   character than a wide one, and a page that hits a block downloads the
 *   WHOLE file. Cutting by frequency order therefore wins twice over: the
 *   characters a page uses cluster into a few blocks, and every block it
 *   pulls is used to the brim. Cutting by code point window instead scatters
 *   the characters of a page over dozens of windows and pays the fixed
 *   overhead dozens of times — measured at 645 KB against 441 KB for the
 *   same page.
 *
 *   A block is NOT a contiguous run of the code point space: its characters
 *   are scattered over the code points. Its `unicode-range` is therefore the
 *   EXACT union of the code points it carries. A min–max span would claim
 *   the code points the block does NOT have, and the browser would pick that
 *   face for a character it cannot draw — tofu instead of a fallback.
 *
 * This module is the INPUT of that pipeline: it decides which characters
 * each family has to cover and how they are split into tiers. The
 * subsetter (scripts/fonts/build-webfont-subsets.mjs) turns the plan into
 * woff2 files, and the verifier (scripts/fonts/verify-webfont-subsets.mjs)
 * re-derives the same plan to prove no glyph was lost.
 *
 * The three families are NESTED on purpose — wenkai ⊂ sans ⊂ serif:
 *   wenkai  the brand typeface: the UI literals WITHOUT their comments,
 *           the corpus titles, the poem titles, the rare characters, the
 *           dictionary radicals and the 8 105 standard characters of
 *           data/general-standard-chinese-characters.json
 *   sans    the body typeface: everything wenkai covers plus the corpora
 *   serif   the accent typeface: everything sans covers plus the classics
 * and the sutras
 * So a character of the classics is covered by all three families and the
 * tiers stay comparable between them.
 *
 * Only the repository's own corpora are read here — no font is opened and
 * nothing is written. This is BUILD TIME ONLY: the scan reads about 270 MB
 * and takes seconds, it must never run inside a request. Usage:
 *   node scripts/fonts/webfont-charset.mjs   print the three charset sizes
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

/** The default number of characters in one Ext block. */
const DEFAULT_EXT_BLOCK_CHARS = 6;

/**
 * The tier plan of every family, before the caller overrides it.
 *
 * All three families carry a hot tier of 300 characters, the brand face
 * included. The hot file is SEEDED with the characters the measured pages
 * paint in that family (see `loadFamilyCharsets`) and the rest of the
 * slots are filled by corpus frequency. The brand face used to have no
 * hot tier at all, on the theory that every character it holds is rare
 * enough to make 300 slots a waste; the measurement says the opposite —
 * the poetry page paints its titles in the brand face and needed 120 font
 * files without a hot tier.
 *
 * All three cut the Ext tier into blocks of six characters.
 */
const FAMILY_DEFAULTS = {
  sans: { tier1Size: 300, extBlockChars: 6 },
  serif: { tier1Size: 300, extBlockChars: 6 },
  wenkai: { tier1Size: 300, extBlockChars: 6 },
};

/** The families the site ships, in the order they are reported. */
const FAMILIES = ['wenkai', 'sans', 'serif'];

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
 * The hot tier is SEEDED: `options.hotChars` comes first, in its own
 * order, and the remaining slots are filled by the score order. The
 * seeded characters are never truncated — `tier1Size` is a FLOOR, not a
 * cap. A seeded character is one the measured pages paint, and a painted
 * character that fell out of the hot tier would have no glyph in it: the
 * page would show a tofu box.
 *
 * The Ext tier is the rest, in the SAME score order, cut into blocks of
 * `extBlockChars` characters. The order is the whole point: a page draws
 * the characters it needs from the top of the frequency order, so they
 * land in a few blocks and each block it downloads is used to the brim.
 *
 * The last block may be short — that is the tail of the list, not a bug.
 * The characters of a block are scattered over the code point space, so a
 * block has no code point span; its `unicode-range` is the exact union of
 * the characters it carries (see `unicodeRange`).
 */
export function planTiers(scored, options = {}) {
  const tier1Size = options.tier1Size ?? DEFAULT_TIER1_SIZE;
  const extBlockChars = options.extBlockChars ?? DEFAULT_EXT_BLOCK_CHARS;
  const seed = options.hotChars ?? [];

  if (!Number.isInteger(extBlockChars) || extBlockChars <= 0) {
    throw new TypeError(
      `extBlockChars must be a positive integer number of characters, got ${extBlockChars}`,
    );
  }
  if (!Number.isInteger(tier1Size) || tier1Size < 0) {
    throw new TypeError(`tier1Size must be a non negative integer, got ${tier1Size}`);
  }

  const ordered = scored.ordered;

  // The seed goes in first, in its own order, and is never truncated. A
  // seeded character the corpus does not hold still enters the hot tier:
  // it is painted by a page, so it needs a glyph.
  const hot = [];
  const hotSet = new Set();
  for (const ch of seed) {
    if (hotSet.has(ch)) continue;
    hotSet.add(ch);
    hot.push(ch);
  }

  // The tier size is a floor: the seed decides how small it may get.
  const hotSize = Math.max(tier1Size, hot.length);
  for (const ch of ordered) {
    if (hot.length >= hotSize) break;
    if (hotSet.has(ch)) continue;
    hotSet.add(ch);
    hot.push(ch);
  }

  // The tail keeps the score order and drops the characters the hot tier
  // already holds — a character may not be in both tiers.
  const tail = ordered.filter((ch) => !hotSet.has(ch));

  const extBlocks = [];
  for (let start = 0; start < tail.length; start += extBlockChars) {
    extBlocks.push({
      index: extBlocks.length + 1,
      chars: tail.slice(start, start + extBlockChars),
    });
  }

  return { hot, extBlocks };
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
 * The ScriptKind a source file is parsed with.
 *
 * The file name decides it and the decision matters: a `.tsx` file may
 * hold JSX, so it is parsed as TSX, while a `.ts` file may hold `<T>expr`
 * type assertions, which TSX would mistake for JSX. TSX is the more
 * permissive of the two, so it is the default when the caller names no
 * file.
 */
function scriptKindFor(fileName) {
  return /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Strip the comments of a source file.
 *
 * The source scan counts the characters the interface paints, and a
 * comment is never painted: the Chinese characters that existed ONLY in
 * comments held the thousandfold source weight and pushed real characters
 * out of the hot tier.
 *
 * The stripper is the TypeScript scanner, not a hand written one. That
 * buys the two things a hand written scanner cannot have:
 *
 *   - it tells a REGULAR EXPRESSION from a division, so the quotes of a
 *     regexp literal do not open a string that swallows the code behind
 *     it — a hand written scanner mistook `/"(\w+)"/g` for a string and
 *     dropped the comments of the following lines;
 *   - it knows the JSX grammar, so the `//` of a JSX TEXT is text and not
 *     a comment — a hand written scanner ate the Chinese characters that
 *     follow a URL in a JSX text, and they are painted.
 *
 * It strips COMMENTS and nothing else: the contents of string and template
 * literals are kept verbatim, because those characters ARE painted.
 *
 * `fileName` picks the ScriptKind (see `scriptKindFor`). The caller that
 * scans the repository passes the real file name.
 */
export function stripSourceComments(text, fileName = 'source.tsx') {
  if (typeof text !== 'string' || text.length === 0) return '';

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFor(fileName),
  );

  // Every comment of the file is a range of it. The scanner knows where
  // they are; the tree only says which token a comment hangs on: the
  // leading trivia of a token and the trailing trivia behind it.
  const ranges = [];
  const walk = (node) => {
    const kids = node.getChildren(sourceFile);
    if (kids.length === 0) {
      // A token: the gap in front of it is its leading trivia and the gap
      // behind it may hold a trailing comment.
      for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
        ranges.push([range.pos, range.end]);
      }
      for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
        ranges.push([range.pos, range.end]);
      }
      return;
    }
    for (const kid of kids) walk(kid);
  };
  walk(sourceFile);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  let out = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    cursor = end;
  }
  return out + text.slice(cursor);
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
 * so the UI always lands in the hot tier — but only the ones that are
 * really painted: the comments are stripped first, because a character
 * that exists only in a comment is never drawn and would still hold a
 * thousandfold weight.
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
      countChars(counts, stripSourceComments(readFileSync(full, 'utf8'), full));
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
 * The scanned scores of a root, and the plans built on top of them.
 *
 * The scan reads the whole corpus and the tier plan on top of it is cheap,
 * so the scan is cached by root and the plan is cached by root AND by the
 * per family overrides the caller asked for.
 */
const scanCache = new Map();
const planCache = new Map();

/**
 * The cache key of one call.
 *
 * The per family overrides are part of the key: a caller that asks for a
 * different hot tier size must not be handed the plan of the default one.
 * The path of the page profile fixture is part of it too, because the
 * fixture seeds the hot tier: a caller that points at another fixture
 * must not be handed the plan of the default one.
 * The overrides are serialized in a fixed order, so the same overrides
 * always land on the same entry.
 *
 * A key whose value is `undefined` or `null` is NOT an override — it means
 * "no override" — so it is left out of the key. That way `{}` and
 * `{ tier1Size: undefined }` share one cache entry.
 *
 * The values are serialized with `JSON.stringify`, not with `String()`:
 * `String(['a','b'])` is `'a,b'`, which is also `String(['a,b'])` — two
 * different overrides would land on the same cache entry and one of them
 * would be handed the plan of the other.
 */
function cacheKey(root, families, pageProfiles) {
  const overrides = Object.entries(families ?? {})
    .filter(([, options]) => options !== undefined && options !== null)
    .map(([family, options]) => {
      const entries = Object.entries(options ?? {})
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
      return { family, entries };
    })
    .filter(({ entries }) => entries.length > 0)
    .sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0))
    .map(({ family, entries }) => `${family}{${entries.join(',')}}`)
    .join(';');
  const profiles = pageProfiles === undefined || pageProfiles === null ? '' : pageProfiles;
  return `${root}::${profiles}::${overrides}`;
}

/**
 * The characters the measured pages paint in one family.
 *
 * The fixture is the only evidence of what the pages really draw, so the
 * seed of a family is the UNION of the characters of ALL pages, ordered by
 * the number of pages that painted them (descending) and by ascending code
 * point for the ties.
 *
 * Only Chinese characters are taken. The hot tier is a scarce resource —
 * its slots are the characters a page is most likely to paint — so an
 * ASCII letter, a digit or a space that slipped into the fixture must not
 * take one of them.
 */
export function unionOfPages(pages, family) {
  const pageCount = new Map();
  for (const page of Object.values(pages)) {
    const painted = page?.[family];
    if (typeof painted !== 'string') continue;
    for (const ch of new Set(painted)) {
      if (!isCjkChar(ch)) continue;
      pageCount.set(ch, (pageCount.get(ch) ?? 0) + 1);
    }
  }
  return [...pageCount.keys()].sort((a, b) => {
    const delta = (pageCount.get(b) ?? 0) - (pageCount.get(a) ?? 0);
    if (delta !== 0) return delta;
    return a.codePointAt(0) - b.codePointAt(0);
  });
}

/**
 * How a broken fixture is restored, as a remedy the reader can act on.
 *
 * `data/font-page-profiles.json` is a tracked file of the repository, so
 * `git checkout` is what restores it, and the repository relative path is
 * the form that command wants. A path that is NOT that file — a fixture the
 * caller named, or a path that does not exist at all — is not tracked, and
 * git has nothing to say about it: the only remedy left is to point the
 * module at another fixture.
 */
function fixtureRestore(path) {
  const rel = relative(ROOT, path);
  const insideRepository = Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
  const label = insideRepository ? rel.split(/[\\/]/).join('/') : path;
  const isTrackedFixture = label === 'data/font-page-profiles.json';
  return {
    tracked: isTrackedFixture ? ' and it is a tracked repository file' : '',
    restore: isTrackedFixture
      ? `restore it with "git checkout -- ${label}" or pass options.pageProfiles`
      : 'restore it or pass options.pageProfiles',
  };
}

/**
 * The hot tier seed of every family, read from the page profile fixture.
 *
 * `data/font-page-profiles.json` was captured from the production HTML: it
 * holds, per page and per family, the characters that page painted. It is
 * a file of the repository, so a fixture that cannot be read means the
 * repository is broken — and a silent fallback to the corpus frequency
 * order would put the hot tier back to the hit rate this module exists to
 * fix. So this throws instead of guessing.
 *
 * The remedy it names is the one that holds TODAY: the tracked fixture can
 * be restored from git, and the caller may point the module at another
 * fixture instead.
 */
function loadPageProfileSeeds(path) {
  const { tracked, restore } = fixtureRestore(path);

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `[charset] cannot read the page profile fixture ${path}: ${err.message} — ` +
        `the hot tier is seeded from it${tracked}: ${restore}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[charset] the page profile fixture ${path} is not valid JSON: ${err.message} — ` +
        `the file is corrupt: ${restore}`,
    );
  }

  const pages = parsed?.pages;
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) {
    throw new Error(
      `[charset] the page profile fixture ${path} is not a page profile — ` +
        `the file has no "pages" object: ${restore}`,
    );
  }

  const seeds = {};
  for (const family of FAMILIES) {
    seeds[family] = unionOfPages(pages, family);
  }
  return seeds;
}

/**
 * Build the tier plan of every font family.
 *
 * The families are nested — wenkai ⊂ sans ⊂ serif — because each family
 * adds corpora to the ones before it, so a character that shows up late
 * is still covered by the families that need it.
 *
 * The hot tier of every family is seeded with the characters the measured
 * pages paint in it; the rest of the hot tier is filled by the corpus
 * frequency order.
 */
export function loadFamilyCharsets(options = {}) {
  const root = options.root ?? ROOT;
  const pageProfiles =
    options.pageProfiles ?? join(root, 'data', 'font-page-profiles.json');
  const key = cacheKey(root, options.families, pageProfiles);
  const cached = planCache.get(key);
  if (cached) return cached;

  // The fixture is validated BEFORE the corpus is scanned. The scan reads
  // about 270 MB and takes minutes; a fixture that cannot be read is a
  // three kilobyte mistake, and the caller must not wait minutes to hear
  // about it.
  const seeds = loadPageProfileSeeds(pageProfiles);
  const scores = loadScores(root);

  // --- the plan of every family -----------------------------------------
  const plans = {
    wenkai: planTiers(
      toScored(scores.wenkai),
      familyOptions('wenkai', options.families, seeds.wenkai),
    ),
    sans: planTiers(
      toScored(scores.sans),
      familyOptions('sans', options.families, seeds.sans),
    ),
    serif: planTiers(
      toScored(scores.serif),
      familyOptions('serif', options.families, seeds.serif),
    ),
  };

  for (const family of FAMILIES) {
    const plan = plans[family];
    const total =
      plan.hot.length +
      plan.extBlocks.reduce((sum, block) => sum + block.chars.length, 0);
    console.log(
      `charset ${family}: ${total} chars (hot ${plan.hot.length} / ext ${plan.extBlocks.length} blocks)`,
    );
  }
  console.log(`skipped ${scores.skipped} malformed file(s)`);

  planCache.set(key, plans);
  return plans;
}

/**
 * The score of every character of every family, scanned once per root.
 *
 * The scan is the expensive part — it reads the whole corpus — while the
 * tier plan on top of it is cheap. So the SCAN is cached by root and the
 * PLAN is computed per call, with the overrides the caller asked for.
 */
function loadScores(root) {
  const cached = scanCache.get(root);
  if (cached) return cached;

  const state = { skipped: 0 };

  // --- wenkai: the brand face ------------------------------------------
  // The UI literals WITHOUT their comments, the corpus titles, the poem
  // titles, the rare characters, the dictionary radicals and the standard
  // character set — everything the site paints in the brand face.
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

  // The 8 105 standard characters are the seed of the `chars` table and the
  // whole pool the games draw from. The chain game paints them in the
  // brand face (components/game/ChainScroll.tsx:63,
  // components/game/ChainPickerModal.tsx:24,
  // components/game/quest/WrongBook.tsx:118,
  // components/game/quest/QuestCharCard.tsx:52), so they belong to the
  // brand face: without them those characters fall back to the system font
  // and the game pages mix two typefaces.
  //
  // The list is folded in HERE, once. The body faces copy the score of the
  // brand face, so those 8 105 characters are counted once and reach sans
  // and serif through that copy — they are not counted again.
  const standard = scanJsonFile(
    join(root, 'data', 'general-standard-chinese-characters.json'),
    state,
  );
  foldSource(wenkaiScore, standard, CORPUS_WEIGHT);

  // The poem titles are painted in the brand face: components/poetry/
  // PoemCard.tsx:32 renders 《{poem.title}》 in font-kai. Seven of the
  // title characters exist in NO other corpus source, so without them the
  // poetry page falls back to the system font (a mixed face, and a tofu
  // box where the system font has no glyph either).
  //
  // The pass over data/poems therefore has to happen BEFORE the body face
  // copies the score of the brand face: one pass over the directory yields
  // both the counts and the titles — the titles go into the brand face, the
  // counts into the body face. Only the TOP level title of a poem file is
  // taken; the poem itself is body text and belongs to sans.
  const poems = scanJsonDirectory(join(root, 'data', 'poems'), state, {
    strings: true,
    titles: true,
    rares: false,
  });
  foldSource(wenkaiScore, poems?.titles, CORPUS_WEIGHT);

  // --- sans: the body face ---------------------------------------------
  const sansScore = new Map(wenkaiScore);
  foldSource(sansScore, content?.counts, CORPUS_WEIGHT);
  foldSource(sansScore, poems?.counts, CORPUS_WEIGHT);

  const gb2312 = scanTextFile(join(root, 'scripts', 'fonts', 'gb2312-7000.txt'), state);
  foldSource(sansScore, gb2312, CORPUS_WEIGHT);

  // --- serif: the accent face ------------------------------------------
  const serifScore = new Map(sansScore);
  foldSource(serifScore, sutras?.counts, CORPUS_WEIGHT);
  foldSource(serifScore, classics?.counts, CORPUS_WEIGHT);

  const scores = {
    wenkai: wenkaiScore,
    sans: sansScore,
    serif: serifScore,
    skipped: state.skipped,
  };
  scanCache.set(root, scores);
  return scores;
}

/**
 * The tier options of one family: the defaults, overridden by the caller.
 *
 * Every option is taken BY KEY, never by spreading the override object
 * over the defaults. A spread lets an explicit `undefined` win the spread
 * and ERASE the default it should have fallen back to: `{ tier1Size:
 * undefined }` would leave the size of the hot tier uncomputable, and
 * `{ hotChars: undefined }` would wipe the page profile seed away — the
 * hot tier would fall back to the corpus frequency order, which is
 * exactly what this module exists to avoid.
 *
 * The seed of the hot tier is the union of the characters the measured
 * pages paint in the family, unless the caller names its own.
 */
function familyOptions(family, overrides, seed) {
  const defaults = FAMILY_DEFAULTS[family];
  const override = overrides?.[family] ?? {};
  return {
    tier1Size: override.tier1Size ?? defaults.tier1Size,
    extBlockChars: override.extBlockChars ?? defaults.extBlockChars,
    hotChars: override.hotChars ?? seed,
  };
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
