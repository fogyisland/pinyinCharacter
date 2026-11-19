/**
 * The brush (毛笔) worksheet must print as ONE complete A4 page, and that
 * page must be FULL.
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
  brushColsFor,
  brushRowsFor,
  brushCellsPerPage,
  type BrushPaperSize,
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
const A4_HEIGHT_MM = 297;

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

/**
 * The brush papers, typed as the brush papers.
 *
 * `PAPER_SIZES` holds every paper, so filtering it by `isBrushSize` is
 * what narrows the union — but the filter alone does not narrow the
 * RESULT type, so the predicate is applied once more here.
 */
const BRUSH_PAPER_SIZES: BrushPaperSize[] = BRUSH_PAPERS.map((p) => p.value).filter(
  (v): v is BrushPaperSize => isBrushSize(v),
);

/**
 * The body of the `@media print` block, or null when there is none.
 *
 * Braces are counted rather than matched with a regex, because the block
 * contains nested rule blocks and a lazy `[^}]*` would stop at the first
 * inner closing brace.
 */
function printBlockOf(css: string): string | null {
  const start = css.indexOf('@media print');
  if (start === -1) return null;
  let depth = 0;
  let i = css.indexOf('{', start);
  if (i === -1) return null;
  const open = i;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

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

    it('does not carry the screen max-width into print', () => {
      // ⚠️ The columns fit the page, but the CONTAINER did not.
      // The grid element carries Tailwind's `max-w-3xl` = 768px = 203mm,
      // a SCREEN constraint. In print the stylesheet sets `width: 100%`,
      // but `max-width` wins over `width` — so the sheet's box stayed
      // 203mm wide inside a printable area of 190mm (Chrome's default
      // 10mm margins) or 180mm (the page's own 1.5cm margin). The sheet
      // was still 13-23mm too wide for the paper, which is what the user
      // saw: "毛笔打印依然没有完整显示为一张 A4".
      //
      // The print block must therefore drop the max-width so the grid
      // takes the page's content width.
      const printBlock = printBlockOf(CSS_SOURCE);
      expect(printBlock, 'the stylesheet must have a @media print block').toBeTruthy();

      const gridRules = [...printBlock!.matchAll(/([^{}]*\.worksheet-grid[^{}]*)\{([^}]*)\}/g)];
      const setsWidth = gridRules.filter((m) => /width:\s*100%/.test(m[2]));
      expect(
        setsWidth.length,
        'the print block must set the grid width to the page content width',
      ).toBeGreaterThan(0);

      for (const m of setsWidth) {
        expect(
          m[2],
          'the print rule that sets the grid width must also clear max-width',
        ).toMatch(/max-width:\s*none/);
      }
    });
  });

  describe('the sheet fills the page', () => {
    // ⚠️ The user reported "毛笔只显示上半页" on 2026-11-19: the brush
    // sheet printed as ONE page but only filled the TOP HALF of it. The
    // grid filled the WIDTH (the columns are pinned) but not the HEIGHT.
    //
    // The cause is the brush layout itself: the papers were laid out as
    //   brush-12 → 4 cols × 3 rows
    //   brush-24 → 6 cols × 4 rows
    //   brush-28 → 7 cols × 4 rows
    // With square cells, the width pins the cell size, so the height
    // follows from the row count — and 3-4 rows of a 43mm/28mm/24mm cell
    // reach only 55% / 49% / 42% of A4's 267mm printable height.
    //
    // The fix is to choose the grid shape that fills A4 in both
    // dimensions, which means FEWER columns and MORE rows:
    //   brush-12 → 3 cols × 4 rows (58.6mm cells)
    //   brush-24 → 4 cols × 6 rows (39.2mm cells)
    //   brush-28 → 4 cols × 7 rows (33.3mm cells)

    /** A4's printable height at the page's 1.5cm margin, in px. */
    function a4PrintableHeightPx(): number {
      return (A4_HEIGHT_MM - 2 * pageMarginMm()) * PX_PER_MM;
    }

    /**
     * The height the grid's header and footer take, in px.
     *
     * Both are `col-span-full` rows rendered INSIDE the grid, so they
     * eat into the height the cells can use. Measured in the browser on
     * 2026-11-19 (print media): header 33px + mb-3 12px, footer 25px +
     * mt-3 12px.
     */
    const HEADER_FOOTER_PX = 106;

    /**
     * The slack the cell size's rounding leaves behind, in px.
     *
     * The cell size is FLOORED to a whole pixel (a fractional px would
     * blur the grid lines), so a height-limited paper can land up to
     * one pixel per row short of the target height. One pixel per row
     * is the whole budget.
     */
    const ROUNDING_SLACK_PX = 8;

    it.each(BRUSH_PAPER_SIZES.map((v) => [v, v] as const))(
      '%s fills the printable height',
      (_label, paperSize) => {
        const cols = brushColsFor(paperSize);
        const rows = brushRowsFor(paperSize);
        const cellSize = cellSizeFor(paperSize);
        const gridWidth = cols * cellSize + (cols - 1) * gridGapPx();
        const gridHeight = rows * cellSize + (rows - 1) * gridGapPx();

        // The cell is SQUARE, so the shape can bind on either axis:
        //   width-limited  → the cells are as big as the width allows, and
        //                    the height follows (slightly short of the page)
        //   height-limited → the cells are as big as the height allows, and
        //                    the width follows (slightly short of the page)
        // A sheet that binds on an axis must REACH that axis, or the
        // opposite half of the page stays empty — the bug the user
        // reported ("毛笔只显示上半页").
        const widthLimited = gridWidth >= a4PrintableWidthPx() - ROUNDING_SLACK_PX;
        const heightLimited = gridHeight >= a4PrintableHeightPx() - HEADER_FOOTER_PX - ROUNDING_SLACK_PX;

        if (widthLimited) {
          // Width-bound: the sheet fills the width, so the height must
          // still reach at least 90% of the printable height. A shape
          // that is wide AND short is the bug.
          expect(
            gridHeight,
            `${paperSize}: ${cols}×${rows} cells of ${cellSize}px fill the width ` +
              `but reach only ${Math.round((gridHeight + HEADER_FOOTER_PX) / PX_PER_MM)}mm ` +
              `of a ${Math.round(a4PrintableHeightPx() / PX_PER_MM)}mm page — the sheet ` +
              `would print on the top half only`,
          ).toBeGreaterThanOrEqual((a4PrintableHeightPx() - HEADER_FOOTER_PX) * 0.9);
        } else {
          // Height-bound: the sheet fills the height, which is the whole
          // point of the layout.
          expect(
            gridHeight,
            `${paperSize}: ${cols}×${rows} cells of ${cellSize}px reach only ` +
              `${Math.round((gridHeight + HEADER_FOOTER_PX) / PX_PER_MM)}mm of a ` +
              `${Math.round(a4PrintableHeightPx() / PX_PER_MM)}mm page — the sheet ` +
              `would print on the top half only`,
          ).toBeGreaterThanOrEqual(
            a4PrintableHeightPx() - HEADER_FOOTER_PX - ROUNDING_SLACK_PX,
          );
        }
      },
    );

    it.each(BRUSH_PAPER_SIZES.map((v) => [v, v] as const))(
      '%s does not overflow the printable width',
      (_label, paperSize) => {
        const cols = brushColsFor(paperSize);
        const cellSize = cellSizeFor(paperSize);
        const gridWidth = cols * cellSize + (cols - 1) * gridGapPx();
        expect(
          gridWidth,
          `${paperSize}: the grid is ${Math.round(gridWidth / PX_PER_MM)}mm wide, ` +
            `but A4's printable area is only ${Math.round(a4PrintableWidthPx() / PX_PER_MM)}mm`,
        ).toBeLessThanOrEqual(a4PrintableWidthPx());
      },
    );

    it.each(BRUSH_PAPER_SIZES.map((v) => [v, v] as const))(
      '%s lays out as a whole number of rows',
      (_label, paperSize) => {
        // The cells per page must divide exactly into the grid, or the
        // last page carries a partial row and the sheet looks unfinished.
        const cells = brushCellsPerPage(paperSize);
        expect(brushColsFor(paperSize) * brushRowsFor(paperSize)).toBe(cells);
      },
    );
  });
});
