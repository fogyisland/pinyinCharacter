/**
 * Regression tests for the per-family webfont stylesheets.
 *
 * public/font/fonts-{sans,serif,wenkai}-{hot,ext}.css are the generated
 * stylesheets of the frequency-tiered webfont model. Every family has TWO:
 * the hot tier (the characters the pages actually paint) and the ext tier
 * (one face per six characters, the rest of the corpus).
 *
 * Only the sans hot tier is on the critical path — the body typeface draws
 * every character of every page. Everything else, the sans ext tier and
 * both tiers of the other two families, is fetched with media="print" and
 * promoted once it arrives.
 *
 * A stylesheet declares one @font-face per subset file. Every face of a
 * family carries the SAME font-family name and a precise unicode-range; the
 * ranges of a family are mutually disjoint, so the browser downloads exactly
 * one file per character and falls back to the system font for a character
 * that is in no range.
 *
 * These tests pin the model down — the shape of the stylesheets, the files
 * they reference, the size budgets, the manifest version and the version
 * tokens. They are the guard against a careless edit that drops a glyph,
 * grows the render-blocking payload or breaks the cache.
 *
 * The numbers below are MEASUREMENTS, not estimates: they were taken from the
 * shipped build (Task 3, filter round F31-a plus the R18 tokens; Task 10
 * added the local Latin tier). A rebuild that changes them has to change the
 * constants here on purpose — the budgets are not to be relaxed to make a
 * build pass.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LIMITS as VERIFIER_LIMITS } from '../../../scripts/fonts/verify-webfont-subsets.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const FONT_DIR = resolve(ROOT, 'public', 'font');

/**
 * The budget of the render-blocking stylesheet, raw.
 *
 * This one budget lives only in this file. The two gzipped budgets come
 * straight from the verifier's exported LIMITS (imported above), so they
 * cannot drift apart from it; the verifier has no raw-bytes budget of its
 * own — it budgets the gzipped bytes of the stylesheets. A KB is 1024 bytes
 * here.
 */
const SANS_RAW_BYTES = 700 * 1024;

/** The three families of the site, and everything pinned about them. */
interface Family {
  /** The key of the family in the manifest and on disk. */
  key: string;
  /** The font-family name every face of the family declares. */
  label: string;
  /** The hot tier of the family — the blocking stylesheet. */
  hotFile: string;
  /** The ext tier of the family — the non-blocking stylesheet. */
  extFile: string;
  /** The directory the subset files of the family live in, under /public/font. */
  subsetDir: string;
  /** The faces of the two stylesheets together: the hot zone plus the Ext blocks. */
  faces: number;
  /** The raw size of the hot stylesheet, in bytes. */
  hotRawBytes: number;
  /** The raw size of the ext stylesheet, in bytes. */
  extRawBytes: number;
  /** The gzipped size of the two stylesheets together, in bytes. */
  gzipBytes: number;
}

const FAMILIES: Family[] = [
  {
    key: 'sans',
    label: 'Noto Sans SC',
    hotFile: 'fonts-sans-hot.css',
    extFile: 'fonts-sans-ext.css',
    subsetDir: 'web/sans',
    faces: 2468,
    hotRawBytes: 3148,
    extRawBytes: 619846,
    gzipBytes: 56049,
  },
  {
    key: 'serif',
    label: 'Noto Serif SC',
    hotFile: 'fonts-serif-hot.css',
    extFile: 'fonts-serif-ext.css',
    subsetDir: 'web/serif',
    faces: 2863,
    hotRawBytes: 2946,
    extRawBytes: 725983,
    gzipBytes: 64908,
  },
  {
    key: 'wenkai',
    label: 'LXGW WenKai TC',
    hotFile: 'fonts-wenkai-hot.css',
    extFile: 'fonts-wenkai-ext.css',
    subsetDir: 'web/wenkai',
    faces: 2662,
    hotRawBytes: 5978,
    extRawBytes: 670596,
    gzipBytes: 39498,
  },
];

/** The shape of one @font-face rule. */
interface Face {
  fontFamily: string;
  fontStyle: string;
  fontWeight: string;
  fontDisplay: string;
  /** The URL of the subset file, query string included. */
  url: string;
  /** The path of the subset file, without the query string. */
  path: string;
  /** The version token of the URL, without the leading `v=`. */
  token: string;
  unicodeRange: string;
}

/** The manifest the layout reads the stylesheet URLs from. */
interface FontManifest {
  version: string;
  files: Record<string, string>;
}

/**
 * Read a stylesheet with its line endings normalized to LF.
 *
 * The repository sets core.autocrlf=true, so a fresh checkout on Windows
 * rewrites the stylesheets to CRLF. The manifest hash and the size budgets
 * are properties of the CONTENT, not of the checkout, so the line endings
 * are normalized before anything is measured — the same way
 * scripts/fonts/verify-webfont-subsets.mjs does it.
 */
function readStylesheet(file: string): string {
  return readFileSync(resolve(FONT_DIR, file), 'utf8').replace(/\r\n/g, '\n');
}

/** The manifest of the font stylesheets. */
function readManifest(): FontManifest {
  const raw = readFileSync(resolve(FONT_DIR, 'fonts-manifest.json'), 'utf8');
  return JSON.parse(raw) as FontManifest;
}

/** Read a declaration out of a CSS block: `font-weight: 400 700;`. */
function cssField(body: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  return match ? match[1].trim() : '';
}

/** Drop the quotes of a CSS string value. */
function unquote(value: string): string {
  return value.replace(/^['"]/, '').replace(/['"]$/, '');
}

/** Parse the @font-face rules of a stylesheet — see RELEASE_SEGMENT_NOTE. */
function parseFaces(css: string): Face[] {
  const faces: Face[] = [];
  const block = /@font-face\s*\{([^}]*)\}/g;
  let match = block.exec(css);
  while (match !== null) {
    const body = match[1];
    const src = /src:\s*url\(([^)]*)\)/.exec(body);
    const url = src ? src[1].trim() : '';
    const queryAt = url.indexOf('?');
    const query = queryAt === -1 ? '' : url.slice(queryAt + 1);
    const token = /^v=([0-9a-f]{12})$/.exec(query);
    faces.push({
      fontFamily: unquote(cssField(body, 'font-family')),
      fontStyle: unquote(cssField(body, 'font-style')),
      fontWeight: cssField(body, 'font-weight'),
      fontDisplay: cssField(body, 'font-display'),
      url,
      path: queryAt === -1 ? url : url.slice(0, queryAt),
      token: token ? token[1] : '', release: /^\/font\/web\/(r[0-9a-f]+)\//.exec(url)?.[1] ?? '',
      unicodeRange: cssField(body, 'unicode-range'),
    });
    match = block.exec(css);
  }
  return faces;
}

/**
 * The parsed stylesheets of a family, read once per run.
 *
 * `css` is the two tiers CONCATENATED — that is the model the old
 * single-stylesheet layout had, and most of the assertions below are
 * about the family as a whole. The hot and ext tiers are also kept apart
 * so the size budgets can be measured per tier.
 */
interface ParsedFamily {
  /** The two tiers concatenated. */
  css: string;
  /** The faces of both tiers. */
  faces: Face[];
  /** The hot tier alone. */
  hotCss: string;
  /** The ext tier alone. */
  extCss: string;
}

const stylesheetCache = new Map<string, ParsedFamily>();

function stylesheet(family: Family): ParsedFamily {
  const cached = stylesheetCache.get(family.hotFile);
  if (cached) return cached;
  const hotCss = readStylesheet(family.hotFile);
  const extCss = readStylesheet(family.extFile);
  const parsed = {
    css: hotCss + extCss,
    faces: parseFaces(hotCss).concat(parseFaces(extCss)),
    hotCss,
    extCss,
  };
  stylesheetCache.set(family.hotFile, parsed);
  return parsed;
}

/** The subset files of a family, as they sit on disk. */
function subsetFiles(family: Family): string[] {
  return readdirSync(resolve(FONT_DIR, subsetDirOf(family))).filter((name) =>
    name.endsWith('.woff2'),
  );
}

/**
 * Every subset file of the site, with its size in bytes.
 *
 * The walk is recursive over public/font/web, so it counts the subsets of
 * a family that is not in FAMILIES too — the payload budget is a property
 * of the whole font directory, not of the three families the pages use.
 */
function allSubsetFiles(): { path: string; bytes: number }[] {
  const dir = resolve(FONT_DIR, 'web');
  return readdirSync(dir, { encoding: 'utf8', recursive: true })
    .filter((name) => name.endsWith('.woff2'))
    .map((name) => {
      const path = resolve(dir, name);
      return { path, bytes: statSync(path).size };
    });
}

describe('public/font per-family stylesheets', () => {
  it('ships two stylesheets per family', () => {
    for (const family of FAMILIES) {
      expect(existsSync(resolve(FONT_DIR, family.hotFile))).toBe(true);
      expect(existsSync(resolve(FONT_DIR, family.extFile))).toBe(true);
    }
  });

  it('ships no stylesheet from the one-stylesheet layout', () => {
    // The old layout had one file per family. They are gone, and they have
    // to stay gone: `/font/:path*` is cached for 30 days, so a leftover
    // `fonts-sans.css` could still be served to a browser that has the old
    // URL cached — and it would declare faces whose subset files no
    // longer exist.
    for (const family of FAMILIES) {
      expect(existsSync(resolve(FONT_DIR, `fonts-${family.key}.css`))).toBe(false);
    }
  });

  it('declares one face per subset file', () => {
    for (const family of FAMILIES) {
      const { faces } = stylesheet(family);
      // The hot zone plus the Ext blocks. The static family (wenkai) cuts
      // every block into two files, so it declares two faces per block.
      expect(faces.length).toBe(family.faces);
      // No two faces point at the same file.
      expect(new Set(faces.map((face) => face.path)).size).toBe(faces.length);
      // And every file that ships is declared by a face — no orphan subset.
      expect(subsetFiles(family).length).toBe(family.faces);
    }
  });

  it('names only the three families of the site', () => {
    const allowed = new Set(FAMILIES.map((family) => family.label));
    const offenders = new Set<string>();
    for (const family of FAMILIES) {
      for (const face of stylesheet(family).faces) {
        if (!allowed.has(face.fontFamily)) offenders.add(face.fontFamily);
      }
    }
    expect([...offenders]).toEqual([]);
  });

  it('references only font files that exist on disk', () => {
    const missing: string[] = [];
    for (const family of FAMILIES) {
      for (const face of stylesheet(family).faces) {
        const file = resolve(ROOT, 'public', face.path.replace(/^\//, ''));
        if (!existsSync(file)) missing.push(face.path);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps every face non-blocking', () => {
    const offenders: string[] = [];
    for (const family of FAMILIES) {
      for (const face of stylesheet(family).faces) {
        if (face.fontDisplay !== 'swap') offenders.push(face.url);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every face a non-empty unicode-range', () => {
    const offenders: string[] = [];
    for (const family of FAMILIES) {
      for (const face of stylesheet(family).faces) {
        if (face.unicodeRange.length === 0) offenders.push(face.url);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares the weight of the family, not of the subset', () => {
    // The variable families (sans, serif) ship one file per block and
    // declare one face with a weight RANGE — the browser interpolates the
    // bold out of the same file. The static family (wenkai) cuts every
    // block into a file per weight and declares one face per file, so
    // every one of its faces carries a single weight.
    //
    // A face that lost its range would degrade every bold character of the
    // site to a synthetic bold, and the byte budgets would not notice.
    for (const family of FAMILIES) {
      const expected = family.key === 'wenkai' ? /^(400|700)$/ : /^400 700$/;
      for (const face of stylesheet(family).faces) {
        expect(face.fontWeight).toMatch(expected);
        expect(face.fontStyle).toBe('normal');
      }
    }
  });

  it('keeps the render-blocking stylesheet small', () => {
    let hotBytes = 0;
    let totalBytes = 0;
    for (const family of FAMILIES) {
      const { hotCss, extCss } = stylesheet(family);
      const hotRawBytes = Buffer.byteLength(hotCss, 'utf8');
      const extRawBytes = Buffer.byteLength(extCss, 'utf8');
      expect(hotRawBytes).toBe(family.hotRawBytes);
      expect(extRawBytes).toBe(family.extRawBytes);
      hotBytes += hotRawBytes;
      totalBytes += hotRawBytes + extRawBytes;
    }
    // ⚠️ THIS IS THE POINT OF THE SPLIT. The three hot tiers together, raw:
    // the CSS the browser has to parse before it can paint a single
    // character. It was 2023175 bytes when every family had one
    // stylesheet; it is 12100 now.
    expect(hotBytes).toBe(12072);
    // The whole corpus, hot and ext together, barely moved — the split
    // moved the bytes off the critical path, it did not delete them.
    expect(totalBytes).toBe(2028497);
    // The sans hot tier is the ONLY stylesheet on the critical path; the
    // sans ext tier and both tiers of the other two families are fetched
    // without blocking the first paint.
    const sans = FAMILIES.find((family) => family.key === 'sans');
    if (!sans) throw new Error('the sans family is missing from FAMILIES');
    expect(Buffer.byteLength(stylesheet(sans).hotCss, 'utf8')).toBeLessThanOrEqual(
      SANS_RAW_BYTES,
    );
    // Every font byte the site can possibly ask for. The browser downloads
    // only the handful the page draws, but the whole set has to be
    // deployed, cached and kept in the bundle budget.
    const subsets = allSubsetFiles();
    expect(subsets.length).toBe(7993);
    expect(subsets.reduce((total, file) => total + file.bytes, 0)).toBe(28292884);
  });

  it('keeps the gzipped payload within budget', () => {
    // The measurement is pinned: gzipSync at the zlib default level, no
    // options object — the same as scripts/fonts/verify-webfont-subsets.mjs.
    //
    // The two tiers are gzipped SEPARATELY, because that is how the
    // browser sees them: two responses, two gzip streams.
    let total = 0;
    const perFamily = new Map<string, number>();
    for (const family of FAMILIES) {
      const { hotCss, extCss } = stylesheet(family);
      const bytes =
        gzipSync(Buffer.from(hotCss, 'utf8')).length +
        gzipSync(Buffer.from(extCss, 'utf8')).length;
      perFamily.set(family.key, bytes);
      total += bytes;
      expect(bytes).toBe(family.gzipBytes);
    }
    expect(perFamily.get('sans')).toBe(56049);
    expect(total).toBe(160455);
    expect(total).toBeLessThanOrEqual(VERIFIER_LIMITS.cssBytes);
    expect(perFamily.get('sans')).toBeLessThanOrEqual(VERIFIER_LIMITS.sansCssBytes);
  });
});

describe('public/font/fonts-manifest.json', () => {
  it('hashes the stylesheets into the manifest version', () => {
    const manifest = readManifest();
    expect(manifest.version).toMatch(/^[0-9a-f]{12}$/);
    expect(Object.values(manifest.files).sort()).toEqual(
      FAMILIES.flatMap((family) => [
        `/font/${family.hotFile}`,
        `/font/${family.extFile}`,
      ]).sort(),
    );

    // The version is the sha256 of the six stylesheet CONTENTS, taken in
    // file name order, cut to twelve characters. It is implemented here
    // instead of imported: the build script is not the only truth, and the
    // assertion has to keep working when the script moves on.
    //
    // ⚠️ ALL SIX go into the hash. A stylesheet that is not hashed is a
    // stylesheet whose bytes can change without the `?v=` token changing —
    // and the browser would then keep the old file for a year.
    const hash = createHash('sha256');
    for (const file of FAMILIES.flatMap((family) => [
      family.hotFile,
      family.extFile,
    ]).sort()) {
      hash.update(readStylesheet(file));
    }
    expect(hash.digest('hex').slice(0, 12)).toBe(manifest.version);
  });

  it('is what the layout uses to build versioned, cacheable URLs', () => {
    const manifest = readManifest();
    const layout = readFileSync(resolve(ROOT, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('getFontCssLinks()');
    // Only the sans HOT tier stays on the critical path. Everything else
    // — the sans ext tier and both tiers of the other two families — is
    // fetched without blocking the first paint.
    expect(layout).toMatch(/href=\{fontCss\.sans\}[^>]*\/>/);
    for (const key of ['sansExt', 'wenkai', 'wenkaiExt', 'serif', 'serifExt']) {
      expect(layout).toMatch(
        new RegExp(`href=\{fontCss\.${key}\}[^>]*media="print"`),
      );
    }
    expect(manifest.files.sans).toContain('fonts-sans-hot.css');
    expect(manifest.files.sansExt).toContain('fonts-sans-ext.css');
  });
});

describe('the webfont model in the app', () => {
  it('names the three families in globals.css and no tiered ones', () => {
    const css = readFileSync(resolve(ROOT, 'app', 'globals.css'), 'utf8');
    for (const family of FAMILIES) {
      expect(css).toContain(`'${family.label}'`);
    }
    // The old model gave every Google subset its own family name
    // ('Noto Sans SC 1', 'Noto Sans SC Ext', ...). The new model has one
    // family name per family and lets the unicode-range pick the file, so
    // the tiered names must not come back.
    for (const legacy of [
      "'Noto Sans SC 1'",
      "'Noto Sans SC Ext'",
      "'Noto Serif SC Ext'",
      "'LXGW WenKai TC Ext'",
    ]) {
      expect(css).not.toContain(legacy);
    }

    // And each variable names exactly ONE webfont family — the rest of the
    // stack is system fonts (R15: no chain of webfont fallbacks).
    const labels = FAMILIES.map((family) => family.label);
    const variables: Array<[string, string]> = [
      ['--font-han-sans', 'Noto Sans SC'],
      ['--font-han-serif', 'Noto Serif SC'],
      ['--font-wenkai', 'LXGW WenKai TC'],
    ];
    for (const [variable, label] of variables) {
      const declaration = new RegExp(`${variable}:([^;]+);`).exec(css)?.[1] ?? '';
      const quoted = declaration.match(/'[^']+'/g) ?? [];
      const webfonts = quoted
        .map((name) => name.slice(1, -1))
        .filter((name) => labels.includes(name));
      expect(webfonts).toEqual([label]);
    }
  });

  it('has removed the old Google subsets', () => {
    for (const legacy of ['noto-sans-sc', 'noto-serif-sc', 'lxgw-wenkai-tc']) {
      expect(existsSync(resolve(FONT_DIR, legacy))).toBe(false);
    }
    expect(existsSync(resolve(FONT_DIR, 'fonts.css'))).toBe(false);
  });

  it('gives every subset URL its own version token', () => {
    const familyTokens = new Set<string>();
    for (const family of FAMILIES) {
      const tokens = new Set<string>();
      const withoutToken: string[] = [];
      for (const face of stylesheet(family).faces) {
        if (!/^[0-9a-f]{12}$/.test(face.token)) withoutToken.push(face.url);
        tokens.add(face.token);
      }
      expect(withoutToken).toEqual([]);
      // The token is per FAMILY: the family changes, the token changes.
      expect(tokens.size).toBe(1);
      familyTokens.add([...tokens][0]);
    }
    // The three families do not share a token.
    expect(familyTokens.size).toBe(FAMILIES.length);
    // And the family token is not the stylesheet version: the manifest
    // version versions the STYLESHEETS, the family token versions the
    // SUBSETS. Two layers, one URL each.
    expect(familyTokens.has(readManifest().version)).toBe(false);
  });
});

/**
 * The release segment of a face URL — the note of the two places above.
 *
 * ⚠️ An apply publishes a NEW release directory (`web/r<token>/`) and
 * rewrites the stylesheets to point at it. ⇒ The family directory the
 * subsets live in has to be located FROM THE STYLESHEET and not from the
 * constant `web/<family>` of release 0 — otherwise the test would look for
 * the files of the current release in the directory of the published one.
 *
 * ⚠️ The two-segment form (with a release) is tried FIRST: a URL that
 * carries no release must never be read as one, or the family would be
 * taken for the release.
 *
 * ⚠️ The release segment is EMPTY for release 0 — the published tree, where
 * the URL of a face is `/font/web/<family>/<file>`. ⇒ The path is then
 * byte-identical to the one the test used before the release directory
 * model existed (`web/sans`), and the pinned numbers of this file stay
 * exactly as green as they are today.
 */
const RELEASE_SEGMENT_NOTE = 'see the note below the suites';

/**
 * The release segment of a face.
 *
 * ⚠️ The field is declared HERE, at the bottom of the file, and not in the
 * interface above: the pinned numbers of this file live on fixed lines (the
 * ones the re-base checklist of an apply names), so nothing may be
 * inserted above them. TypeScript merges the two declarations of `Face`.
 */
interface Face {
  /** The release segment of the URL, e.g. `r0a1b2c3d4e5f`. */
  release: string;
}

/**
 * The directory the subset files of a family live in, as the stylesheet
 * says — `web/[<release>/]<family>`.
 *
 * ⚠️ It is defined BELOW the suites on purpose, for the same reason.
 */
function subsetDirOf(family: Family): string {
  const releases = new Set(stylesheet(family).faces.map((face) => face.release));
  if (releases.size > 1) {
    throw new Error(
      `the stylesheet of ${family.key} points at more than one release: ${[...releases].join(', ')}`,
    );
  }
  const release = [...releases][0] ?? '';
  return release === '' ? family.subsetDir : `web/${release}/${family.key}`;
}
