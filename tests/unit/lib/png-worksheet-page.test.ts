import { describe, expect, it } from 'vitest';
import {
  computePageLayout,
  pageCellCount,
  pageCount,
  renderWorksheetPage,
  type WorksheetPageRequest,
} from '@/lib/png/worksheet-page';
import { generateLayout } from '@/lib/worksheet-types';
import { getPixel, type Canvas } from '@/lib/png/raster';

/**
 * The page is measured, not calculated.
 *
 * Every coordinate below was read off a rendered A4 page at scale 1 (see the
 * probe in the batch notes): the first cell of the grid starts at (56, 111),
 * its side is 70 px and the 100-unit viewBox of `WorksheetCell.tsx` makes one
 * unit 0.7 px. The frame of that cell — `rect(2, 2, 96, 96)` stroked with a
 * 1 px line — lands on the columns 57 and 124 and on the rows 112 and 179;
 * the two 0.5 px guides land on the columns 90/91 and the rows 145/146.
 */
const FRAME_LEFT_X = 57;
const FRAME_RIGHT_X = 124;
const FRAME_TOP_Y = 112;
const FRAME_BOTTOM_Y = 179;
/** A point inside the frame that neither guide crosses. */
const INTERIOR_X = 80;
const INTERIOR_Y = 130;
const VERTICAL_GUIDE_X = 91;
const HORIZONTAL_GUIDE_Y = 146;

/** The colours the trace character is drawn with. */
const TRACE_FILL_COLOUR = { r: 0xdd, g: 0xdd, b: 0xdd };
const TRACE_STROKE_COLOUR = { r: 0xc0, g: 0x39, b: 0x2b };

/**
 * The header band, in CSS px.
 *
 * The band starts at the margin (56) and is 40 px tall, but the rule under it
 * is a 1 px line on the row 96 and its square ends bleed one pixel up into
 * the row 95 — so the band of the text stops at 94.
 */
const HEADER_BAND_TOP = 56;
const HEADER_BAND_BOTTOM = 94;

/** Builds a request with the site's defaults; every field can be overridden. */
function request(overrides: Partial<WorksheetPageRequest> = {}): WorksheetPageRequest {
  return {
    title: '测试',
    cells: generateLayout(['一', '二'], 'brush-square', 'A4'),
    cellStyle: 'brush-square',
    paperSize: 'A4',
    fontFamily: 'ma-shan-zheng',
    page: 1,
    scale: 1,
    siteHost: 'ziyun.pudafo.com',
    ...overrides,
  };
}

/**
 * A grid page whose cells are all empty.
 *
 * The frame and the guides are the only ink on such a page, so a pixel read
 * on it belongs to the frame and not to a character drawn over it.
 */
function emptyGridPage(): Promise<Canvas> {
  return renderWorksheetPage(request({ cells: generateLayout([], 'brush-square', 'A4') }));
}

/** Counts the pixels of a rectangle that are within `tolerance` of `colour`. */
function countPixelsNear(
  canvas: Canvas,
  box: { left: number; top: number; right: number; bottom: number },
  colour: { r: number; g: number; b: number },
  tolerance: number,
): number {
  let count = 0;
  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      const pixel = getPixel(canvas, x, y);
      const delta = Math.max(
        Math.abs(pixel.r - colour.r),
        Math.abs(pixel.g - colour.g),
        Math.abs(pixel.b - colour.b),
      );
      if (delta <= tolerance) count += 1;
    }
  }
  return count;
}

/** Whether a pixel carries any ink at all. */
function hasInk(canvas: Canvas, x: number, y: number): boolean {
  const pixel = getPixel(canvas, x, y);
  return pixel.r < 255 || pixel.g < 255 || pixel.b < 255;
}

/**
 * The left edge of the label in the header band.
 *
 * The label is right-aligned on the right edge of the content, so the first
 * inked column right of the middle of the page is where it starts — the
 * title is on the other side of the middle and cannot be mistaken for it.
 */
function findLabelLeft(canvas: Canvas): number {
  for (let x = Math.floor(canvas.width / 2); x < canvas.width; x += 1) {
    for (let y = HEADER_BAND_TOP; y <= HEADER_BAND_BOTTOM; y += 1) {
      if (hasInk(canvas, x, y)) return x;
    }
  }
  throw new Error('The header band holds no label to the right of the middle of the page.');
}

/** The number of pixels that differ between two canvases inside the header band. */
function bandDifferences(a: Canvas, b: Canvas, fromX: number): number {
  let differences = 0;
  for (let y = HEADER_BAND_TOP; y <= HEADER_BAND_BOTTOM; y += 1) {
    for (let x = fromX; x < a.width; x += 1) {
      const left = getPixel(a, x, y);
      const right = getPixel(b, x, y);
      if (left.r !== right.r || left.g !== right.g || left.b !== right.b || left.a !== right.a) {
        differences += 1;
      }
    }
  }
  return differences;
}

describe('renderWorksheetPage', () => {
  it('renders an A4 page at 794 by 1123', async () => {
    const canvas = await renderWorksheetPage(request());
    expect(canvas.width).toBe(794);
    expect(canvas.height).toBe(1123);
  });

  it('doubles the dimensions at scale 2', async () => {
    const canvas = await renderWorksheetPage(request({ scale: 2 }));
    expect(canvas.width).toBe(1588);
    expect(canvas.height).toBe(2246);
  });
});

describe('computePageLayout', () => {
  it('lays out the rows the site prints', () => {
    const grid = computePageLayout(request());
    expect(grid.cols).toBe(8);
    expect(grid.rows).toBe(11); // cellsPerPage('A4') is 88, in 8 columns

    const lined = computePageLayout(request({ cellStyle: 'pen-lined' }));
    expect(lined.rows).toBe(24); // linesPerPage('A4')

    const fourLine = computePageLayout(request({ cellStyle: 'pen-english' }));
    expect(fourLine.rows).toBe(16); // fourLineRowsPerPage('A4')
  });
});

describe('pageCellCount', () => {
  it('counts the cells that fit on one page', () => {
    // The grid: 88 cells on an A4 sheet (8 columns by 11 rows).
    expect(pageCellCount('pen-square', 'A4')).toBe(88);
    // The lined paper: 24 rows, one cell per row.
    expect(pageCellCount('pen-lined', 'A4')).toBe(24);
    // The four-line paper: 16 rows, one cell per row.
    expect(pageCellCount('pen-english', 'A4')).toBe(16);
    // The big brush cells: 12 of them.
    expect(pageCellCount('brush-square', 'brush-12')).toBe(12);
  });
});

describe('pageCount', () => {
  it('counts the pages the content needs', () => {
    // The grid: 88 characters to a page.
    expect(pageCount('pen-square', 'A4', 4)).toBe(1);
    expect(pageCount('pen-square', 'A4', 88)).toBe(1);
    expect(pageCount('pen-square', 'A4', 89)).toBe(2);
    // The lined paper is blank ruled paper — no character is drawn on it.
    expect(pageCount('pen-lined', 'A4', 4)).toBe(1);
    // The four-line layout returns exactly one page of rows.
    expect(pageCount('pen-english', 'A4', 4)).toBe(1);
  });
});

describe('the grid cell', () => {
  it('draws the grid border and the guides at the viewBox positions', async () => {
    const canvas = await emptyGridPage();
    // The frame of the first cell is `rect(2, 2, 96, 96)` of a 100-unit viewBox
    // in a 70 px cell, so one unit is 0.7 px and the frame starts 1.4 px
    // inside the cell.
    expect(getPixel(canvas, INTERIOR_X, FRAME_TOP_Y).r).toBeLessThan(128);
    // The vertical guide is `line(50, 2 → 50, 98)`, half a pixel wide, so it
    // is much fainter than the frame.
    const verticalGuide = getPixel(canvas, VERTICAL_GUIDE_X, INTERIOR_Y).r;
    expect(verticalGuide).toBeLessThan(255);
    expect(verticalGuide).toBeGreaterThanOrEqual(128);
    // The horizontal guide is `line(2, 50 → 98, 50)`, on the row 146.
    const horizontalGuide = getPixel(canvas, INTERIOR_X, HORIZONTAL_GUIDE_Y).r;
    expect(horizontalGuide).toBeLessThan(255);
    expect(horizontalGuide).toBeGreaterThanOrEqual(128);
    // The guides are the only ink inside the cell: the rest of the interior
    // is blank paper, and the centre carries no frame-coloured ink.
    expect(getPixel(canvas, INTERIOR_X, INTERIOR_Y).r).toBe(255);
    expect(getPixel(canvas, VERTICAL_GUIDE_X, HORIZONTAL_GUIDE_Y).r).toBeGreaterThanOrEqual(128);
  });

  it('draws all four sides of the grid cell border', async () => {
    const canvas = await emptyGridPage();
    // The left edge is the side that used to break: a frame drawn as one ring
    // that walks the outer rectangle and then the inner one is joined by two
    // bridges, and those bridges cross each other. The even-odd rule then sees
    // four crossings on the left instead of two and cuts the left edge into
    // slivers, so the left side has to be asserted on its own — the other
    // three sides were already right.
    expect(getPixel(canvas, FRAME_LEFT_X, INTERIOR_Y).r).toBeLessThan(128);
    expect(getPixel(canvas, FRAME_RIGHT_X, INTERIOR_Y).r).toBeLessThan(128);
    expect(getPixel(canvas, INTERIOR_X, FRAME_TOP_Y).r).toBeLessThan(128);
    expect(getPixel(canvas, INTERIOR_X, FRAME_BOTTOM_Y).r).toBeLessThan(128);
    // The frame is drawn with the #555 border colour, not with the lighter
    // guide colour.
    expect(getPixel(canvas, FRAME_LEFT_X, INTERIOR_Y).r).toBeLessThan(
      getPixel(canvas, VERTICAL_GUIDE_X, INTERIOR_Y).r,
    );
    expect(getPixel(canvas, INTERIOR_X, FRAME_TOP_Y).r).toBeLessThan(
      getPixel(canvas, INTERIOR_X, HORIZONTAL_GUIDE_Y).r,
    );
    // The four sides are the frame itself and nothing else: the paper right
    // outside the frame is blank.
    expect(getPixel(canvas, FRAME_LEFT_X, INTERIOR_Y).r).toBeLessThan(
      getPixel(canvas, FRAME_LEFT_X - 1, INTERIOR_Y).r,
    );
    expect(getPixel(canvas, FRAME_LEFT_X - 1, INTERIOR_Y).r).toBeGreaterThanOrEqual(128);
  });

  it('draws a red contour around a trace character', async () => {
    const canvas = await renderWorksheetPage(
      request({
        cellStyle: 'brush-trace-square',
        cells: generateLayout(['永'], 'brush-trace-square', 'A4'),
      }),
    );
    // The scanned box is the interior of the first cell, without the frame:
    // the character is filled with #ddd and outlined with a 1.5 px #c0392b
    // contour.
    const box = { left: 58, top: 113, right: 122, bottom: 178 };
    // The two counts are the point: a page that drew the contour but no fill
    // would fail the second one, and the other way round the first.
    expect(countPixelsNear(canvas, box, TRACE_STROKE_COLOUR, 8)).toBeGreaterThan(0);
    expect(countPixelsNear(canvas, box, TRACE_FILL_COLOUR, 8)).toBeGreaterThan(0);
  });
});

describe('the header band', () => {
  it('keeps a long title clear of the label on the right', async () => {
    // Two pages that differ in nothing but the title: the short one holds the
    // label alone on the right, the long one holds a title long enough to
    // reach it.
    const short = await renderWorksheetPage(request({ title: '测试' }));
    const long = await renderWorksheetPage(request({ title: '天地玄黄'.repeat(10) }));
    const labelLeft = findLabelLeft(short);
    // The label sits right of the middle of the page, so the boundary found
    // here is the label and not the title.
    expect(labelLeft).toBeGreaterThan(short.width / 2);
    // The long title is drawn — the two bands are not the same page.
    expect(bandDifferences(short, long, 0)).toBeGreaterThan(0);
    // ...but not one pixel of it reaches the label.
    expect(bandDifferences(short, long, labelLeft)).toBe(0);
  });
});
