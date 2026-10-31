/**
 * scripts/perf/font-load.mjs — what a page downloads of fonts.
 *
 * The probe answers one question per page: how many bytes of webfont does
 * this page ask the browser for, and does that stay inside the budget of
 * the design (330 KB per page, 240 KB for `/poetry`, at most 12 files)?
 *
 * The chain has four steps and every one of them is measured, never guessed:
 *
 *   1. the HTML of the page is read through `fetch-page.mjs`, which checks
 *      the response before anything is measured — a page that is not a page
 *      (the five byte redirect of the initialization gate) is an error, not a
 *      page of four characters;
 *   2. the characters of the page are attributed to the three typefaces by
 *      `class-attribution.mjs` — the SAME module the fixture
 *      `data/font-page-profiles.json` was captured with, and with BOTH of its
 *      collectors: the CJK ones AND the Latin ones. The fixture holds the
 *      Chinese part first and the Latin part after it, so the fixture and
 *      this budget talk about the same characters;
 *   3. the files those characters live in are derived from the PUBLISHED
 *      stylesheets of this repository (`public/font/fonts-*.css`), face by
 *      face: a face declares a `unicode-range` and points at a file, so a
 *      character selects the face that claims it;
 *   4. the bytes are the bytes of the woff2 files ON THE DISK — the same
 *      measure the verifier of the subsets uses (`content.length`), so the
 *      two numbers can be compared directly.
 *
 * ⚠️ **The version skew, and why the numbers below may not match the live
 * site.** The stylesheets that are read here are the ones THIS REPOSITORY
 * ships. The live site may serve a DIFFERENT build of the same stylesheets
 * — the css2 build of the Google Fonts CDN, whose faces point at files like
 * `/font/noto-sans-sc/<hash>.woff2`, whose `?v=` token is not the token of
 * this repository and whose blocks are cut differently. The probe ALWAYS
 * says which build it is talking about, in one of three ways: the live
 * `?v=` token is the token of this repository (the live site runs this
 * build), the live `?v=` token is another token (a VERSION SKEW — a
 * difference between these numbers and the live site is then not a
 * performance regression), or the token cannot be read at all (the shape of
 * the link is not the shape this probe knows — the live version is
 * UNKNOWN). **Silence is never an answer here**: a reader of the numbers
 * alone must never be able to mistake the repository build for the live
 * build.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, parseFaces, parseFaceUrl } from '../fonts/verify-webfont-subsets.mjs';

import { collectFamilyCharsets, collectFamilyLatinCharsets } from './class-attribution.mjs';
import { fetchPage, parseCommonArgs, MEASURED_PAGES } from './fetch-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const FONT_DIR = join(ROOT, 'public', 'font');
const WEB_DIR = join(FONT_DIR, 'web');
const MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json');

/** The three published stylesheets, one per family. */
const PUBLISHED = [
  { key: 'sans', css: 'fonts-sans.css' },
  { key: 'serif', css: 'fonts-serif.css' },
  { key: 'wenkai', css: 'fonts-wenkai.css' },
];

/**
 * The ranges of a `unicode-range` declaration.
 *
 * The verifier of the subsets has such a function, but it does not export
 * it (and it is not to be touched — it is the product of another task), so
 * this is the local copy. An entry that cannot be read is an ERROR: a range
 * that is skipped silently would leave a character without a file, and the
 * budget would be a lie.
 *
 * @param {string} text the value of the declaration
 * @returns {{ start: number, end: number }[]} the ranges it declares
 */
export function parseUnicodeRanges(text) {
  const ranges = [];
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
    ranges.push({ start, end });
  }
  return ranges;
}

/**
 * The published stylesheets, read from the disk and expanded into the map
 * of "code point → the files that draw it".
 *
 * ⚠️ The stylesheets are read from THIS repository, never from
 * `fonts-manifest.json` (that file holds a version and three paths, no byte
 * count and no file list) and never from the unfiltered plan of Task 1 (the
 * build filters and renumbers the Ext blocks, so the unfiltered indices are
 * misaligned past the first block that was filtered out).
 *
 * @returns {Promise<Record<string, { key: string, css: string, faces: number,
 *   byCodePoint: Map<number, Set<string>> }>>}
 */
export async function readPublishedStylesheets() {
  const published = {};
  for (const entry of PUBLISHED) {
    const raw = await readFile(join(FONT_DIR, entry.css), 'utf8');
    // The repository has `core.autocrlf = true`, so the stylesheets are
    // checked out with CRLF on Windows. Only the line endings are touched.
    const css = raw.replace(/\r\n/g, '\n');
    const faces = parseFaces(css);
    const byCodePoint = new Map();

    for (const face of faces) {
      const url = parseFaceUrl(face.src);
      if (!url) {
        throw new Error(
          `the stylesheet ${entry.css} points at ${JSON.stringify(face.src)}, which is not a ` +
            'font URL of this repository (/font/web/<dir>/<file>)',
        );
      }
      const key = `${url.dir}/${url.file}`;
      for (const range of parseUnicodeRanges(face.range)) {
        for (let point = range.start; point <= range.end; point += 1) {
          const files = byCodePoint.get(point);
          if (files) files.add(key);
          else byCodePoint.set(point, new Set([key]));
        }
      }
    }
    published[entry.key] = { key: entry.key, css: entry.css, faces: faces.length, byCodePoint };
  }
  return published;
}

/**
 * The font files a page needs, per family.
 *
 * @param {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }} charsets
 *   the characters the page paints, per family
 * @param {Record<string, object>} published the published stylesheets
 * @returns {{ perFamily: Record<string, Set<string>>, unpainted: string[] }}
 */
export function pageFontFiles(charsets, published) {
  const perFamily = {};
  const unpainted = [];

  for (const entry of PUBLISHED) {
    const files = new Set();
    const family = published[entry.key];
    for (const char of charsets[entry.key]) {
      const point = char.codePointAt(0);
      const keys = family.byCodePoint.get(point);
      if (!keys) {
        unpainted.push(`${entry.key} U+${point.toString(16).toUpperCase()}`);
        continue;
      }
      for (const key of keys) files.add(key);
    }
    perFamily[entry.key] = files;
  }
  return { perFamily, unpainted };
}

/**
 * The characters a page paints, per family: the CJK ones AND the Latin ones.
 *
 * ⚠️ The Latin characters count. The Latin tier is a whole layer of the
 * payload (a page paints its Latin letters, its digits and its accented
 * vowels, so the browser downloads the Latin subsets), and the fixture
 * `data/font-page-profiles.json` holds them too — the Chinese part first,
 * the Latin part after it. A probe that only looked at the Chinese half
 * would report LESS than the browser really downloads, and the two gates
 * (the probe here and the verifier of the subsets) would be measuring two
 * different things.
 *
 * ⚠️ The attribution rule is NOT written a second time: both halves come
 * from `class-attribution.mjs`, which has ONE implementation
 * (`collectFamilySets`) behind its two exports. A second copy of the rule
 * would drift from the first, and then the fixture and the budget would
 * talk about different characters again.
 *
 * @param {string} html the HTML of the page
 * @returns {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }}
 */
export function collectPageCharsets(html) {
  const cjk = collectFamilyCharsets(html);
  const latin = collectFamilyLatinCharsets(html);
  const merged = { sans: new Set(), serif: new Set(), wenkai: new Set() };
  for (const family of Object.keys(merged)) {
    for (const char of cjk[family]) merged[family].add(char);
    for (const char of latin[family]) merged[family].add(char);
  }
  return merged;
}

/**
 * The version token of the font stylesheets the LIVE page links to.
 *
 * @param {string} html the HTML of the page
 * @returns {string} the token, or an empty string when the page links none
 */
function liveStylesheetToken(html) {
  const match = /href="\/font\/fonts-[a-z]+\.css\?v=([0-9a-f]{12})"/.exec(html);
  return match ? match[1] : '';
}

/**
 * Say out loud which font build the live site runs.
 *
 * ⚠️ The probe ALWAYS says something. Three states, three messages:
 *
 *   1. the live `?v=` token is the token of this repository — the live site
 *      runs this build;
 *   2. the live `?v=` token is another token — a VERSION SKEW;
 *   3. the token cannot be read at all (the shape of the link is not the
 *      shape this probe knows) — the live version is UNKNOWN.
 *
 * A silent third state is the bug this exists to prevent: the reader of the
 * numbers would take the repository build for the live build, and the whole
 * point of the warning is that a difference against the live site is then a
 * version skew, not a performance regression.
 *
 * @param {string} live the token of the live stylesheet, empty when unknown
 * @param {string} repositoryVersion the token of this repository
 */
function reportLiveVersion(live, repositoryVersion) {
  if (live === '') {
    console.log(
      '[perf:fonts] the version of the LIVE font build is UNKNOWN: the font stylesheet link ' +
        'of the page does not have the expected shape (href="/font/fonts-<family>.css?v=<token>"), ' +
        'so the probe cannot tell whether the live site runs this build',
    );
    console.log(
      '[perf:fonts]   the payload below is the payload of the REPOSITORY build — with the live ' +
        'version unknown, no conclusion about the live site can be drawn from these numbers',
    );
    return;
  }
  if (live === repositoryVersion) {
    console.log(
      `[perf:fonts] the LIVE site runs the same font build as this repository (v=${live}) — ` +
        'the payload below is the payload of the live site',
    );
    return;
  }
  console.log(
    `[perf:fonts] WARNING: the LIVE site runs a DIFFERENT font build (v=${live}), ` +
      `this repository ships v=${repositoryVersion}`,
  );
  console.log(
    '[perf:fonts]   the live site therefore runs a DIFFERENT font build (the css2 build of the ' +
      'Google Fonts CDN cuts the fonts differently and carries another ?v= token)',
  );
  console.log(
    '[perf:fonts]   the payload below is the payload of the REPOSITORY build — a difference against ' +
      'the live site is a VERSION SKEW, not a performance regression',
  );
}

/** A number of kilobytes, with one decimal. */
function kilobytes(bytes) {
  return (bytes / 1024).toFixed(1);
}

/**
 * The probe.
 */
async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  if (options.rest.length > 0) {
    throw new Error(
      `unknown argument ${JSON.stringify(options.rest[0])} — this probe reads --base and --cookie`,
    );
  }

  const published = await readPublishedStylesheets();
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  console.log(`[perf:fonts] the base is ${options.base}`);
  console.log(
    `[perf:fonts] this repository ships the font stylesheets as v=${manifest.version} ` +
      `(${PUBLISHED.map((entry) => `${entry.css}: ${published[entry.key].faces} faces`).join(', ')})`,
  );

  const sizes = new Map();
  const rows = [];
  const failures = [];
  let versionReported = false;

  for (const path of MEASURED_PAGES) {
    const url = `${options.base}${path}`;
    // The page is read through the shared fetch, which checks it. A page
    // that is not a page throws here, and NOTHING below is printed.
    const page = await fetchPage(url, { cookie: options.cookie });

    // ⚠️ The probe ALWAYS says which build it is talking about — the same
    // build, a skewed build, or an unknown one. Silence is the bug this
    // replaces: a reader of the numbers must never take the repository
    // build for the live build.
    if (!versionReported) {
      versionReported = true;
      reportLiveVersion(liveStylesheetToken(page.body), manifest.version);
    }

    const { perFamily, unpainted } = pageFontFiles(collectPageCharsets(page.body), published);
    const bytes = { sans: 0, serif: 0, wenkai: 0 };
    const files = new Set();

    for (const entry of PUBLISHED) {
      for (const key of perFamily[entry.key].keys()) {
        if (!sizes.has(key)) {
          const content = await readFile(join(WEB_DIR, key));
          sizes.set(key, content.length);
        }
        bytes[entry.key] += sizes.get(key);
        files.add(key);
      }
    }

    const total = bytes.sans + bytes.serif + bytes.wenkai;
    // ⚠️ A page without a byte budget is an ERROR, never a free pass:
    // `total > undefined` is false, so the byte budget would vanish
    // silently while the file count would still be checked — the probe
    // would report "OK" for a page it never measured against a budget.
    const budget = LIMITS.pageFontBytes[path];
    if (budget === undefined) {
      throw new Error(
        `the page ${path} has no byte budget in LIMITS.pageFontBytes — a measured page must ` +
          'have one, otherwise its bytes are never compared against a budget',
      );
    }
    const over = total > budget || files.size > LIMITS.maxFontFilesPerPage;
    if (over) failures.push(path);
    rows.push({ path, bytes, total, files: files.size, budget, over });

    console.log(
      `[perf:fonts] ${path.padEnd(12)} sans ${kilobytes(bytes.sans).padStart(7)} KB` +
        `   serif ${kilobytes(bytes.serif).padStart(7)} KB` +
        `   kai ${kilobytes(bytes.wenkai).padStart(7)} KB` +
        `   total ${kilobytes(total).padStart(7)} KB` +
        `   files ${String(files.size).padStart(3)}` +
        `   budget ${kilobytes(budget).padStart(7)} KB   ${over ? 'OVER' : 'OK'}`,
    );
    console.log(`[perf:fonts]   the files are ${[...files].sort().join(', ') || '(none)'}`);
    if (unpainted.length > 0) {
      console.log(
        `[perf:fonts]   info: the page paints ${unpainted.length} character(s) that no subset claims ` +
          `(the font stack falls back for them): ${unpainted.join(', ')}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `[perf:fonts] ${failures.length} page(s) are over the budget: ${failures.join(', ')} ` +
        `(the budget is ${LIMITS.maxFontFilesPerPage} font files and ` +
        `${PUBLISHED.map((entry) => entry.key).join('/')} as above)`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[perf:fonts] ${rows.length} page(s) measured, every one inside the budget ` +
      `(at most ${LIMITS.maxFontFilesPerPage} font files)`,
  );
}

// Only run the probe when this file is the entry point: `full-load.mjs`
// imports the helper of the unicode range from here.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[perf:fonts] the probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
