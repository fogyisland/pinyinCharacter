/**
 * Regression tests for public/font/fonts.css.
 *
 * public/font/fonts.css is loaded synchronously in app/layout.tsx, so it
 * blocks the first paint of every page. It used to be a verbatim copy of
 * Google Fonts' css2 output: 937 @font-face blocks (1.03 MB) describing only
 * 432 font files, because Noto Sans SC and Noto Serif SC are VARIABLE fonts
 * that had one weight declaration per subset.
 *
 * scripts/fonts/build-fonts-css.mjs collapses those into one face per subset
 * with a weight range. These tests pin the result down so a careless edit of
 * the generated file cannot silently drop a font or grow the stylesheet back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseCss,
  serialize,
  mergeWeights,
  splitByFamily,
} from '../../../scripts/fonts/build-fonts-css.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const CSS_PATH = resolve(ROOT, 'public', 'font', 'fonts.css');
const css = readFileSync(CSS_PATH, 'utf8');
const faces = parseCss(css);

/** Largest size the stylesheet may reach before it is considered a regression. */
const MAX_CSS_BYTES = 600 * 1024;

/** The per-family stylesheets the root layout loads. */
const SPLIT_FILES = ['fonts-wenkai.css', 'fonts-sans.css', 'fonts-serif.css'];

describe('public/font/fonts.css', () => {
  it('parses into @font-face rules', () => {
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBe((css.match(/@font-face/g) ?? []).length);
  });

  it('keeps the stylesheet small enough to not block the first paint', () => {
    expect(statSync(CSS_PATH).size).toBeLessThanOrEqual(MAX_CSS_BYTES);
  });

  it('declares exactly one face per font file', () => {
    const keys = new Set(faces.map((f) => `${f.family}|${f.style}|${f.unicodeRange}|${f.src}`));
    expect(keys.size).toBe(faces.length);
  });

  it('references only font files that exist on disk', () => {
    const missing = faces
      .map((f) => f.src)
      .filter((src) => !existsSync(resolve(ROOT, 'public', src.replace(/^\//, ''))));
    expect(missing).toEqual([]);
  });

  it('declares a valid weight for every face', () => {
    for (const face of faces) {
      const weights = face.weight.split(/\s+/);
      expect(weights.length).toBeGreaterThanOrEqual(1);
      for (const weight of weights) {
        const value = Number.parseInt(weight, 10);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(1000);
      }
      if (weights.length === 2) {
        expect(Number.parseInt(weights[0], 10)).toBeLessThanOrEqual(
          Number.parseInt(weights[1], 10),
        );
      }
    }
  });

  it('covers the three families the site loads', () => {
    const families = new Set(faces.map((f) => f.family));
    expect(families).toEqual(
      new Set(['LXGW WenKai TC', 'Noto Sans SC', 'Noto Serif SC']),
    );
  });

  it('merges the variable Noto faces into weight ranges', () => {
    const sans = faces.filter((f) => f.family === 'Noto Sans SC');
    const serif = faces.filter((f) => f.family === 'Noto Serif SC');
    // Every face of a variable family shares one file per subset, so each
    // subset must be described by exactly one (ranged) face.
    expect(new Set(sans.map((f) => f.src)).size).toBe(sans.length);
    expect(new Set(serif.map((f) => f.src)).size).toBe(serif.length);
    expect(sans[0].weight).toMatch(/^\d+ \d+$/);
    expect(serif[0].weight).toMatch(/^\d+ \d+$/);
  });

  it('keeps the static LXGW WenKai TC faces separate', () => {
    const lxgw = faces.filter((f) => f.family === 'LXGW WenKai TC');
    const weights = new Set(lxgw.map((f) => f.weight));
    expect(weights).toEqual(new Set(['400', '700']));
  });

  it('is idempotent — rebuilding the merged file changes nothing', () => {
    const rebuilt = `${mergeWeights(faces).map(serialize).join('\n')}\n`;
    expect(rebuilt).toBe(`${faces.map(serialize).join('\n')}\n`);
  });
});

describe('public/font per-family stylesheets', () => {
  it('writes one stylesheet per family', () => {
    const splits = splitByFamily(faces);
    expect([...splits.keys()].sort()).toEqual([...SPLIT_FILES].sort());
    for (const file of SPLIT_FILES) {
      expect(existsSync(resolve(ROOT, 'public', 'font', file))).toBe(true);
    }
  });

  it('keeps every face of fonts.css in exactly one split file', () => {
    const splits = splitByFamily(faces);
    const splitFaces = [...splits.values()].flatMap((body) => parseCss(body));
    expect(splitFaces.length).toBe(faces.length);
    const key = (f: { family: string; style: string; unicodeRange: string; src: string }) =>
      `${f.family}|${f.style}|${f.unicodeRange}|${f.src}`;
    expect(new Set(splitFaces.map(key)).size).toBe(splitFaces.length);
    expect(new Set(splitFaces.map(key))).toEqual(new Set(faces.map(key)));
  });

  it('gives each split file exactly one family', () => {
    for (const file of SPLIT_FILES) {
      const body = readFileSync(resolve(ROOT, 'public', 'font', file), 'utf8');
      const families = new Set(parseCss(body).map((f) => f.family));
      expect(families.size).toBe(1);
    }
  });

  it('keeps the render-blocking part of the payload small', () => {
    // fonts-sans.css is the only stylesheet on the critical path; the other
    // two are fetched without blocking the first paint.
    const sansBytes = statSync(resolve(ROOT, 'public', 'font', 'fonts-sans.css')).size;
    expect(sansBytes).toBeLessThanOrEqual(140 * 1024);
  });
});

describe('public/font/fonts-manifest.json', () => {
  const manifestPath = resolve(ROOT, 'public', 'font', 'fonts-manifest.json');

  it('exists and points at the generated stylesheets', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string;
      files: Record<string, string>;
    };
    expect(manifest.version).toMatch(/^[0-9a-f]{12}$/);
    expect(Object.values(manifest.files).sort()).toEqual(
      SPLIT_FILES.map((f) => `/font/${f}`).sort(),
    );
  });

  it('is what the layout uses to build versioned, cacheable URLs', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string;
      files: Record<string, string>;
    };
    const layout = readFileSync(resolve(ROOT, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('getFontCssLinks()');
    // The body typeface stays on the critical path, the other two do not.
    expect(layout).toMatch(/href=\{fontCss\.sans\}[^>]*\/>/);
    expect(layout).toMatch(/href=\{fontCss\.wenkai\}[^>]*media="print"/);
    expect(layout).toMatch(/href=\{fontCss\.serif\}[^>]*media="print"/);
    expect(manifest.files.sans).toContain('fonts-sans.css');
  });
});
