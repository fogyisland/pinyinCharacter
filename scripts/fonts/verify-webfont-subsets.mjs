/**
 * scripts/fonts/verify-webfont-subsets.mjs — proves the shipped webfont
 * subsets are correct.
 *
 * Why this exists: the site ships 7 982 woff2 files (three families, a hot
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
 *   7. manifest      the version is the hash of the three stylesheets
 *   8. pages         what a page downloads stays inside the page budget:
 *                    the SAMPLE of the live pages is the gate, and the seed
 *                    of the hot tier is only its LOWER BOUND
 *   9. tokens        every URL carries the hash of the bytes it serves (R18)
 *  10. identity      every face declares the family of the stylesheet and a
 *                     normal font-style
 *  11. weights       a static face points at the file of its OWN weight
 *  12. directories   every face points at the directory of its own family,
 *                     and the file is read along the URL's own path
 *  13. manifest      every family points at EXACTLY its own stylesheet
 *  14. latin         the Latin tier really covers the Latin characters the
 *                     pages paint, and it is built out of the 24 tone vowels
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import * as fontkit from 'fontkit';

import { FAMILIES } from './build-webfont-subsets.mjs';
import {
  isLatinChar,
  loadFamilyCharsets,
  loadFamilyCoverage,
  loadToneVowels,
} from './webfont-charset.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/**
 * The font root: the tree the artefacts are read from.
 *
 * `WEBFONT_FONT_DIR` overrides it, so a candidate build can be checked
 * instead of the published one. A RELATIVE path is resolved against the
 * repository root and NOT against the working directory — the same rule
 * the subsetter follows, and the same name for the same thing: the two
 * scripts have to point at ONE tree, or the checker checks a tree nobody
 * cut.
 *
 * ⚠️ ONE environment variable names ONE thing: there is no second
 * variable for the web directory.
 *
 * @param {Record<string, string|undefined>} env the environment to read
 * @returns {string} the absolute path of the font root
 */
export function resolveFontDir(env = process.env) {
  const override = env.WEBFONT_FONT_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(ROOT, override.trim());
  }
  return join(ROOT, 'public', 'font');
}

/** Where the artefacts are read from. */
const FONT_DIR = resolveFontDir();

/** Where the subsets are read from. */
const WEB_DIR = join(FONT_DIR, 'web');

/** Where the manifest is read from. */
const MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json');

/**
 * Whether the page cost is ENFORCED (the gate) or only REPORTED.
 *
 * The page cost is measured against the union sample of the LIVE pages,
 * so it describes the PUBLISHED tree and not a candidate: a candidate
 * that is checked against it would be judged by a ruler that does not
 * measure it. In `report` mode the page cost is measured and printed,
 * and it does not fail the run; every other check — the Latin tier, the
 * shape of the sample, the two guards against a circular gate — still
 * fails the run, because those are properties of the candidate itself.
 *
 * A misspelled mode THROWS: silently falling back to `enforce` would
 * turn a typo into a red run nobody understands, and falling back to
 * `report` would turn it into a green one nobody asked for.
 *
 * @param {Record<string, string|undefined>} env the environment to read
 * @returns {'enforce'|'report'} the mode of the page cost
 */
export function resolvePageCostMode(env = process.env) {
  const raw = env.WEBFONT_PAGE_COST;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 'enforce';
  }
  const mode = String(raw).trim();
  if (mode === 'enforce' || mode === 'report') {
    return mode;
  }
  throw new Error(
    `WEBFONT_PAGE_COST must be "enforce" or "report", got "${String(raw)}"`,
  );
}

/**
 * The seed of the hot tier: `data/font-page-profiles.json`.
 *
 * ⚠️ It is NOT a page. It holds the characters the four measured pages
 * painted in ONE round, and it is the seed the hot tier is built from — so
 * the characters it holds are in the hot tier BY CONSTRUCTION, it never
 * reaches an Ext block, and it can never tell what a page really
 * downloads. It is the LOWER BOUND of a page, and the budget gate reports
 * it as such; it never fails the run.
 */
const SEED_PATH = join(ROOT, 'data', 'font-page-profiles.json');

/**
 * The sample of the live pages: `data/font-page-sample.json`.
 *
 * ⚠️ This is the ruler of the page budget: the union of several rounds of
 * the four measured pages. It reaches the Ext layer the seed cannot reach,
 * so the gate really measures what a page downloads.
 *
 * ⚠️ The path can be pointed somewhere else with WEBFONT_SAMPLE_PATH, and
 * ONLY the sample: the seed and the font root are not touched by it. The
 * override exists so that the anti-circularity guard can be PROVED — a run
 * with the seed in the place of the sample has to fail, and the only way
 * to show that is to run the verifier against a file.
 */
const SAMPLE_PATH = process.env.WEBFONT_SAMPLE_PATH
  ? resolve(ROOT, process.env.WEBFONT_SAMPLE_PATH)
  : join(ROOT, 'data', 'font-page-sample.json');

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
  latinBytes: 12 * 1024, // 拉丁 hot 块的单文件上限（拉丁尾巴复用 extBlockBytes）
  // ⚠️ The three numbers below are the budgets of the LIVE pages, and they
  // are MEASUREMENTS, not wishes: the maxima of the 32 samples of
  // 2026-10-31 (16 on the local build, 16 on the live site) plus 25 % of
  // headroom.
  //   /            448 488 B × 1.25 = 560 610 B → 547 KB = 560 128 B
  //   /dictionary  330 688 B × 1.25 = 413 360 B → 403 KB = 412 672 B
  //   /poetry      241 204 B × 1.25 = 301 505 B → 294 KB = 301 056 B
  //   /stories     741 324 B × 1.25 = 926 655 B → 904 KB = 925 696 B
  // The file count: 123 files × 1.25 = 153.75 → 153.
  // ⚠️ `/` and `/stories` paint a RANDOM story, so their payload moves from
  // request to request (495 316 – 741 324 B on /stories, about 1.50×) — the
  // headroom is what keeps the budget from turning into a false alarm on
  // the next sample.
  maxFontFilesPerPage: 153,
  pageFontBytes: {
    '/': 560128,
    '/dictionary': 412672,
    '/poetry': 301056,
    '/stories': 925696,
  },
  // ⚠️ The budgets of the UNION SAMPLE — the eight rounds of the live pages
  // the gate measures. They are the measured bytes rounded UP to a whole KB,
  // with no headroom: the sample IS the upper bound of what one visit
  // downloads, so a budget above it would be a wish.
  //   / 849 916 B → 830 KB = 849 920 B      /dictionary 329 448 B → 322 KB = 329 728 B
  //   /poetry 239 788 B → 235 KB = 240 640 B   /stories 1 234 088 B → 1 206 KB = 1 234 944 B
  unionSampleBytes: {
    '/': 849920,
    '/dictionary': 329728,
    '/poetry': 240640,
    '/stories': 1234944,
  },
  maxUnionSampleFilesPerPage: 260,
};

/**
 * The block of the hot tier.
 *
 * A character the hot tier covers is not an ext-layer character: the
 * browser downloads the hot file for it and nothing else. Every other
 * block — the Latin tier and the Ext blocks — is the layer a page only
 * touches when it paints characters the hot tier does not hold.
 */
const HOT_BLOCK = 'hot';

/**
 * The pages whose content never changes.
 *
 * Two of the four measured pages answer with the same body on every
 * request: the dictionary index and the poetry index. Their characters
 * must be the SAME in the sample and in the seed — when they are not, the
 * capture did not see what it claims to have seen, and the sample cannot
 * be trusted as the ruler of the page budget.
 */
const DETERMINISTIC_PAGES = ['/dictionary', '/poetry'];


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
 * The URL of a face: the directory, the file, the version token and the
 * OPTIONAL release directory.
 *
 * ⚠️ The release directory is the publish directory model: an apply writes
 * a new tree under `/font/web/r<token>/` and points the stylesheets at it,
 * so the URL of a face may carry one more segment. It is OPTIONAL — the
 * URL without one is the URL of the published tree, and it parses to the
 * same answer as it always did.
 *
 * ⚠️ The release segment is `r` followed by lowercase hex, and nothing
 * else: a segment that is neither a family nor a release is a URL that does
 * not point at `/font/web/`, and it is reported as such instead of being
 * read as a family name.
 *
 * ⚠️ The two-segment form is tried FIRST. A URL that carries no release
 * must never be read as one, or `dir` would name the release instead of
 * the family.
 *
 * @param {string} src the URL of the face
 * @returns {{ dir: string, file: string, token: string, release: string } | null}
 */
export function parseFaceUrl(src) {
  const plain = /^\/font\/web\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$/.exec(src);
  if (plain) {
    return { dir: plain[1], file: plain[2], token: plain[3] ?? '', release: '' };
  }
  const released = /^\/font\/web\/(r[0-9a-f]+)\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$/.exec(src);
  if (released) {
    return {
      dir: released[2],
      file: released[3],
      token: released[4] ?? '',
      release: released[1],
    };
  }
  return null;
}

/**
 * The file of a face as the operator has to look it UP on the disk.
 *
 * ⚠️ With a release directory the file lives at
 * `/font/web/<release>/<family>/<file>`, and the bare name would point at
 * release 0's copy — which may well still be there. So a released file is
 * named by its path relative to `WEB_DIR`.
 *
 * ⚠️ WITHOUT a release the messages have always said the bare file name,
 * and they keep saying it: a name that is not a path says so, while a name
 * that LOOKS like a path but is not one is worse than no name at all.
 *
 * @param {{ dir: string, file: string, release: string }} url the parsed URL
 * @returns {string} the file as the operator has to look it up
 */
function fileLabel(url) {
  if (!url.release) return url.file;
  return `${url.release}/${url.dir}/${url.file}`;
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
 * Check that a face points at the directory of its OWN family.
 *
 * The directory in the URL is what the BROWSER downloads from. A face that
 * points at the directory of another family hands the page a different
 * typeface — and the R18 token of the family no longer describes the bytes
 * that are served under it.
 *
 * A face whose URL cannot be parsed is reported by the main loop already
 * (`badUrls`), so nothing is reported twice here.
 *
 * @param {{ key: string, dir: string }} family the family of the stylesheet
 * @param {{ src: string }} face
 * @returns {string[]} the messages of the failures, empty when the face is right
 */
export function checkFaceDirectory(family, face) {
  const url = parseFaceUrl(face.src);
  if (!url) return [];
  if (url.dir === family.dir) return [];
  return [
    `[${family.key}] the face ${face.src} points at the directory ${url.dir}, ` +
      `it must point at the directory of the family (${family.dir})`,
  ];
}

/**
 * Check that the manifest points every family at EXACTLY its own stylesheet.
 *
 * `lib/font-css.ts` builds the URL of the stylesheet of a family out of
 * `manifest.files.<family>`. A manifest that points `serif` at
 * `fonts-sans.css` would drop the serif stylesheet from the page, and a
 * manifest that points `sans` at a path that does not exist would link the
 * page to a 404 — the whole family would fall back to the system font.
 *
 * The expected paths are derived from the family, not written out a
 * third time: they are `/font/` plus the names of the TWO stylesheets
 * of the family — the hot tier and the ext tier.
 *
 * The ext tier has a key of its own (`<family>Ext`), because the
 * manifest is the single source of truth for `lib/font-css.ts` and the
 * layout links the two tiers separately.
 *
 * @param {{ files?: Record<string, string> }} manifest the parsed manifest
 * @param {Array<{ key: string, css: string, cssHot: string, cssExt: string }>} families the families of the site
 * @returns {string[]} the messages of the failures, empty when the manifest is right
 */
export function checkManifestFiles(manifest, families) {
  const errors = [];
  const files = manifest?.files ?? {};
  for (const family of families) {
    for (const [key, name] of [
      [family.key, family.cssHot],
      [`${family.key}Ext`, family.cssExt],
    ]) {
      const value = files[key];
      if (typeof value !== 'string' || value === '') {
        errors.push(`the manifest lists no stylesheet for ${key}`);
        continue;
      }
      const expected = `/font/${name}`;
      if (value !== expected) {
        errors.push(
          `the manifest points ${key} at ${value}, it must point at exactly ` +
            `${expected}`,
        );
      }
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
 * The version token of a family: the hash of its subset files, in the
 * order the build wrote them.
 *
 * That order is the order of the BLOCKS of the plan: the hot block
 * first, then the Chinese ext blocks by their index, then the Latin hot
 * block, then the Latin ext blocks by their index. It is NOT the order
 * of the faces in the stylesheets: the stylesheets are split into a hot
 * tier and an ext tier, and the hot tier holds the hot block AND the
 * Latin hot block.
 *
 * ⚠️ `blocksOf()` of the builder walks the plan in exactly this
 * sequence, and the two implementations have to agree — the token the
 * stylesheets carry is the token the build computed.
 *
 * @param {object} plan the charset plan of the family
 * @param {{ key: string, variable: boolean, weights: string[] }} family the family
 * @param {string[]} fileOrder the file names, in the order they were met
 * @param {Map<string, Buffer>} fileBytes the bytes of every file
 * @returns {string} the token, twelve lowercase hex characters
 */
function versionTokenOf(plan, family, fileOrder, fileBytes) {
  // The blocks of the plan, in the order of the builder.
  const pad3 = (index) => String(index).padStart(3, '0');
  const blockKeys = ['hot'];
  for (const block of [...plan.extBlocks].sort((a, b) => a.index - b.index)) {
    blockKeys.push(`ext-${pad3(block.index)}`);
  }
  const latin = plan.latin;
  if (latin) {
    blockKeys.push('latin');
    for (const block of [...latin.extBlocks].sort((a, b) => a.index - b.index)) {
      blockKeys.push(`latin-ext-${pad3(block.index)}`);
    }
  }

  // The files of every block, in the order the faces of the block name
  // them: for a static family the weight pair of one block shares the
  // unicode-range and is written in the order of the weights.
  const filesOfBlock = new Map();
  for (const name of fileOrder) {
    const key = blockKeyOf(family, name);
    if (!filesOfBlock.has(key)) filesOfBlock.set(key, []);
    filesOfBlock.get(key).push(name);
  }

  const hash = createHash('sha256');
  for (const key of blockKeys) {
    const names = filesOfBlock.get(key);
    if (!names) continue;
    for (const name of names) {
      hash.update(name, 'utf8');
      hash.update(fileBytes.get(name));
    }
  }
  return hash.digest('hex').slice(0, 12);
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

/**
 * The code points of the charset plan of Task 1.
 *
 * ⚠️ The LATIN tier is part of the plan and has to be read here: a Latin
 * face declares a `unicode-range` that is computed from the plan, and a
 * plan the checker does not know about turns EVERY Latin face into an
 * "unknown character" error.
 */
function planCodePoints(plan) {
  const points = new Set();
  for (const ch of plan.hot) points.add(ch.codePointAt(0));
  for (const block of plan.extBlocks) {
    for (const ch of block.chars) points.add(ch.codePointAt(0));
  }
  const latin = plan.latin;
  if (latin) {
    for (const ch of latin.hot) points.add(ch.codePointAt(0));
    for (const block of latin.extBlocks) {
      for (const ch of block.chars) points.add(ch.codePointAt(0));
    }
  }
  return points;
}

/**
 * The Latin characters of a page that no BUILT block claims.
 *
 * Two kinds, and the difference between them is the whole point:
 *
 *   `missing`      the source font CAN draw the character, but no subset of
 *                  the family claims it ⇒ the Latin tier was never built, or
 *                  it was built and lost this character ⇒ **an error**
 *   `unsupported`  the source font CANNOT draw the character ⇒ the browser
 *                  falls back to the system font, which is a limit of the
 *                  FONT and not a bug of the pipeline ⇒ **reported only**
 *
 * ⚠️ The scope comes from the shared glyph coverage of the source fonts
 * (`loadFamilyCoverage` of scripts/fonts/webfont-charset.mjs) — the SAME
 * capability the plan builder filters the Latin tier with. A second copy of
 * "which characters does this font have" here would drift from the plan, and
 * a drifting scope turns a real error into a silent one (or the other way
 * around: a false red that makes people relax the rule, and the blind spot
 * comes back).
 *
 * ⚠️ When the coverage cannot be read (a checkout without the staging
 * fonts) EVERY unpainted Latin character is reported as `missing`: the
 * check then errs towards red, because a green that cannot be trusted is
 * worse than a red that can be explained.
 *
 * @param {string} chars the characters of one page and one family
 * @param {Map<number, string>} cpToBlock the code points the BUILT stylesheet claims
 * @param {Set<number> | null} covered the code points the source fonts can draw
 * @returns {{ missing: number[], unsupported: number[] }}
 */
export function classifyUnpaintedLatin(chars, cpToBlock, covered) {
  const missing = [];
  const unsupported = [];
  const seen = new Set();
  for (const ch of chars) {
    if (!isLatinChar(ch)) continue;
    const point = ch.codePointAt(0);
    if (seen.has(point)) continue;
    seen.add(point);
    if (cpToBlock.get(point) !== undefined) continue;
    if (covered && !covered.has(point)) unsupported.push(point);
    else missing.push(point);
  }
  return { missing, unsupported };
}

/**
 * The Latin hot block of a family must declare the 24 tone vowels.
 *
 * The tone marks are NOT in the page fixture — the four measured pages
 * paint at most a handful of them — so they are in the Latin hot tier
 * because of `lib/pinyin-tone.ts`, not because of the fixture. This
 * assertion is therefore NOT idle: it proves that the Latin tier was built
 * out of the tone table and not out of the fixture.
 *
 * @param {{ key: string, label: string }} family
 * @param {{ points: Set<number> } | undefined} latinBlock the BUILT Latin hot block
 * @param {string[]} toneVowels the 24 tone vowels of `lib/pinyin-tone.ts`
 * @returns {string[]} the messages of the failures, empty when the block is right
 */
export function checkLatinToneVowels(family, latinBlock, toneVowels) {
  if (!latinBlock) {
    return [
      `[${family.key}] the stylesheet has no Latin hot block — the Latin tier of ` +
        `${family.label} was never built`,
    ];
  }
  const missing = toneVowels.filter(
    (vowel) => !latinBlock.points.has(vowel.codePointAt(0)),
  );
  if (missing.length === 0) return [];
  return [
    `[${family.key}] the Latin hot block does not declare ${missing.length} of the ` +
      `${toneVowels.length} tone vowels of lib/pinyin-tone.ts: ${missing.join('')} — the ` +
      'tone marks of the game would fall back to the system font',
  ];
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
    latinBlocks: 0,
    latinChars: 0,
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

  // TWO stylesheets per family: the hot tier (render-blocking) and the
  // ext tier (loaded with media="print" and promoted). Both are read,
  // and the faces of the two together are what the family declares —
  // a face of the ext tier is a face of the family just as much as a
  // face of the hot tier.
  //
  // The gzip budget of the render-blocking stylesheet is measured on
  // the HOT TIER ALONE: it is the only stylesheet the browser has to
  // parse before it can paint a character.
  const cssPath = join(FONT_DIR, family.cssHot);
  let cssRaw;
  try {
    cssRaw = await readFile(cssPath, 'utf8');
  } catch (error) {
    errors.push(
      `[${family.key}] the stylesheet ${family.cssHot} cannot be read: ${error.message}`,
    );
    return { errors, stats, detail: null };
  }
  const css = normalizeNewlines(cssRaw);
  stats.cssBytes = Buffer.byteLength(css, 'utf8');
  stats.cssGzipBytes = gzipSync(Buffer.from(css, 'utf8')).length;

  const extPath = join(FONT_DIR, family.cssExt);
  let extRaw;
  try {
    extRaw = await readFile(extPath, 'utf8');
  } catch (error) {
    errors.push(
      `[${family.key}] the stylesheet ${family.cssExt} cannot be read: ${error.message}`,
    );
    return { errors, stats, detail: null };
  }
  const extCss = normalizeNewlines(extRaw);
  // The gzip budget of the family is the sum of the two tiers: the
  // browser downloads both, as two responses with two gzip streams.
  const familyGzipBytes =
    stats.cssGzipBytes + gzipSync(Buffer.from(extCss, 'utf8')).length;

  const faces = [...parseFaces(css), ...parseFaces(extCss)];
  stats.faces = faces.length;

  // --- check 5: the face count of the stylesheet --------------------------
  if (faces.length > LIMITS.maxFacesPerCss) {
    errors.push(
      `[${family.key}] ${family.cssHot} and ${family.cssExt} declare ` +
        `${faces.length} faces, the budget is ${LIMITS.maxFacesPerCss}`,
    );
  }

  // --- check 5: the blocking stylesheet has its own budget ----------------
  if (family.key === 'sans' && stats.cssGzipBytes > LIMITS.sansCssBytes) {
    errors.push(
      `[${family.key}] ${family.cssHot} is ${stats.cssGzipBytes} B gzipped, ` +
        `the budget of the render blocking stylesheet is ${LIMITS.sansCssBytes} B`,
    );
  }

  // --- check 5: the whole family has its own budget ------------------------
  if (familyGzipBytes > LIMITS.cssBytes) {
    errors.push(
      `[${family.key}] ${family.cssHot} and ${family.cssExt} are ` +
        `${familyGzipBytes} B gzipped together, the budget is ${LIMITS.cssBytes} B`,
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
  const badDirectories = [];
  let files = 0;
  let bytes = 0;

  // The subset files are COLLECTED here, not hashed: the order the build
  // wrote them in is the order of the blocks of the plan, and the faces
  // of the two stylesheets are not in that order any more (the hot
  // stylesheet holds the hot block AND the Latin hot block). The hash is
  // taken below, in the plan's order.
  const fileBytes = new Map();
  const fileOrder = [];

  for (const face of faces) {
    // --- check 10: the face must declare the family and the style ---------
    for (const message of checkFaceFamily(family, face)) {
      badLabels.push(message);
    }
    // --- check 11: a static face must point at the file of its weight -----
    for (const message of checkFaceWeight(family, face)) {
      badWeights.push(message);
    }
    // --- check 12: the face must point at the directory of its family -----
    for (const message of checkFaceDirectory(family, face)) {
      badDirectories.push(message);
    }

    const url = parseFaceUrl(face.src);
    if (!url) {
      badUrls.push(face.src);
      continue;
    }
    const fileName = url.file;
    const token = url.token;
    // ⚠️ The release directory is part of the path the operator has to look
    // at: a file that is missing under /font/web/r<token>/ is NOT the file
    // of release 0, which may well be there. The prefix is EMPTY for
    // release 0, so the messages of the published tree stay word for word
    // what they were.
    const releasePrefix = url.release ? `${url.release}/` : '';
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
    // The path is the URL's OWN path: the file the browser downloads is
    // the file that is checked here. The directory check above holds the
    // URL to the directory of the family, so the two are equivalent on a
    // legal artefact — but each of them stands on its own, so neither can
    // be removed silently.
    // ⚠️ The release directory is part of the URL's own path. `path.join`
    // drops the empty segment, so a URL without a release is read from
    // exactly the path it was read from before.
    let content;
    try {
      content = await readFile(join(WEB_DIR, url.release, url.dir, url.file));
    } catch (error) {
      missingFiles.push(
        `${releasePrefix}${url.dir}/${fileName} (${error.code ?? error.message})`,
      );
      continue;
    }
    files += 1;
    bytes += content.length;

    if (!fileBytes.has(fileName)) fileOrder.push(fileName);
    fileBytes.set(fileName, content);

    const file = block.files.find((entry) => entry.name === fileName);
    if (file) file.bytes = content.length;

    // --- check 4: the size of the file ----------------------------------
    // Three budgets, one per kind of block: the Chinese hot tier, the Latin
    // hot tier and the Ext blocks (the Latin TAIL reuses the Ext budget).
    // The budget is per FILE, not per block: the brand face cuts one block
    // into two files (400 and 700) and each of them is checked on its own.
    const limit =
      blockKey === 'hot' ? LIMITS.hotBytes
      : blockKey === 'latin' ? LIMITS.latinBytes
      : LIMITS.extBlockBytes;
    if (content.length > limit) {
      oversized.push(
        `${fileLabel(url)} is ${content.length} B, the budget is ${limit} B`,
      );
    }

    // --- check 3: the glyphs (the tofu gate) ----------------------------
    let font;
    try {
      font = fontkit.create(content);
    } catch (error) {
      errors.push(
        `[${family.key}] ${fileLabel(url)} cannot be opened as a font: ${error.message}`,
      );
      continue;
    }
    const declaredSet = new Set(points);
    for (const point of points) {
      if (!font.hasGlyphForCodePoint(point)) {
        missingGlyphs.push(
          `${fileLabel(url)} U+${point.toString(16).toUpperCase()}`,
        );
      }
    }
    // The code points the file carries beyond what the face declares are
    // REPORTED, never failed: harfbuzz pulls the sibling code points of a
    // shared glyph along (serif ext-105 declares U+3010 and carries U+3011
    // as well), and a browser that picks either face can draw them.
    for (const point of font.characterSet) {
      if (point === NOTDEF_CODE_POINT) continue;
      if (declaredSet.has(point)) continue;
      extraCodepoints.push(`${fileLabel(url)} U+${point.toString(16).toUpperCase()}`);
    }
  }

  const version = versionTokenOf(plan, family, fileOrder, fileBytes);
  for (const face of faces) {
    const url = parseFaceUrl(face.src);
    if (!url) continue;
    if (!VERSION_PATTERN.test(url.token)) continue;
    if (url.token !== version) {
      wrongTokens.push(
        `${fileLabel(url)} carries ${url.token}, the content hashes to ${version}`,
      );
    }
  }

  stats.chars = declared.size;
  stats.blocks = blocks.size;
  stats.latinBlocks = [...blocks.keys()].filter(
    (key) => key === 'latin' || key.startsWith('latin-ext'),
  ).length;
  stats.latinChars = [...blocks.entries()]
    .filter(([key]) => key === 'latin' || key.startsWith('latin-ext'))
    .reduce((sum, [, block]) => sum + block.points.size, 0);
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
  if (badDirectories.length > 0) {
    errors.push(
      `[${family.key}] ${badDirectories.length} face(s) do not point at the directory of ` +
        `their own family: ${summarize(badDirectories)}`,
    );
  }

  return {
    errors,
    stats,
    detail: {
      blocks,
      cpToBlock,
      css,
      extCss,
      extraCodepoints: extraCodepoints.slice(0, SAMPLE_SIZE),
    },
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
      `the manifest version is ${JSON.stringify(version)}, the six stylesheets ` +
        `hash to ${expected}`,
    );
  }

  const files = manifest.files ?? {};
  const keys = Object.keys(files).sort();
  const expectedKeys = [
    'sans',
    'sansExt',
    'serif',
    'serifExt',
    'wenkai',
    'wenkaiExt',
  ];
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
 * The glyph coverage of the source fonts, or null when it cannot be read.
 *
 * The coverage is the ONE rule that knows what a source font can draw, and
 * it lives in scripts/fonts/webfont-charset.mjs — the plan builder filters
 * the Latin tier with it, and this checker scopes the unpainted Latin
 * characters with it. Two copies would drift, and a drifting scope is a
 * blind spot that reports green.
 *
 * The sources are not tracked by git, so a checkout without them cannot
 * scope the Latin characters. That is reported, not hidden: without the
 * scope every unpainted Latin character is reported as an error.
 */
function loadCoverageOrNull() {
  try {
    return loadFamilyCoverage();
  } catch (error) {
    console.warn(
      `[verify] ${error.message} — the unpainted Latin characters cannot be scoped ` +
        'by the glyph coverage, so every unpainted Latin character is reported as an error',
    );
    return null;
  }
}

/**
 * Read a profile file.
 *
 * @param {string} path the file to read
 * @param {string} label what the file is called in the messages
 * @returns {Promise<{ ok: boolean, value: object | null, error: string | null }>}
 */
async function readProfile(path, label) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: `the ${label} cannot be read: ${error.message}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw), error: null };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: `the ${label} is not valid JSON: ${error.message}`,
    };
  }
}

/**
 * Check that a profile holds Latin characters at all.
 *
 * A profile without a single Latin character makes the page budget check of
 * the Latin tier an EMPTY SET: there is nothing for the check to look at, so
 * it reports green — and a Latin tier that was never built looks exactly the
 * same as a Latin tier that is fine. That blind spot is why this check
 * exists.
 *
 * ⚠️ It is a failure of the FIXTURE, not of the page cost, so it belongs to
 * the `fixtureErrors` channel and it fails the run for the seed as well as
 * for the sample. (The budget findings of the seed are demoted to notes
 * because the seed is a lower bound and not a page — a broken fixture is
 * neither.)
 *
 * The function is PURE: it reads the profile and returns one message or an
 * empty array.
 *
 * @param {object} profile the whole profile to look at
 * @param {string} label what the profile is called in the messages
 * @returns {string[]} one message when the profile holds no Latin at all,
 *   an empty array when it does
 */
export function checkProfileHasLatin(profile, label) {
  const pages = profile?.pages ?? {};
  let profileLatin = 0;
  for (const path of Object.keys(pages)) {
    const page = pages[path] ?? {};
    for (const family of FAMILIES) {
      for (const ch of page[family.key] ?? '') {
        if (isLatinChar(ch)) profileLatin += 1;
      }
    }
  }
  if (profileLatin === 0) {
    return [
      `the ${label} holds no Latin character at all — the page budget check of the ` +
        'Latin tier would be empty, so a missing Latin tier would report green',
    ];
  }
  return [];
}

/**
 * Measure what the pages of ONE profile download: the bytes and the number
 * of files.
 *
 * The rule of the design: a character in the hot tier makes the browser
 * fetch the hot file; a character in an Ext block makes it fetch that ONE
 * block. A block of a static family is two files (400 and 700), and a block
 * is only counted once no matter how many of its characters the page paints.
 *
 * ⚠️ The Latin characters of the profile are counted here too: they are
 * painted by the page, so the browser downloads the Latin subsets — and a
 * page budget that does not count them does not know what the page costs.
 *
 * ⚠️ A Latin character that NO block claims is an ERROR (see
 * `classifyUnpaintedLatin`): that is the "the Latin tier was never built"
 * case, and the blind spot of the budget gate closes here. The Chinese
 * characters that no block claims keep the behaviour they always had: they
 * are reported and not failed.
 *
 * @param {Record<string, object>} details the block map of every family
 * @param {object} profile the profile to measure
 * @param {{ bytes: Record<string, number>, files: number }} limits the budgets
 * @param {string} label what the profile is called in the messages
 * @returns {Promise<{ budgetErrors: string[], latinErrors: string[],
 *   fixtureErrors: string[], costs: object[], extChars: number }>}
 */
async function measureProfile(details, profile, limits, label) {
  const budgetErrors = [];
  const latinErrors = [];
  const fixtureErrors = [];
  const costs = [];
  const pages = profile?.pages ?? {};

  // The coverage is read ONCE and only when there is something to scope:
  // the source fonts are 65 MB and a run with nothing unpainted does not
  // need them.
  let coverage = null;
  let coverageLoaded = false;
  const coverageOf = (familyKey) => {
    if (!coverageLoaded) {
      coverageLoaded = true;
      coverage = loadCoverageOrNull();
    }
    if (!coverage) return null;
    return coverage[familyKey] ?? null;
  };

  // --- the profile must hold Latin at all --------------------------------
  // Without it the check below has nothing to check, and a check with
  // nothing to check reports green — that is the "the fixture was never
  // updated" blind spot.
  // ⚠️ It is a failure of the FIXTURE, not of the page cost ⇒ it goes into
  // `fixtureErrors` and it is NOT demoted to a note the way the budget
  // findings of the seed are. A broken fixture makes every number of this
  // report a lie, so it must not be able to pass.
  fixtureErrors.push(...checkProfileHasLatin(profile, label));

  // The characters the hot tier does NOT cover: the ext layer of the page.
  // It is the depth of the profile, and the gate compares the depth of the
  // sample with the depth of the seed.
  let extChars = 0;

  for (const path of Object.keys(limits.bytes)) {
    const page = pages[path];
    if (!page) {
      budgetErrors.push(`the ${label} has no entry for ${path}`);
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
      const painted = new Set();
      for (const ch of chars) {
        const point = ch.codePointAt(0);
        if (painted.has(point)) continue;
        painted.add(point);
        const blockKey = detail.cpToBlock.get(point);
        if (blockKey === undefined) {
          // The Chinese part keeps its behaviour: reported, not failed.
          if (!isLatinChar(ch)) {
            unpainted.push(`${family.key} U+${point.toString(16).toUpperCase()}`);
          }
          continue;
        }
        blocks.add(blockKey);
        if (blockKey !== HOT_BLOCK) extChars += 1;
      }
      for (const blockKey of blocks) {
        const block = detail.blocks.get(blockKey);
        for (const file of block.files) {
          bytes += file.bytes;
          files += 1;
        }
      }

      // --- the Latin characters the page paints and nobody ships ---------
      const latin = classifyUnpaintedLatin(chars, detail.cpToBlock, coverageOf(family.key));
      for (const point of latin.missing) {
        latinErrors.push(
          `[${family.key}] the ${label} ${path} paints U+${point.toString(16).toUpperCase()} ` +
            'that no subset of the family claims — an unpainted Latin character: the ' +
            'Latin tier does not cover it',
        );
      }
      if (latin.unsupported.length > 0) {
        const list = latin.unsupported
          .map((point) => `U+${point.toString(16).toUpperCase()}`)
          .join(', ');
        console.log(
          `[verify]   info: the ${label} ${path} paints ${latin.unsupported.length} Latin ` +
            `character(s) the source font of ${family.key} cannot draw (${list}) — the ` +
            'browser falls back to the system font for them (reported, not failed)',
        );
      }
    }

    const budget = limits.bytes[path];
    if (bytes > budget) {
      budgetErrors.push(
        `the ${label} page ${path} downloads ${bytes} B of fonts, the budget is ${budget} B`,
      );
    }
    if (files > limits.files) {
      budgetErrors.push(
        `the ${label} page ${path} downloads ${files} font files, the budget is ` +
          `${limits.files}`,
      );
    }
    costs.push({
      path,
      bytes,
      files,
      budget,
      fileBudget: limits.files,
      unpainted: unpainted.length,
      unpaintedChars: unpainted,
    });
  }
  return { budgetErrors, latinErrors, fixtureErrors, costs, extChars };
}

/**
 * The shape of the page sample.
 *
 * A sample that does not hold the four measured pages, or that does not say
 * when and where it was captured, is not a ruler — it is a file. The gate
 * refuses to measure with it.
 *
 * @param {object} sample the parsed sample
 * @returns {string[]} the messages of the failures, empty when the shape is right
 */
export function checkSampleShape(sample) {
  const errors = [];
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return ['the page sample is not an object'];
  }
  if (typeof sample.capturedAt !== 'string' || sample.capturedAt === '') {
    errors.push('the page sample declares no capture date');
  }
  if (typeof sample.source !== 'string' || sample.source === '') {
    errors.push('the page sample declares no source');
  }
  if (!Number.isInteger(sample.rounds) || sample.rounds < 1) {
    errors.push(
      `the page sample declares ${JSON.stringify(sample.rounds)} round(s) — it must be a ` +
        'whole number of rounds',
    );
  }
  if (!sample.pages || typeof sample.pages !== 'object') {
    errors.push('the page sample holds no pages');
    return errors;
  }
  for (const path of Object.keys(LIMITS.unionSampleBytes)) {
    const page = sample.pages[path];
    if (!page || typeof page !== 'object') {
      errors.push(`the page sample has no entry for ${path}`);
      continue;
    }
    for (const family of FAMILIES) {
      if (typeof page[family.key] !== 'string') {
        errors.push(`the page sample holds no ${family.key} characters for ${path}`);
      }
    }
  }
  return errors;
}

/**
 * The four guards that prove the page budget gate is NOT circular.
 *
 * The gate measures a sample of the live pages. If that sample is the seed
 * of the hot tier itself, then the characters it paints are in the hot tier
 * BY CONSTRUCTION, the sample can never reach an Ext block, and the gate
 * can never see what a page really downloads — it reports green whatever
 * the Ext layer costs. These four checks are what makes the gate honest,
 * and each of them must hold:
 *
 *   1. the sample paints MORE characters outside the hot tier than the seed
 *      does (739 against 196 on 2026-10-31) — it reaches where the seed
 *      cannot reach;
 *   2. on at least one page the sample downloads MORE font files than the
 *      seed (175 against 8 on `/`, 255 against 8 on `/stories`) — the Ext
 *      blocks are really downloaded;
 *   3. the sample declares that it is a union (`rounds >= 2`) — a sample of
 *      one round may be the deterministic page, and then it IS the seed;
 *   4. the deterministic pages hold the SAME characters in the sample and in
 *      the seed — otherwise the capture did not see what it claims to see.
 *
 * @param {object} sample the parsed page sample
 * @param {object} seed the parsed seed of the hot tier
 * @param {object} sampleResult the measurement of the sample
 * @param {object} seedResult the measurement of the seed
 * @returns {string[]} the messages of the failures, empty when the gate is honest
 */
export function checkSampleIsDeeper(sample, seed, sampleResult, seedResult) {
  const errors = [];

  // --- guard 3: the sample must declare that it is a union --------------
  if (!Number.isInteger(sample?.rounds) || sample.rounds < 2) {
    errors.push(
      `the page sample declares ${JSON.stringify(sample?.rounds)} round(s) — a sample of ` +
        'one round may be the deterministic page (and then it is the seed, and the page ' +
        'budget gate is circular)',
    );
  }

  // --- guard 1: the sample must reach deeper than the seed --------------
  if (sampleResult.extChars <= seedResult.extChars) {
    errors.push(
      `the page sample paints ${sampleResult.extChars} character(s) outside the hot tier, ` +
        `the seed paints ${seedResult.extChars} — the sample does not reach deeper than ` +
        'the seed, so the page budget gate is circular: it can never see the Ext layer',
    );
  }

  // --- guard 2: at least one page must download MORE files ---------------
  const deeper = sampleResult.costs.filter((cost) => {
    const floor = seedResult.costs.find((entry) => entry.path === cost.path);
    return floor !== undefined && cost.files > floor.files;
  });
  if (deeper.length === 0) {
    errors.push(
      'the page sample downloads no more font files than the seed on any page — the Ext ' +
        'blocks are never downloaded, so the page budget gate is circular',
    );
  }

  // --- guard 4: the deterministic pages must be the same -----------------
  for (const path of DETERMINISTIC_PAGES) {
    const samplePage = sample?.pages?.[path] ?? {};
    const seedPage = seed?.pages?.[path] ?? {};
    for (const family of FAMILIES) {
      const sampleChars = samplePage[family.key];
      const seedChars = seedPage[family.key];
      if (typeof sampleChars !== 'string' || typeof seedChars !== 'string') {
        errors.push(
          `the page sample holds no ${family.key} characters for ${path} — the capture is ` +
            'not what it claims to be',
        );
        continue;
      }
      if (sampleChars !== seedChars) {
        errors.push(
          `the page ${path} is deterministic — its ${family.key} characters must be the same ` +
            'in the sample and in the seed, and they are not: the capture is not what it ' +
            'claims to be, so the page budget gate cannot be trusted',
        );
      }
    }
  }

  return errors;
}

/**
 * Check what a page downloads: the bytes and the number of files.
 *
 * ⚠️ The check runs TWICE, and the two runs are not the same:
 *
 *   1. the SEED (`data/font-page-profiles.json`) — the lower bound. It is
 *      the seed of the hot tier, so the characters it holds are in the hot
 *      tier by construction and it never reaches an Ext block. Its cost is
 *      REPORTED and it never fails the run: it is not a page.
 *   2. the SAMPLE (`data/font-page-sample.json`) — the union of several
 *      rounds of the live pages. Its cost is the GATE: over the budget is
 *      a failure, and a non-zero exit code.
 *
 * @param {Record<string, object>} details the block map of every family
 * @returns {Promise<{ errors: string[], costs: object[], floorCosts: object[],
 *   floorNotes: string[], sample: object, fixtureErrors: string[] }>}
 */
async function checkPageBudget(details) {
  const errors = [];
  const floorNotes = [];
  const fixtureErrors = [];

  // ⚠️ The mode is resolved HERE and not at the top level of the module:
  // a throw at the top level would be a stack trace, while here it is
  // caught by the CLI and reported as "the verification itself failed".
  const pageCostMode = resolvePageCostMode();

  const seed = await readProfile(SEED_PATH, 'page profile fixture');
  if (!seed.ok) {
    return {
      errors: [seed.error],
      costs: [],
      floorCosts: [],
      floorNotes,
      sample: { path: SAMPLE_PATH, rounds: 0, source: '', capturedAt: '' },
      fixtureErrors,
      pageCostMode,
      pageCost: null,
    };
  }
  const sample = await readProfile(SAMPLE_PATH, 'page sample');
  if (!sample.ok) {
    return {
      errors: [sample.error],
      costs: [],
      floorCosts: [],
      floorNotes,
      sample: { path: SAMPLE_PATH, rounds: 0, source: '', capturedAt: '' },
      fixtureErrors,
      pageCostMode,
      pageCost: null,
    };
  }

  errors.push(...checkSampleShape(sample.value));

  // --- the lower bound (the seed) ----------------------------------------
  const seedResult = await measureProfile(
    details,
    seed.value,
    { bytes: LIMITS.pageFontBytes, files: LIMITS.maxFontFilesPerPage },
    'seed',
  );
  // ⚠️ The Latin findings of the seed are errors too: a Latin character
  // that no subset claims is a hole in the LATIN TIER, not a fact about the
  // seed — and the seed paints the whole Latin alphabet.
  errors.push(...seedResult.latinErrors);
  // ⚠️ The FIXTURE findings of the seed are errors too: a seed that holds
  // no Latin character at all makes the page budget check of the Latin tier
  // an empty set, so a Latin tier that was never built would report green.
  // This is the integrity of the fixture, not the cost of a page, so it is
  // NOT demoted to a note the way the budget findings below are.
  errors.push(...seedResult.fixtureErrors);
  fixtureErrors.push(...seedResult.fixtureErrors);
  // ⚠️ The budget findings of the seed are NOT errors: the seed is a lower
  // bound, not a page. They are reported.
  for (const message of seedResult.budgetErrors) {
    floorNotes.push(`the seed is over a budget of its own: ${message}`);
  }

  // --- the gate (the sample) ---------------------------------------------
  const sampleResult = await measureProfile(
    details,
    sample.value,
    { bytes: LIMITS.unionSampleBytes, files: LIMITS.maxUnionSampleFilesPerPage },
    'sample',
  );
  // ⚠️ Only the page cost is demoted in report mode: the Latin findings
  // are holes in the PRODUCT (a character no subset claims) and not a
  // fact about the live pages, so they fail the run in every mode.
  errors.push(...sampleResult.latinErrors);
  if (pageCostMode === 'enforce') {
    errors.push(...sampleResult.budgetErrors);
  }
  // ⚠️ The FIXTURE findings of the sample are errors too — for the same
  // reason as the ones of the seed.
  errors.push(...sampleResult.fixtureErrors);
  fixtureErrors.push(...sampleResult.fixtureErrors);

  // --- the guards: the gate must prove that it is not circular ----------
  errors.push(...checkSampleIsDeeper(sample.value, seed.value, sampleResult, seedResult));

  return {
    errors,
    costs: sampleResult.costs,
    floorCosts: seedResult.costs,
    floorNotes,
    sample: {
      path: SAMPLE_PATH,
      rounds: sample.value.rounds,
      source: sample.value.source ?? '',
      capturedAt: sample.value.capturedAt ?? '',
    },
    fixtureErrors,
    pageCostMode,
    pageCost: pageCostMode === 'report' ? pageCostOf(sampleResult.costs) : null,
  };
}

/**
 * The page cost of the measured tree, in the shape the report prints.
 *
 * The RULER (the characters of the union sample) and the BUDGETS
 * (`budgetBytes`, `budgetFiles`) come from the LIVE release, while
 * `bytes` and `files` are what the tree the verifier READ costs — in the
 * pipeline that tree is the CANDIDATE. The page keys are sorted, so that
 * the line is the same every time it is printed — it is a machine readable
 * line, and Task 6 takes the new numbers from it.
 *
 * @param {object[]} costs the cost of every measured page
 * @returns {{ bytes: Record<string, number>, files: Record<string, number>,
 *   budgetBytes: Record<string, number>, budgetFiles: number }} the report
 */
function pageCostOf(costs) {
  const bytes = {};
  const files = {};
  const budgetBytes = {};
  const paths = [...new Set(costs.map((cost) => cost.path))].sort();
  for (const path of paths) {
    const cost = costs.find((entry) => entry.path === path);
    if (!cost) continue;
    bytes[path] = cost.bytes;
    files[path] = cost.files;
    budgetBytes[path] = cost.budget;
  }
  return {
    bytes,
    files,
    budgetBytes,
    budgetFiles: LIMITS.maxUnionSampleFilesPerPage,
  };
}


/**
 * Check every family and then the things that span the families.
 *
 * @returns {Promise<{ ok: boolean, errors: string[], stats: object[],
 *   costs: object[], floorCosts: object[], floorNotes: string[], sample: object,
 *   fixtureErrors: string[], extras: object }>}
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
    if (report.detail) {
      cssByFile[family.cssHot] = report.detail.css;
      cssByFile[family.cssExt] = report.detail.extCss;
    }
  }

  // --- check 5: the six stylesheets together -----------------------------
  const cssGzipTotal = stats.reduce((sum, entry) => sum + entry.cssGzipBytes, 0);
  if (cssGzipTotal > LIMITS.cssBytes) {
    errors.push(
      `the three stylesheets are ${cssGzipTotal} B gzipped together, the budget is ` +
        `${LIMITS.cssBytes} B`,
    );
  }

  // --- check 7: the manifest ---------------------------------------------
  errors.push(...(await checkManifest(cssByFile)));

  // --- check 14: the Latin hot tier holds the 24 tone vowels ------------
  // The tone vowels come from `lib/pinyin-tone.ts` and NOT from the page
  // fixture, so this assertion is not idle: it proves that the Latin tier
  // was built out of the tone table.
  let toneVowels = [];
  try {
    toneVowels = loadToneVowels();
  } catch (error) {
    errors.push(`the tone table cannot be read: ${error.message}`);
  }
  if (toneVowels.length > 0) {
    for (const family of FAMILIES) {
      const detail = details[family.key];
      if (!detail) continue;
      errors.push(
        ...checkLatinToneVowels(family, detail.blocks.get('latin'), toneVowels),
      );
    }
  }

  // --- check 8: the page budget ------------------------------------------
  const pages = await checkPageBudget(details);
  errors.push(...pages.errors);

  return {
    ok: errors.length === 0,
    errors,
    stats,
    costs: pages.costs,
    floorCosts: pages.floorCosts,
    floorNotes: pages.floorNotes,
    sample: pages.sample,
    fixtureErrors: pages.fixtureErrors,
    extras,
    pageCostMode: pages.pageCostMode,
    pageCost: pages.pageCost,
  };
}

/**
 * The path of a file, as the reader of the log wants to see it.
 *
 * A file of the repository is named by its repository relative path — the
 * path a command of the repository can use. A file outside of it (the
 * override of the sample) is named by its absolute path, because there is
 * no shorter name for it.
 *
 * @param {string} path the absolute path of the file
 * @returns {string} the path to print
 */
function displayPath(path) {
  const rel = relative(ROOT, path);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.split(/[\\/]/).join('/');
  }
  return path;
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
    console.log(
      `[verify]   latin: ${entry.latinChars} char(s) in ${entry.latinBlocks} block(s)`,
    );
    if (entry.extraCodepoints > 0) {
      console.log(
        `[verify]   info: ${entry.extraCodepoints} code point(s) the files carry ` +
          'beyond the ranges they declare (reported, not failed)',
      );
      console.log(
        '[verify]   info: they come from the subsetting tool itself (the neighbours of a ' +
          'glyph the font draws and the extra entries of its cmap are carried along when ' +
          'the block is cut) — they are NOT a "declared but unrenderable" mismatch; that ' +
          'mismatch is the tofu gate, the third check of this run, and it fails there',
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

  // --- the sample: the ruler of the page budget --------------------------
  const rounds = Number.isInteger(result.sample.rounds)
    ? `${result.sample.rounds} rounds`
    : `${JSON.stringify(result.sample.rounds) ?? 'no'} rounds`;
  console.log(
    `[verify] sample : ${displayPath(result.sample.path)} (${rounds}, ` +
      `${result.sample.source}, ${result.sample.capturedAt})`,
  );

  // --- the floor: the seed of the hot tier, reported and never a gate ----
  console.log(
    '[verify] floor  : ' +
      result.floorCosts
        .map(
          (cost) =>
            `${cost.path} ${Math.round(cost.bytes / 1024)} KB / ${cost.files} files`,
        )
        .join('   ') +
      '   (' + displayPath(SEED_PATH) + ' — a LOWER BOUND, not a page)',
  );

  // --- the pages: the sample of the live pages, and the gate -------------
  // ⚠️ In report mode the page cost is NOT judged, so the line must not
  // say OK either: "OK" would be a claim, and nothing was claimed.
  const pageMark =
    result.pageCostMode === 'report'
      ? 'REPORT'
      : result.costs.some(
          (cost) => cost.bytes > cost.budget || cost.files > cost.fileBudget,
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
  // ⚠️ KB means KiB in this output (bytes / 1024), while a human reads KB as
  // a decimal number — so the exact bytes are on the line below, and so are
  // the budgets they are compared against.
  console.log(
    '[verify] bytes  : ' +
      result.costs.map((cost) => `${cost.path} ${cost.bytes} B`).join('   ') +
      '   (KB means KiB — bytes / 1024; the budgets are ' +
      result.costs.map((cost) => `${cost.budget} B`).join(' / ') +
      ')',
  );
  // --- the union budget: the headroom that is left, and what it means ----
  // The union budget is a DRIFT DETECTOR and not a page weight budget: the
  // slack it has is deliberately almost nothing, so a change of the corpus
  // turns it red. The fix is a HUMAN re-baselining of the two limits by
  // hand — the backend never changes a budget.
  //
  // ⚠️ The headroom of the tightest page is printed, not asserted: an
  // assertion "the measured files must be strictly fewer than the cap" is
  // red today (`/stories` downloads 255 files against a cap of 255), and a
  // two-way assertion "the budget equals the value derived from the sample"
  // would make a SMALLER corpus red as well — a failure mode that does not
  // exist today.
  if (result.costs.length > 0) {
    const tightest = result.costs.reduce((winner, cost) => {
      const candidate = {
        path: cost.path,
        byteHeadroom: cost.budget - cost.bytes,
        fileHeadroom: cost.fileBudget - cost.files,
      };
      if (!winner) return candidate;
      if (candidate.byteHeadroom < winner.byteHeadroom) return candidate;
      if (
        candidate.byteHeadroom === winner.byteHeadroom &&
        candidate.fileHeadroom < winner.fileHeadroom
      ) {
        return candidate;
      }
      return winner;
    }, null);
    console.log(
      `[verify] union  : ${tightest.path} ${tightest.byteHeadroom} B / ` +
        `${tightest.fileHeadroom} files of headroom left (the tightest page of the ` +
        'union budget — that one is a DRIFT DETECTOR and not a page weight budget: ' +
        'the zero headroom is DELIBERATE, a change of the corpus turns it red, and ' +
        'the fix is a HUMAN re-baselining of LIMITS.unionSampleBytes / ' +
        'LIMITS.maxUnionSampleFilesPerPage by hand — the backend never changes a ' +
        'budget)',
    );
  }
  // ⚠️ The four numbers above are the UNION of the rounds of the live pages,
  // not the cost of ONE visit. `/` and `/stories` render a RANDOM character
  // story on every request, so one visit is cheaper than the union, and the
  // seed above is the lower bound of the same page. The live cost of one
  // visit is measured by the probe of the budget, and that probe exits
  // non-zero when a page is over its budget.
  console.log(
    `[verify] note   : the four page numbers above are the UNION of ` +
      `${rounds} of the live pages — it is the upper bound of what one ` +
      'visit downloads',
  );
  console.log(
    '[verify] note   : / and /stories render a RANDOM character story, so a single visit is ' +
      'cheaper than the union; the seed above is the lower bound of the same page',
  );
  console.log(
    '[verify] note   : measure the live cost of one visit with: npm run perf:fonts -- --base ' +
      '<live base> (that probe exits non-zero when a page is over its budget)',
  );
  // --- the page cost, reported and not enforced --------------------------
  // ⚠️ The lines below exist ONLY in report mode: the enforce output has
  // to stay byte for byte the same, and it already says what it thinks
  // of the page cost — as an error.
  if (result.pageCostMode === 'report') {
    console.log(
      '[verify] note   : PAGE COST IS REPORTED, NOT ENFORCED — these numbers describe ' +
        'the LIVE tree, not the candidate',
    );
    // The machine readable line: it is the only source of the new numbers
    // for the person who re-baselines the budgets by hand, so its shape
    // is pinned.
    //
    // ⚠️ The line is printed ONLY when there is a page cost to print.
    // `pageCost` is null when a fixture could not be read, and
    // "pagecost: null" is NOT valid JSON — a parser that reads this line
    // would choke on it. The line is therefore either one line of valid
    // JSON or it is absent: the run fails anyway in that case, and the
    // failure is reported on its own line.
    if (result.pageCost !== null) {
      console.log(`[verify] pagecost: ${JSON.stringify(result.pageCost)}`);
    }
    for (const cost of result.costs) {
      const overBytes = cost.bytes > cost.budget;
      const overFiles = cost.files > cost.fileBudget;
      if (!overBytes && !overFiles) continue;
      // ⚠️ The sentence is built HERE and not printed from the findings
      // of the enforce mode: that text is the ERROR text of the gate, and
      // the report mode must not carry it — the report mode says what is
      // over the budget, the enforce mode says what is wrong.
      const comparison = overBytes
        ? `(${cost.bytes} B > ${cost.budget} B${
            overFiles ? `, ${cost.files} files > ${cost.fileBudget} files` : ''
          })`
        : `(${cost.files} files > ${cost.fileBudget} files)`;
      const subject = overBytes ? 'its page budget' : 'its file budget';
      console.log(
        `[verify]   info: the sample page ${cost.path} is over ${subject} ${comparison}`,
      );
    }
  }
  for (const note of result.floorNotes) {
    console.log(`[verify]   info: ${note}`);
  }
  for (const [label, costs] of [
    ['seed', result.floorCosts],
    ['sample', result.costs],
  ]) {
    for (const cost of costs) {
      if (cost.unpainted > 0) {
        console.log(
          `[verify]   info: the ${label} page ${cost.path} paints ${cost.unpainted} ` +
            `character(s) that no subset claims (the font stack falls back for them): ` +
            cost.unpaintedChars.join(', '),
        );
      }
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
