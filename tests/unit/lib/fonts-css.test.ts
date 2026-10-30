/**
 * Regression tests for the per-family webfont stylesheets.
 *
 * public/font/fonts-{sans,serif,wenkai}.css are the generated stylesheets of
 * the frequency-tiered webfont model. `fonts-sans.css` is the only one on the
 * critical path — the body typeface draws every character of every page — and
 * the other two are fetched with media="print" and promoted once they arrive.
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
 * shipped build (Task 3, filter round F31-a plus the R18 tokens). A rebuild
 * that changes them has to change the constants here on purpose — the
 * budgets are not to be relaxed to make a build pass.
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
  /** The stylesheet of the family. */
  file: string;
  /** The directory the subset files of the family live in, under /public/font. */
  subsetDir: string;
  /** The faces of the stylesheet: the hot zone plus the Ext blocks. */
  faces: number;
  /** The raw size of the stylesheet, in bytes. */
  rawBytes: number;
  /** The gzipped size of the stylesheet, in bytes. */
  gzipBytes: number;
}

const FAMILIES: Family[] = [
  {
    key: 'sans',
    label: 'Noto Sans SC',
    file: 'fonts-sans.css',
    subsetDir: 'web/sans',
    faces: 2459,
    rawBytes: 620320,
    gzipBytes: 55437,
  },
  {
    key: 'serif',
    label: 'Noto Serif SC',
    file: 'fonts-serif.css',
    subsetDir: 'web/serif',
    faces: 2841,
    rawBytes: 722614,
    gzipBytes: 63915,
  },
  {
    key: 'wenkai',
    label: 'LXGW WenKai TC',
    file: 'fonts-wenkai.css',
    subsetDir: 'web/wenkai',
    faces: 2636,
    rawBytes: 666617,
    gzipBytes: 37930,
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

/** Parse the @font-face rules of a stylesheet. */
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
      token: token ? token[1] : '',
      unicodeRange: cssField(body, 'unicode-range'),
    });
    match = block.exec(css);
  }
  return faces;
}

/** The parsed stylesheet of a family, read once per run. */
const stylesheetCache = new Map<string, { css: string; faces: Face[] }>();

function stylesheet(family: Family): { css: string; faces: Face[] } {
  const cached = stylesheetCache.get(family.file);
  if (cached) return cached;
  const css = readStylesheet(family.file);
  const parsed = { css, faces: parseFaces(css) };
  stylesheetCache.set(family.file, parsed);
  return parsed;
}

/** The subset files of a family, as they sit on disk. */
function subsetFiles(family: Family): string[] {
  return readdirSync(resolve(FONT_DIR, family.subsetDir)).filter((name) =>
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
  it('ships one stylesheet per family', () => {
    for (const family of FAMILIES) {
      expect(existsSync(resolve(FONT_DIR, family.file))).toBe(true);
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
    let cssBytes = 0;
    for (const family of FAMILIES) {
      const rawBytes = Buffer.byteLength(stylesheet(family).css, 'utf8');
      expect(rawBytes).toBe(family.rawBytes);
      cssBytes += rawBytes;
    }
    // The three stylesheets together, raw: the CSS the browser has to parse
    // before it can paint a single character.
    expect(cssBytes).toBe(2009551);
    // fonts-sans.css is the only stylesheet on the critical path; the other
    // two are fetched without blocking the first paint.
    const sans = FAMILIES.find((family) => family.key === 'sans');
    if (!sans) throw new Error('the sans family is missing from FAMILIES');
    expect(Buffer.byteLength(stylesheet(sans).css, 'utf8')).toBeLessThanOrEqual(
      SANS_RAW_BYTES,
    );
    // Every font byte the site can possibly ask for. The browser downloads
    // only the handful the page draws, but the whole set has to be
    // deployed, cached and kept in the bundle budget.
    const subsets = allSubsetFiles();
    expect(subsets.length).toBe(7936);
    expect(subsets.reduce((total, file) => total + file.bytes, 0)).toBe(28127360);
  });

  it('keeps the gzipped payload within budget', () => {
    // The measurement is pinned: gzipSync at the zlib default level, no
    // options object — the same as scripts/fonts/verify-webfont-subsets.mjs.
    let total = 0;
    const perFamily = new Map<string, number>();
    for (const family of FAMILIES) {
      const bytes = gzipSync(Buffer.from(stylesheet(family).css, 'utf8')).length;
      perFamily.set(family.key, bytes);
      total += bytes;
      expect(bytes).toBe(family.gzipBytes);
    }
    expect(perFamily.get('sans')).toBe(55437);
    expect(total).toBe(157282);
    expect(total).toBeLessThanOrEqual(VERIFIER_LIMITS.cssBytes);
    expect(perFamily.get('sans')).toBeLessThanOrEqual(VERIFIER_LIMITS.sansCssBytes);
  });
});

describe('public/font/fonts-manifest.json', () => {
  it('hashes the stylesheets into the manifest version', () => {
    const manifest = readManifest();
    expect(manifest.version).toMatch(/^[0-9a-f]{12}$/);
    expect(Object.values(manifest.files).sort()).toEqual(
      FAMILIES.map((family) => `/font/${family.file}`).sort(),
    );

    // The version is the sha256 of the three stylesheet CONTENTS, taken in
    // file name order, cut to twelve characters. It is implemented here
    // instead of imported: the build script is not the only truth, and the
    // assertion has to keep working when the script moves on.
    const hash = createHash('sha256');
    for (const file of FAMILIES.map((family) => family.file).sort()) {
      hash.update(readStylesheet(file));
    }
    expect(hash.digest('hex').slice(0, 12)).toBe(manifest.version);
  });

  it('is what the layout uses to build versioned, cacheable URLs', () => {
    const manifest = readManifest();
    const layout = readFileSync(resolve(ROOT, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('getFontCssLinks()');
    // The body typeface stays on the critical path, the other two do not.
    expect(layout).toMatch(/href=\{fontCss\.sans\}[^>]*\/>/);
    expect(layout).toMatch(/href=\{fontCss\.wenkai\}[^>]*media="print"/);
    expect(layout).toMatch(/href=\{fontCss\.serif\}[^>]*media="print"/);
    expect(manifest.files.sans).toContain('fonts-sans.css');
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
