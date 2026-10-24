/**
 * Regression tests for the practice-PDF font subset.
 *
 * The printable worksheet is rendered in the browser by react-pdf, which
 * embeds a *subset* of the registered font into the file. react-pdf's
 * subsetter only works on TrueType sources: with the WOFF2 subset it died
 * with "RangeError: Offset is outside the bounds of the DataView" while
 * writing the composite glyphs. The PDF therefore uses its own tiny TTF
 * subset (public/fonts/zcool-xiaowei-pdf.ttf) that holds exactly the
 * characters the PDF draws.
 *
 * These tests pin that subset down: a new header text must not silently
 * fall back to a blank glyph, and the file must stay orders of magnitude
 * smaller than the 6.3 MB original.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fontkit from 'fontkit';
import {
  PRACTICE_PDF_BRAND,
  PRACTICE_PDF_CELL_STYLE_LABELS,
  PRACTICE_PDF_FONT_FAMILY,
  PRACTICE_PDF_FONT_FILE,
  PRACTICE_PDF_SUBTITLE,
  practicePdfFontCharset,
} from '@/lib/practice-pdf-font';
import { cellStyleLabel, type CellStyle } from '@/lib/worksheet-types';

const ROOT = resolve(__dirname, '..', '..', '..');
const FONT_PATH = resolve(ROOT, 'public', 'fonts', PRACTICE_PDF_FONT_FILE);
const SOURCE_PATH = resolve(ROOT, 'assets', 'fonts', 'zcool-xiaowei.ttf');

/** The PDF font must stay far below the 6.3 MB of the original TTF. */
const MAX_FONT_BYTES = 300 * 1024;

const ALL_CELL_STYLES: CellStyle[] = [
  'brush-square',
  'brush-cross',
  'brush-trace-square',
  'brush-trace-cross',
  'pen-square',
  'pen-cross',
  'pen-lined',
  'pen-english',
];

describe('practice PDF font metadata', () => {
  it('registers the family the PDF styles ask for', () => {
    expect(PRACTICE_PDF_FONT_FAMILY).toBe('ZCOOLXiaoWei');
    expect(PRACTICE_PDF_FONT_FILE).toMatch(/\.ttf$/);
  });

  it('lists a label for every cell style the PDF can render', () => {
    for (const style of ALL_CELL_STYLES) {
      expect(PRACTICE_PDF_CELL_STYLE_LABELS).toContain(cellStyleLabel(style));
    }
  });

  it('puts the brand, the subtitle and the labels into the charset', () => {
    const charset = practicePdfFontCharset();
    for (const text of [
      PRACTICE_PDF_BRAND,
      PRACTICE_PDF_SUBTITLE,
      ...PRACTICE_PDF_CELL_STYLE_LABELS,
    ]) {
      for (const ch of text) {
        expect(charset).toContain(ch);
      }
    }
  });

  it('covers the printable ASCII — the footer shows the site host', () => {
    const charset = practicePdfFontCharset();
    for (const ch of 'ziyun.pudafo.com') {
      expect(charset).toContain(ch);
    }
    expect(charset).toContain(' ');
  });
});

describe('practice PDF font file', () => {
  it('exists under public/fonts', () => {
    expect(existsSync(FONT_PATH)).toBe(true);
  });

  it('stays far below the size of the original TTF', () => {
    expect(statSync(FONT_PATH).size).toBeLessThanOrEqual(MAX_FONT_BYTES);
    expect(statSync(FONT_PATH).size).toBeLessThan(statSync(SOURCE_PATH).size);
  });

  it('renders every character the PDF draws', () => {
    // A regression is a character the ORIGINAL font could render but the
    // subset cannot. Characters missing from the original (the "·"
    // separator is not in ZCOOL XiaoWei) are not regressions.
    const source = fontkit.openSync(SOURCE_PATH);
    const subset = fontkit.openSync(FONT_PATH);
    const regressions: string[] = [];
    for (const ch of new Set(practicePdfFontCharset())) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      if (source.hasGlyphForCodePoint(cp) && !subset.hasGlyphForCodePoint(cp)) {
        regressions.push(ch);
      }
    }
    expect(regressions).toEqual([]);
  });
});
