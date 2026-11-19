/**
 * The brush (毛笔) worksheet must print as ONE complete A4 page.
 *
 * ⚠️ This is the bug the user reported on 2026-11-19: "毛笔打印的时候，
 * 并没有完整显示为一张 A4 图" — the brush sheet printed across TWO A4
 * pages, with the second page mostly blank and carrying only the tail of
 * the grid plus the "·句·" separator.
 *
 * TWO causes stack up, and both are pinned here:
 *
 * ① The @page rule carried NO size for the brush papers.
 *     `size: brush-12` is not a valid CSS @page keyword, so the browser
 *     drops the WHOLE declaration and falls back to the printer default —
 *     which is not necessarily A4. The fix is to map the brush sizes onto
 *     A4 explicitly (pageSizeFor() in lib/worksheet-types.ts).
 *
 * ② The grid was WIDER than A4's printable area.
 *     The brush cells were laid out in `minmax(0, 1fr)` columns, so they
 *     STRETCH to fill the container. The container is capped at
 *     `max-w-3xl` = 768px = 203mm, but A4's printable area (210mm minus
 *     the 1.5cm margin on each side) is only 180mm = 680px. The grid
 *     therefore overflowed the page by 23mm on the right, and the browser
 *     pushed the overflow onto a second page.
 *
 *     The fix is to size the columns from the CELL SIZE instead of
 *     letting them stretch: `repeat(N, <cellSize>px)` makes the grid's
 *     width a function of the brush layout, not of the viewport.
 *
 * ⚠️ The assertions are computed, not hard-coded, so a change to the
 * cell size or the page margin is re-checked rather than silently
 * breaking the fit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PAPER_SIZES,
  isBrushSize,
  cellSizeFor,
  pageSizeFor,
} from '@/lib/worksheet-types';

const PREVIEW_SOURCE = readFileSync(
  resolve(process.cwd(), 'components/worksheet/WorksheetPreview.tsx'),
  'utf-8',
);
const PRACTICE_SOURCE = readFileSync(
  resolve(process.cwd(), 'components/worksheet/PracticeTemplate.tsx'),
  'utf-8',
);
const CSS_SOURCE = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf-8');

/** CSS px per mm at the CSS reference resolution of 96dpi. */
const PX_PER_MM = 96 / 25.4;

/** A4 in mm. */
const A4_WIDTH_MM = 210;

/**
 * The margin the print stylesheet asks for, in mm.
 *
 * ⚠️ Read out of the source rather than assumed: if the margin changes,
 * the printable width changes, and the fit assertion must follow.
 * The regex tolerates the `${...}` interpolation inside the rule — a
 * naive `[^}]*` would stop at the closing brace of the interpolation.
 */
function pageMarginMm(): number {
  for (const source of [PREVIEW_SOURCE, PRACTICE_SOURCE]) {
    // The rule interpolates a JS expression, which contains braces of its
    // own (`${pageSizeFor(paperSize)}`). A `[^{}]*` character class would
    // stop at that closing brace, so the search is bounded by the
    // `margin:` keyword instead: match up to the margin declaration
    // without ever having to cross the whole rule.
    const m = source.match(/@page\s*\{[\s\S]{0,120}?margin:\s*([\d.]+)cm/);
    if (m) return Number(m[1]) * 10;
  }
  throw new Error('no @page rule declares a margin');
}

/** A4's printable width in px, given the declared margin. */
function a4PrintableWidthPx(): number {
  return (A4_WIDTH_MM - 2 * pageMarginMm()) * PX_PER_MM;
}

/** The gap between the grid cells, in px. `gap-2` is 0.5rem = 8px. */
function gridGapPx(): number {
  const m = CSS_SOURCE.match(/\.worksheet-grid\s*\{[^}]*gap:\s*([\d.]+)px/);
  if (!m) {
    // The class may not set the gap itself (Tailwind's `gap-2` does).
    // Fall back to the Tailwind spacing scale, which is what the class
    // name means.
    return 8;
  }
  return Number(m[1]);
}

/** The brush papers and their column counts, from the one source of truth. */
const BRUSH_PAPERS = PAPER_SIZES.filter((p) => isBrushSize(p.value));

/** Every page-emitting worksheet component. */
const PAGE_COMPONENTS: ReadonlyArray<readonly [string, string]> = [
  ['WorksheetPreview', PREVIEW_SOURCE],
  ['PracticeTemplate', PRACTICE_SOURCE],
];

describe('the brush worksheet prints as one A4 page', () => {
  it('has brush papers to check', () => {
    expect(BRUSH_PAPERS.length).toBeGreaterThan(0);
  });

  describe('the @page rule', () => {
    it.each(PAGE_COMPONENTS)(
      '%s takes its @page size from the mapping, not the raw paper key',
      (_name, source) => {
        // The declaration is `size: ${...}`. For the brush papers the raw
        // key is not a CSS keyword, so the browser drops the declaration
        // and uses the printer default — which is how the sheet stopped
        // being an A4. The rule must therefore MAP the brush papers onto
        // A4 rather than interpolate the raw key.
        expect(source, `${_name} must set a @page size`).toMatch(/@page\s*\{[^{}]*size:/);
        expect(
          source,
          `${_name} must build its @page size from pageSizeFor()`,
        ).toMatch(/size:\s*\$\{\s*pageSizeFor\(/);
        expect(
          source,
          `${_name} must not interpolate the raw paper key into the @page size`,
        ).not.toMatch(/size:\s*\$\{\s*(props\.)?paperSize\s*\}/);
      },
    );

    it('maps every brush paper onto A4', () => {
      // The mapping has to be visible in the behaviour: a brush paper that
      // falls through to the raw key prints on whatever the printer
      // default is.
      for (const paper of BRUSH_PAPERS) {
        expect(
          pageSizeFor(paper.value),
          `${paper.value} must print on A4`,
        ).toBe('a4');
      }
    });

    it('keeps the real paper sizes on their own sheets', () => {
      // The mapping must not over-reach: A3 / A4 / B5 ARE valid CSS
      // keywords and have to keep mapping to themselves.
      expect(pageSizeFor('A3')).toBe('a3');
      expect(pageSizeFor('A4')).toBe('a4');
      expect(pageSizeFor('B5')).toBe('b5');
    });
  });

  describe('the grid width', () => {
    it.each(BRUSH_PAPERS.map((p) => [p.label, p.value, p.cols] as const))(
      '%s fits A4 printable width',
      (_label, paperSize, cols) => {
        const cellSize = cellSizeFor(paperSize);
        const gridWidth = cols * cellSize + (cols - 1) * gridGapPx();
        expect(
          gridWidth,
          `${paperSize}: the grid is ${Math.round(gridWidth / PX_PER_MM)}mm wide, ` +
            `but A4's printable area is only ${Math.round(a4PrintableWidthPx() / PX_PER_MM)}mm`,
        ).toBeLessThanOrEqual(a4PrintableWidthPx());
      },
    );

    it('sizes the brush columns from the cell size instead of stretching them', () => {
      // `minmax(0, 1fr)` makes the columns stretch to the container width,
      // which is how the grid outgrew the page. The brush rules must pin
      // the column width to the cell size.
      for (const paper of BRUSH_PAPERS) {
        const rule = new RegExp(
          `\\.worksheet-grid--${paper.value}\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(\\s*${paper.cols}\\s*,\\s*${cellSizeFor(paper.value)}px\\)`,
        );
        expect(
          CSS_SOURCE,
          `.worksheet-grid--${paper.value} must pin its columns to ` +
            `${cellSizeFor(paper.value)}px so the grid cannot stretch past the page`,
        ).toMatch(rule);
      }
    });

    it('does not let the brush grids stretch with 1fr columns', () => {
      for (const paper of BRUSH_PAPERS) {
        const rule = new RegExp(
          `\\.worksheet-grid--${paper.value}\\s*\\{([^}]*)\\}`,
        );
        const m = CSS_SOURCE.match(rule);
        expect(m, `.worksheet-grid--${paper.value} must exist`).toBeTruthy();
        expect(
          m![1],
          `.worksheet-grid--${paper.value} must not use 1fr columns`,
        ).not.toContain('1fr');
      }
    });
  });
});
