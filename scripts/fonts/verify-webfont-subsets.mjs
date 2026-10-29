/**
 * scripts/fonts/verify-webfont-subsets.mjs — proves the shipped webfont
 * subsets are correct.
 *
 * Why this exists: the site ships 7 936 woff2 files (three families, a hot
 * tier and thousands of Ext blocks) plus three stylesheets that tell the
 * browser which file holds which character. Every one of those declarations
 * is a promise: "this file can draw these characters". A promise that is
 * wrong is a tofu box on the page (G10) — and the failure is invisible in
 * review, because the CSS looks perfect and the file is really there.
 *
 * So the promises are checked here, mechanically, against the artefacts on
 * the disk:
 *
 *   1. coverage      the union of the unicode-ranges is INSIDE the charset
 *                     of Task 1 — a subset, NOT equality: F31-a dropped the
 *                     characters the source font cannot draw
 *   2. disjointness  the blocks of a family do not overlap
 *   3. glyphs        every character a face declares has a glyph in the
 *                     file that face points at (the tofu gate)
 *   4. sizes         the hot file and the Ext files are inside the budget
 *   5. stylesheets   the gzip total, the face count, the blocking sheet
 *   6. faces         every face says font-display: swap and points at a
 *                     file that exists
 *   7. manifest      the version is the hash of the three stylesheets and
 *                     every family points at ITS OWN stylesheet
 *   8. pages         what a page downloads stays inside the page budget
 *   9. tokens        every URL carries the hash of the bytes it serves (R18)
 *  10. identity      every face declares the family of the stylesheet and a
 *                     normal font-style
 *  11. weights       a static face points at the file of its OWN weight
 *
 * Every failure is COLLECTED: the run reports all of them and exits 1, so
 * one broken build is one trip through the log, not nine.
 *
 * This script never writes anything and never goes online. It reads the
 * working tree, so it also verifies the artefacts that are not committed
 * yet — which is exactly the state between the build and the commit.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import * as fontkit from 'fontkit';

import { FAMILIES } from './build-webfont-subsets.mjs';
import { loadFamilyCharsets } from './webfont-charset.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const FONT_DIR = join(ROOT, 'public', 'font');
const WEB_DIR = join(FONT_DIR, 'web');
const MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json');
const PROFILE_PATH = join(ROOT, 'data', 'font-page-profiles.json');

/**
 * The budgets of the design.
 *
 * They come from R9, F25-c/d and F27-c/d/e — every one of them is a
 * measurement, and they were re-based four times. They are NOT to be
 * relaxed to make a build pass: a build that busts a budget is a build
 * that busts the page.
 */
export const LIMITS = {
  hotBytes: 96 * 1024,
  extBlockBytes: 7 * 1024,
  cssBytes: 175 * 1024, // 三份样式表 gzip 后合计（F25-d / F27-d）
  sansCssBytes: 65 * 1024, // 无衬线那份单独设限：它渲染阻塞（F25-d / F27-d）
  maxFacesPerCss: 3400,
  maxFontFilesPerPage: 12, // F27-j-g：实测最多 4 个
  pageFontBytes: {
    '/': 330 * 1024,
    '/dictionary': 330 * 1024,
    '/poetry': 240 * 1024,
    '/stories': 330 * 1024,
  },
};

/** The version token of a family: twelve lowercase hex characters (R18). */
const VERSION_PATTERN = /^[0-9a-f]{12}$/;

/**
 * U+FFFF is the cmap mapping of `.notdef`.
 *
 * EVERY file carries it, so it is never an "extra" code point — it is the
 * absence of a glyph, not a character the file happens to hold.
 */
const NOTDEF_CODE_POINT = 0xffff;

/** How many offenders one message lists before it summarises the rest. */
const SAMPLE_SIZE = 8;

/**
 * Normalise the line endings of a TEXT file before it is hashed.
 *
 * The repository has `core.autocrlf = true`, so a fresh clone on Windows
 * checks the stylesheets out with CRLF while the build wrote them with LF.
 * The content hash of the manifest is the hash of the CONTENT, so it is
 * computed on the LF form — otherwise the same build would verify on the
 * build machine and fail on every other one.
 *
 * ⚠️ Only text is normalised. The woff2 files are BINARY: their bytes go
 * into the version token exactly as they are on the disk, one byte is not
 * touched.
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

/** Read a declaration out of a CSS block: `font-weight: 400 700;`. */
function cssField(body, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  return match ? match[1].trim() : '';
}

/** Take the quotes off a CSS value: `'Noto Sans SC'` → `Noto Sans SC`. */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === "'" || first === '"') && trimmed.endsWith(first)) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * The URL of a face: the directory, the file and the version token.
 *
 * @returns {{ dir: string, file: string, token: string } | null}
 */
export function parseFaceUrl(src) {
  const url = /^\/font\/web\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$/.exec(src);
  if (!url) return null;
  return { dir: url[1], file: url[2], token: url[3] ?? '' };
}

/**
 * One @font-face rule of a stylesheet.
 *
 * @returns {Array<{ fontFamily: string, weight: string, fontStyle: string,
 *                  display: string, src: string, range: string }>}
 */
export function parseFaces(css) {
  const faces = [];
  const blockPattern = /@font-face\s*\{([\s\S]*?)\}/g;
  let match = blockPattern.exec(css);
  while (match !== null) {
    const body = match[1];
    const src = /src:\s*url\(([^)]*)\)/.exec(body);
    faces.push({
      fontFamily: unquote(cssField(body, 'font-family')),
      weight: cssField(body, 'font-weight'),
      fontStyle: unquote(cssField(body, 'font-style')),
      display: cssField(body, 'font-display'),
      src: src ? src[1].trim() : '',
      range: cssField(body, 'unicode-range'),
    });
    match = blockPattern.exec(css);
  }
  return faces;
}

/**
 * Check the identity of a face: the family it declares and its style.
 *
 * A stylesheet that declares `'Noto Sans SC 2'` (or `font-style: italic`)
 * still passes every other check — the file is there, the glyphs are there —
 * but the page is painted in a DIFFERENT typeface. That is a silent G9
 * violation, so it is checked here.
 *
 * @param {{ key: string, label: string }} family the family of the stylesheet
 * @param {{ fontFamily: string, fontStyle: string, src: string }} face
 * @returns {string[]} the messages of the failures, empty when the face is right
 */
export function checkFaceFamily(family, face) {
  const errors = [];
  if (face.fontFamily !== family.label) {
    errors.push(
      `[${family.key}] the face ${face.src} declares font-family ` +
        `${JSON.stringify(face.fontFamily)}, the stylesheet is the family ` +
        `${JSON.stringify(family.label)}`,
    );
  }
  if (face.fontStyle !== 'normal') {
    errors.push(
      `[${family.key}] the face ${face.src} declares font-style ` +
        `${JSON.stringify(face.fontStyle)}, it must be normal`,
    );
  }
  return errors;
}

/**
 * Check that a static face points at the file of its OWN weight.
 *
 * The static family cuts every block into two files — `ext-001-400.woff2`
 * and `ext-001-700.woff2` — and the two faces of the block share one
 * unicode-range. If the 700 face pointed at the 400 file, the tofu gate
 * would still be green (that file really holds those glyphs) and the page
 * would be painted in the WRONG weight: a silent G9 violation.
 *
 * A VARIABLE family is not checked: it has one file per block and one face
 * that declares `font-weight: 400 700`, so there is no file of a weight.
 *
 * @param {{ key: string, variable: boolean }} family the family of the stylesheet
 * @param {{ weight: string, src: string }} face
 * @returns {string[]} the messages of the failures, empty when the face is right
 */
export function checkFaceWeight(family, face) {
  if (family.variable) return [];
  const url = parseFaceUrl(face.src);
  if (!url) return [];
  const expected = `-${face.weight}.woff2`;
  if (!url.file.endsWith(expected)) {
    return [
      `[${family.key}] the ${face.weight} face points at ${url.file}, it must ` +
        `point at the file of its own weight (${expected})`,
    ];
  }
  return [];
}

/**
 * Check that the manifest points every family at ITS OWN stylesheet.
 *
 * `lib/font-css.ts` builds the URL of the stylesheet of a family out of
 * `manifest.files.<family>`. A manifest that points `serif` at
 * `fonts-sans.css` would drop the serif stylesheet from the page — and
 * every other check would still be green.
 *
 * @param {{ files?: Record<string, string> }} manifest the parsed manifest
 * @param {Array<{ key: string, css: string }>} families the families of the site
 * @returns {string[]} the messages of the failures, empty when the manifest is right
 */
export function checkManifestFiles(manifest, families) {
  const errors = [];
  const files = manifest?.files ?? {};
  for (const family of families) {
    const value = files[family.key];
    if (typeof value !== 'string' || value === '') {
      errors.push(`the manifest lists no stylesheet for ${family.key}`);
      continue;
    }
    if (!value.endsWith(family.css)) {
      errors.push(
        `the manifest points ${family.key} at ${value}, it must point at the ` +
          `stylesheet of the family (${family.css})`,
      );
    }
  }
  return errors;
}

/**
 * Expand a `unicode-range` declaration into the code points it claims.
 *
 * @returns {number[]}
 */
function parseUnicodeRange(text) {
  const points = [];
  for (const raw of text.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const match = /^u\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(entry);
    if (!match) {
      throw new Error(`unreadable unicode-range entry: ${JSON.stringify(entry)}`);
    }
    const start = parseInt(match[1], 16);
    const end = match[2] ? parseInt(match[2], 16) : start;
    if (end < start) {
      throw new Error(`unicode-range entry goes backwards: ${JSON.stringify(entry)}`);
    }
    for (let point = start; point <= end; point += 1) points.push(point);
  }
  return points;
}

/**
 * The key of the BLOCK a file belongs to.
 *
 * A block is what the browser thinks of as one chunk of characters: the
 * hot tier, or one Ext block. A static family cuts a block into two files
 * (400 and 700) and gives both of them the SAME unicode-range, so the
 * faces of a block must be merged before the blocks are compared — see
 * check 2.
 */
function blockKeyOf(family, fileName) {
  const base = fileName.replace(/\.woff2$/, '');
  if (family.variable) return base;
  for (const weight of family.weights) {
    if (base.endsWith(`-${weight}`)) {
      return base.slice(0, base.length - weight.length - 1);
    }
  }
  return base;
}

/** The code points of the charset plan of Task 1. */
function planCodePoints(plan) {
  const points = new Set();
  for (const ch of plan.hot) points.add(ch.codePointAt(0));
  for (const block of plan.extBlocks) {
    for (const ch of block.chars) points.add(ch.codePointAt(0));
  }
  return points;
}

/** A one line summary of a list of offenders. */
function summarize(values) {
  const shown = values.slice(0, SAMPLE_SIZE).join(', ');
  const rest = values.length - SAMPLE_SIZE;
  return rest > 0 ? `${shown} (and ${rest} more)` : shown;
}

/** The stats of a family that could not be read at all. */
function emptyStats(family) {
  return {
    key: family.key,
    chars: 0,
    faces: 0,
    blocks: 0,
    files: 0,
    bytes: 0,
    cssBytes: 0,
    cssGzipBytes: 0,
    version: '',
    extraCodepoints: 0,
    missingGlyphs: 0,
  };
}

/**
 * Check the family alone: its stylesheet, its files and its blocks.
 *
 * The detail it returns (the block map and the file sizes) is what the
 * page budget of check 8 is computed from.
 */
async function inspectFamily(family, plan) {
  const errors = [];
  const stats = emptyStats(family);

  const cssPath = join(FONT_DIR, family.css);
  let cssRaw;
  try {
    cssRaw = await readFile(cssPath, 'utf8');
  } catch (error) {
    errors.push(
      `[${family.key}] the stylesheet ${family.css} cannot be read: ${error.message}`,
    );
    return { errors, stats, detail: null };
  }
  const css = normalizeNewlines(cssRaw);
  stats.cssBytes = Buffer.byteLength(css, 'utf8');
  stats.cssGzipBytes = gzipSync(Buffer.from(css, 'utf8')).length;

  const faces = parseFaces(css);
  stats.faces = faces.length;

  // --- check 5: the face count of the stylesheet --------------------------
  if (faces.length > LIMITS.maxFacesPerCss) {
    errors.push(
      `[${family.key}] ${family.css} declares ${faces.length} faces, ` +
        `the budget is ${LIMITS.maxFacesPerCss}`,
    );
  }

  // --- check 5: the blocking stylesheet has its own budget ----------------
  if (family.key === 'sans' && stats.cssGzipBytes > LIMITS.sansCssBytes) {
    errors.push(
      `[${family.key}] ${family.css} is ${stats.cssGzipBytes} B gzipped, ` +
        `the budget of the render blocking stylesheet is ${LIMITS.sansCssBytes} B`,
    );
  }

  const planPoints = planCodePoints(plan);
  const blocks = new Map();
  const cpToBlock = new Map();
  const declared = new Set();
  const unknownChars = [];
  const overlapping = [];
  const inconsistentBlocks = [];
  const badDisplay = [];
  const badUrls = [];
  const missingTokens = [];
  const wrongTokens = [];
  const missingFiles = [];
  const oversized = [];
  const missingGlyphs = [];
  const extraCodepoints = [];
  const badLabels = [];
  const badWeights = [];
  let files = 0;
  let bytes = 0;

  // The hash is fed in the order the faces appear in the stylesheet: that
  // IS the order the build wrote the files in (the stylesheet is rendered
  // from the same list of blocks), so recomputing it here reproduces the
  // token of the build.
  const hasher = createHash('sha256');

  for (const face of faces) {
    // --- check 10: the face must declare the family and the style ---------
    for (const message of checkFaceFamily(family, face)) {
      badLabels.push(message);
    }
    // --- check 11: a static face must point at the file of its weight -----
    for (const message of checkFaceWeight(family, face)) {
      badWeights.push(message);
    }

    const url = parseFaceUrl(face.src);
    if (!url) {
      badUrls.push(face.src);
      continue;
    }
    const fileName = url.file;
    const token = url.token;
    if (!VERSION_PATTERN.test(token)) missingTokens.push(fileName);

    let points;
    try {
      points = parseUnicodeRange(face.range);
    } catch (error) {
      errors.push(`[${family.key}] ${fileName}: ${error.message}`);
      continue;
    }
    for (const point of points) declared.add(point);

    const blockKey = blockKeyOf(family, fileName);
    let block = blocks.get(blockKey);
    if (!block) {
      block = { key: blockKey, files: [], points: new Set(), range: face.range };
      blocks.set(blockKey, block);
    } else if (block.range !== face.range) {
      // Two faces of one block must declare the same range — otherwise the
      // browser could pick the 700 face for a character only the 400 file
      // can draw.
      inconsistentBlocks.push(blockKey);
    }
    block.files.push({ name: fileName, bytes: 0 });

    for (const point of points) {
      const owner = cpToBlock.get(point);
      if (owner !== undefined && owner !== blockKey) {
        overlapping.push(
          `${owner} / ${blockKey} (U+${point.toString(16).toUpperCase()})`,
        );
      } else {
        cpToBlock.set(point, blockKey);
      }
      block.points.add(point);
    }

    // --- check 1: the range must be inside the charset of Task 1 ---------
    for (const point of points) {
      if (!planPoints.has(point)) {
        unknownChars.push(`U+${point.toString(16).toUpperCase()}`);
      }
    }

    // --- check 6: the face must be swap and must point at a real file ---
    if (face.display !== 'swap') {
      badDisplay.push(`${fileName} (font-display: ${face.display || 'nothing'})`);
    }

    // --- the file itself --------------------------------------------------
    let content;
    try {
      content = await readFile(join(WEB_DIR, family.dir, fileName));
    } catch (error) {
      missingFiles.push(`${fileName} (${error.code ?? error.message})`);
      continue;
    }
    files += 1;
    bytes += content.length;

    hasher.update(fileName, 'utf8');
    hasher.update(content);

    const file = block.files.find((entry) => entry.name === fileName);
    if (file) file.bytes = content.length;

    // --- check 4: the size of the file ----------------------------------
    const limit = blockKey === 'hot' ? LIMITS.hotBytes : LIMITS.extBlockBytes;
    if (content.length > limit) {
      oversized.push(`${fileName} is ${content.length} B, the budget is ${limit} B`);
    }

    // --- check 3: the glyphs (the tofu gate) ----------------------------
    let font;
    try {
      font = fontkit.create(content);
    } catch (error) {
      errors.push(
        `[${family.key}] ${fileName} cannot be opened as a font: ${error.message}`,
      );
      continue;
    }
    const declaredSet = new Set(points);
    for (const point of points) {
      if (!font.hasGlyphForCodePoint(point)) {
        missingGlyphs.push(`${fileName} U+${point.toString(16).toUpperCase()}`);
      }
    }
    // The code points the file carries beyond what the face declares are
    // REPORTED, never failed: harfbuzz pulls the sibling code points of a
    // shared glyph along (serif ext-105 declares U+3010 and carries U+3011
    // as well), and a browser that picks either face can draw them.
    for (const point of font.characterSet) {
      if (point === NOTDEF_CODE_POINT) continue;
      if (declaredSet.has(point)) continue;
      extraCodepoints.push(`${fileName} U+${point.toString(16).toUpperCase()}`);
    }
  }

  const version = hasher.digest('hex').slice(0, 12);
  for (const face of faces) {
    const url = parseFaceUrl(face.src);
    if (!url) continue;
    if (!VERSION_PATTERN.test(url.token)) continue;
    if (url.token !== version) {
      wrongTokens.push(`${url.file} carries ${url.token}, the content hashes to ${version}`);
    }
  }

  stats.chars = declared.size;
  stats.blocks = blocks.size;
  stats.files = files;
  stats.bytes = bytes;
  stats.version = version;
  stats.extraCodepoints = extraCodepoints.length;
  stats.missingGlyphs = missingGlyphs.length;

  if (unknownChars.length > 0) {
    errors.push(
      `[${family.key}] the stylesheet claims ${unknownChars.length} code point(s) ` +
        `outside the charset of Task 1: ${summarize(unknownChars)}`,
    );
  }
  if (overlapping.length > 0) {
    errors.push(
      `[${family.key}] the blocks overlap: ${overlapping.length} code point(s) are ` +
        `claimed by two blocks — ${summarize(overlapping)}`,
    );
  }
  if (inconsistentBlocks.length > 0) {
    errors.push(
      `[${family.key}] the faces of ${inconsistentBlocks.length} block(s) do not ` +
        `declare the same unicode-range: ${summarize(inconsistentBlocks)}`,
    );
  }
  if (badDisplay.length > 0) {
    errors.push(
      `[${family.key}] ${badDisplay.length} face(s) do not say font-display: swap: ` +
        `${summarize(badDisplay)}`,
    );
  }
  if (badUrls.length > 0) {
    errors.push(
      `[${family.key}] ${badUrls.length} face(s) do not point at /font/web/…: ` +
        `${summarize(badUrls)}`,
    );
  }
  if (missingTokens.length > 0) {
    errors.push(
      `[${family.key}] ${missingTokens.length} URL(s) carry no usable version token: ` +
        `${summarize(missingTokens)}`,
    );
  }
  if (wrongTokens.length > 0) {
    errors.push(
      `[${family.key}] the version token does not match the bytes: ` +
        `${wrongTokens.length} URL(s) — ${summarize(wrongTokens)}`,
    );
  }
  if (missingFiles.length > 0) {
    errors.push(
      `[${family.key}] ${missingFiles.length} file(s) the stylesheet points at do not ` +
        `exist: ${summarize(missingFiles)}`,
    );
  }
  if (oversized.length > 0) {
    errors.push(
      `[${family.key}] ${oversized.length} file(s) are over their budget: ` +
        `${summarize(oversized)}`,
    );
  }
  if (missingGlyphs.length > 0) {
    errors.push(
      `[${family.key}] ${missingGlyphs.length} declared character(s) have no glyph in ` +
        `the file that declares them — tofu boxes: ${summarize(missingGlyphs)}`,
    );
  }
  if (badLabels.length > 0) {
    errors.push(
      `[${family.key}] ${badLabels.length} face(s) do not declare the family of the ` +
        `stylesheet and a normal font-style: ${summarize(badLabels)}`,
    );
  }
  if (badWeights.length > 0) {
    errors.push(
      `[${family.key}] ${badWeights.length} face(s) do not point at the file of their ` +
        `own weight: ${summarize(badWeights)}`,
    );
  }

  return {
    errors,
    stats,
    detail: { blocks, cpToBlock, css, extraCodepoints: extraCodepoints.slice(0, SAMPLE_SIZE) },
  };
}

/**
 * Check one family: its stylesheet, its files and its blocks.
 *
 * @param {object} family one entry of FAMILIES
 * @returns {Promise<{ ok: boolean, errors: string[], stats: object }>}
 */
export async function verifyFamily(family) {
  const plans = loadFamilyCharsets();
  const plan = plans[family.key];
  if (!plan) {
    return {
      ok: false,
      errors: [`[${family.key}] the charset plan of Task 1 has no family by that name`],
      stats: emptyStats(family),
    };
  }
  const report = await inspectFamily(family, plan);
  return { ok: report.errors.length === 0, errors: report.errors, stats: report.stats };
}

/**
 * Check the manifest against the stylesheets.
 */
async function checkManifest(cssByFile) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    return [`the manifest fonts-manifest.json cannot be read: ${error.message}`];
  }

  const version = manifest.version;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    errors.push(
      `the manifest version is ${JSON.stringify(version)}, it must be twelve ` +
        'lowercase hex characters',
    );
  }

  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  const expected = hash.digest('hex').slice(0, 12);
  if (version !== expected) {
    errors.push(
      `the manifest version is ${JSON.stringify(version)}, the three stylesheets ` +
        `hash to ${expected}`,
    );
  }

  const files = manifest.files ?? {};
  const keys = Object.keys(files).sort();
  const expectedKeys = ['sans', 'serif', 'wenkai'];
  if (keys.join(',') !== expectedKeys.join(',')) {
    errors.push(
      `the manifest lists ${keys.join(', ') || 'nothing'}, it must list exactly ` +
        expectedKeys.join(', '),
    );
  }

  // --- check 7: every family must point at its OWN stylesheet ------------
  errors.push(...checkManifestFiles(manifest, FAMILIES));

  return errors;
}

/**
 * Check what a page downloads: the bytes and the number of files.
 *
 * The rule of the design: a character in the hot tier makes the browser
 * fetch the hot file; a character in an Ext block makes it fetch that ONE
 * block. A block of a static family is two files (400 and 700), and a block
 * is only counted once no matter how many of its characters the page paints.
 *
 * @returns {Promise<{ errors: string[], costs: object[] }>}
 */
async function checkPageBudget(details) {
  const errors = [];
  const costs = [];
  let profiles;
  try {
    profiles = JSON.parse(await readFile(PROFILE_PATH, 'utf8'));
  } catch (error) {
    return {
      errors: [`the page profile fixture cannot be read: ${error.message}`],
      costs,
    };
  }
  const pages = profiles.pages ?? {};

  for (const path of Object.keys(LIMITS.pageFontBytes)) {
    const page = pages[path];
    if (!page) {
      errors.push(`the page profile fixture has no entry for ${path}`);
      continue;
    }
    let bytes = 0;
    let files = 0;
    const unpainted = [];
    for (const family of FAMILIES) {
      const detail = details[family.key];
      if (!detail) continue;
      const chars = page[family.key] ?? '';
      const blocks = new Set();
      for (const ch of chars) {
        const point = ch.codePointAt(0);
        const blockKey = detail.cpToBlock.get(point);
        if (blockKey === undefined) {
          unpainted.push(`${family.key} U+${point.toString(16).toUpperCase()}`);
          continue;
        }
        blocks.add(blockKey);
      }
      for (const blockKey of blocks) {
        const block = detail.blocks.get(blockKey);
        for (const file of block.files) {
          bytes += file.bytes;
          files += 1;
        }
      }
    }

    const budget = LIMITS.pageFontBytes[path];
    if (bytes > budget) {
      errors.push(
        `the page ${path} downloads ${bytes} B of fonts, the budget is ${budget} B`,
      );
    }
    if (files > LIMITS.maxFontFilesPerPage) {
      errors.push(
        `the page ${path} downloads ${files} font files, the budget is ` +
          `${LIMITS.maxFontFilesPerPage}`,
      );
    }
    costs.push({
      path,
      bytes,
      files,
      budget,
      unpainted: unpainted.length,
      unpaintedChars: unpainted,
    });
  }
  return { errors, costs };
}

/**
 * Check every family and then the things that span the families.
 *
 * @returns {Promise<{ ok: boolean, errors: string[], stats: object[], costs: object[] }>}
 */
export async function verifyAll() {
  const errors = [];
  const stats = [];
  const details = {};
  const extras = {};
  const cssByFile = {};

  const plans = loadFamilyCharsets();
  for (const family of FAMILIES) {
    const plan = plans[family.key];
    if (!plan) {
      errors.push(
        `the charset plan of Task 1 has no family by the name ${family.key}`,
      );
      continue;
    }
    const report = await inspectFamily(family, plan);
    errors.push(...report.errors);
    stats.push(report.stats);
    details[family.key] = report.detail;
    extras[family.key] = report.detail ? report.detail.extraCodepoints : [];
    if (report.detail) cssByFile[family.css] = report.detail.css;
  }

  // --- check 5: the three stylesheets together ---------------------------
  const cssGzipTotal = stats.reduce((sum, entry) => sum + entry.cssGzipBytes, 0);
  if (cssGzipTotal > LIMITS.cssBytes) {
    errors.push(
      `the three stylesheets are ${cssGzipTotal} B gzipped together, the budget is ` +
        `${LIMITS.cssBytes} B`,
    );
  }

  // --- check 7: the manifest ---------------------------------------------
  errors.push(...(await checkManifest(cssByFile)));

  // --- check 8: the page budget ------------------------------------------
  const pages = await checkPageBudget(details);
  errors.push(...pages.errors);

  return { ok: errors.length === 0, errors, stats, costs: pages.costs, extras };
}

/**
 * The CLI.
 */
async function main() {
  const result = await verifyAll();
  const cssGzipTotal = result.stats.reduce((sum, entry) => sum + entry.cssGzipBytes, 0);

  for (const entry of result.stats) {
    const megabytes = (entry.bytes / 1024 / 1024).toFixed(1);
    const problems = result.errors.filter((message) => message.startsWith(`[${entry.key}]`));
    const mark = problems.length === 0 ? 'OK' : `${problems.length} ERROR(S)`;
    console.log(
      `[verify] ${entry.key.padEnd(7)}: ${entry.chars} chars, ${entry.files} files, ` +
        `~${megabytes} MB   ${mark}`,
    );
    for (const message of problems) console.log(`[verify]   ${message}`);
    if (entry.extraCodepoints > 0) {
      console.log(
        `[verify]   info: ${entry.extraCodepoints} code point(s) the files carry ` +
          'beyond the ranges they declare (reported, not failed)',
      );
    }
    const extra = result.extras[entry.key] ?? [];
    if (extra.length > 0) {
      console.log(`[verify]   info: ${extra.join(', ')}`);
    }
  }

  const cssMark = cssGzipTotal > LIMITS.cssBytes ? 'ERROR' : 'OK';
  console.log(
    `[verify] css    : ${cssGzipTotal} B gzip of ${LIMITS.cssBytes} B   ${cssMark}`,
  );

  const pageMark = result.costs.some(
    (cost) => cost.bytes > cost.budget || cost.files > LIMITS.maxFontFilesPerPage,
  )
    ? 'ERROR'
    : 'OK';
  console.log(
    '[verify] pages  : ' +
      result.costs
        .map(
          (cost) =>
            `${cost.path} ${Math.round(cost.bytes / 1024)} KB / ${cost.files} files`,
        )
        .join('   ') +
      `   ${pageMark}`,
  );
  for (const cost of result.costs) {
    if (cost.unpainted > 0) {
      console.log(
        `[verify]   info: the page ${cost.path} paints ${cost.unpainted} ` +
          `character(s) that no subset claims (the font stack falls back for them): ` +
          cost.unpaintedChars.join(', '),
      );
    }
  }

  const reported = new Set();
  for (const entry of result.stats) {
    for (const message of result.errors) {
      if (message.startsWith(`[${entry.key}]`)) reported.add(message);
    }
  }
  for (const message of result.errors) {
    if (!reported.has(message)) console.log(`[verify]   ${message}`);
  }

  console.log(`[verify] ${result.errors.length} error(s)`);
  process.exitCode = result.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      `[verify] the verification itself failed: ${error.stack ?? error.message}`,
    );
    process.exitCode = 1;
  });
}
