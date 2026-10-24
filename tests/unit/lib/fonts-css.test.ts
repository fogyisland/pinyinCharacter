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
} from '../../../scripts/fonts/build-fonts-css.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const CSS_PATH = resolve(ROOT, 'public', 'font', 'fonts.css');
const css = readFileSync(CSS_PATH, 'utf8');
const faces = parseCss(css);

/** Largest size the stylesheet may reach before it is considered a regression. */
const MAX_CSS_BYTES = 600 * 1024;

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
