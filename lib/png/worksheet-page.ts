/**
 * The worksheet page compositor.
 *
 * NODE ONLY — it loads the site's fonts through `lib/png/glyph.ts`, which
 * reads them from `public/fonts` with `node:fs`. A `'use client'` file that
 * imports this module fails at build time.
 *
 * The page reproduces the sheet the site prints: the same paper sizes, the
 * same 1.5 cm margins, the same header band and footer, and the same cell
 * geometry as `components/worksheet/WorksheetCell.tsx` (the grid cells) and
 * `components/worksheet/PracticePDF.tsx` (the lined and four-line rows).
 *
 * Two counts travel together and must not be confused: the **cell count** per
 * page (A4 grid: 88) is what the content is sliced by, and the **row count**
 * per page (A4 grid: 11) is what the sheet is laid out with. Dividing the
 * cell count by the row count would turn 88 characters into eight pages.
 *
 * The whole layout is in CSS px; the canvas is in device px. Every drawing
 * call multiplies by `scale` on the way in, so a sheet at scale 2 is the same
 * sheet at twice the resolution rather than a scaled-up bitmap.
 *
 * The rows of the page are painted by `./worksheet-draw.ts`; this module owns
 * the page box, the header band and the footer, and hands the rows the cell
 * count they have to fill.
 */

import { createCanvas, strokeLine, type Canvas } from './raster';
import { loadFontSet, type FontSet } from './glyph';
import { cellsPerPage } from '../worksheet-page-count';
import {
  cellStyleLabel,
  fontFamilyLabel,
  fourLineRowsPerPage,
  getPresentation,
  linedHeightPx,
  linesPerPage,
  PAPER_SIZES,
  PRACTICE_GRID_CELL_SIZE,
  type Cell,
  type CellStyle,
  type FontFamily,
  type PaperSize,
} from '../worksheet-types';
import {
  baselineOffset,
  drawRows,
  drawText,
  measure,
  COLOR_FOOTER_RULE,
  COLOR_FOOTER_TEXT,
  COLOR_HEADER_RULE,
  COLOR_LABEL,
  COLOR_TITLE,
  FOOTER_SIZE,
  HEADER_LABEL_GAP,
  LABEL_SIZE,
  TITLE_SIZE,
} from './worksheet-draw';

/** A page of the worksheet, ready to be rasterised. */
export interface WorksheetPageRequest {
  title: string;
  cells: Cell[];
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  /** The page to draw, 1-based. */
  page: number;
  /** 1 draws the page at its natural size, 2 at twice the size. */
  scale: number;
  siteHost: string;
}

/** The geometry of one page, in CSS px. */
export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  /** The side of a grid cell; the row height for the lined and four-line rows. */
  cellSize: number;
  /** The number of columns; 1 for the lined and four-line rows. */
  cols: number;
  /** The number of rows this page holds. */
  rows: number;
  /** The height of a row. */
  rowHeight: number;
  /** The gap between two rows. */
  rowGap: number;
}

/** The page box in CSS px at 96 DPI. */
const PAGE_SIZES: Record<PaperSize, [number, number]> = {
  A3: [1123, 1587],
  A4: [794, 1123],
  B5: [665, 945],
  'brush-12': [794, 1123],
  'brush-24': [794, 1123],
  'brush-28': [794, 1123],
};

/** The margin on every side — 1.5 cm at 96 DPI, the site's PDF padding. */
const MARGIN = 56;
/** The header band: 40 px tall, a 1 px rule under it, then 14 px of space. */
const HEADER_HEIGHT = 40;
const HEADER_RULE_HEIGHT = 1;
const HEADER_GAP = 14;
/** The gap between two grid cells. */
const GRID_GAP = 8;
/** The gap between two four-line rows. */
const FOUR_LINE_ROW_GAP = 16;

/**
 * The number of device pixels a page of that paper takes at that scale.
 *
 * The canvas is allocated at `round(pageWidth * scale) x round(pageHeight *
 * scale)` device pixels, so this is the size of the buffer a render is about
 * to allocate. The MCP renderer budgets against it.
 */
export function pagePixelCount(paperSize: PaperSize, scale: number): number {
  const [pageWidth, pageHeight] = PAGE_SIZES[paperSize];
  return Math.round(pageWidth * scale) * Math.round(pageHeight * scale);
}

/**
 * How many cells fit on one page.
 *
 * The grid fills a page with `cellsPerPage` cells, the lined paper with
 * `linesPerPage` rows and the four-line paper with `fourLineRowsPerPage`
 * rows. This is the number the content is sliced by.
 */
export function pageCellCount(cellStyle: CellStyle, paperSize: PaperSize): number {
  const presentation = getPresentation(cellStyle);
  if (presentation === 'four-line') return fourLineRowsPerPage(paperSize);
  if (presentation === 'lined') return linesPerPage(paperSize);
  return cellsPerPage(paperSize);
}

/**
 * How many pages the content needs.
 *
 * The lined paper is blank ruled paper — no character is drawn on it — and
 * the four-line layout returns exactly one page of rows, so both are always a
 * single page. Only the grid can spill over.
 */
export function pageCount(
  cellStyle: CellStyle,
  paperSize: PaperSize,
  contentLength: number,
): number {
  const presentation = getPresentation(cellStyle);
  if (presentation === 'lined') return 1;
  if (presentation === 'four-line') return 1;
  return Math.max(1, Math.ceil(contentLength / cellsPerPage(paperSize)));
}

/**
 * The geometry of one page.
 *
 * The row count comes from the site's own numbers, not from the geometry: the
 * sheet the site prints is the sheet the PNG has to reproduce.
 */
export function computePageLayout(request: WorksheetPageRequest): PageLayout {
  const [pageWidth, pageHeight] = PAGE_SIZES[request.paperSize];
  const presentation = getPresentation(request.cellStyle);
  const contentX = MARGIN;
  const contentY = MARGIN + HEADER_HEIGHT + HEADER_RULE_HEIGHT + HEADER_GAP;
  const contentWidth = pageWidth - MARGIN * 2;
  if (presentation === 'lined' || presentation === 'four-line') {
    const rowHeight = linedHeightPx(request.paperSize);
    const rows =
      presentation === 'lined'
        ? linesPerPage(request.paperSize)
        : fourLineRowsPerPage(request.paperSize);
    return {
      pageWidth,
      pageHeight,
      contentX,
      contentY,
      contentWidth,
      cellSize: rowHeight,
      cols: 1,
      rows,
      rowHeight,
      rowGap: presentation === 'four-line' ? FOUR_LINE_ROW_GAP : 0,
    };
  }
  const cols = paperCols(request.paperSize);
  const cellSize = PRACTICE_GRID_CELL_SIZE[request.paperSize];
  return {
    pageWidth,
    pageHeight,
    contentX,
    contentY,
    contentWidth,
    cellSize,
    cols,
    rows: cellsPerPage(request.paperSize) / cols,
    rowHeight: cellSize,
    rowGap: GRID_GAP,
  };
}

/**
 * Draws one page of a worksheet.
 *
 * The whole page is laid out in CSS px and multiplied by `scale` on the way
 * to the canvas, so a sheet at scale 2 is the same sheet at twice the
 * resolution rather than a scaled-up bitmap.
 */
export async function renderWorksheetPage(request: WorksheetPageRequest): Promise<Canvas> {
  const layout = computePageLayout(request);
  const scale = assertScale(request.scale);
  const canvas = createCanvas(
    Math.round(layout.pageWidth * scale),
    Math.round(layout.pageHeight * scale),
  );
  const fontSet = await loadFontSet(request.fontFamily);
  const perPage = pageCellCount(request.cellStyle, request.paperSize);
  drawHeader(canvas, request, layout, fontSet, scale);
  drawRows(canvas, request, layout, fontSet, scale, perPage);
  drawFooter(canvas, request, layout, fontSet, scale);
  return canvas;
}

function assertScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Invalid scale ${scale}: it must be a positive number.`);
  }
  return scale;
}

function paperCols(paperSize: PaperSize): number {
  const paper = PAPER_SIZES.find((entry) => entry.value === paperSize);
  if (!paper) throw new Error(`Unknown paper size "${paperSize}".`);
  return paper.cols;
}

/**
 * The header band: the title on the left, the cell style and the font name
 * on the right, and a rule under the band.
 */
function drawHeader(
  canvas: Canvas,
  request: WorksheetPageRequest,
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
): void {
  const bandCentre = MARGIN + HEADER_HEIGHT / 2;
  const label = `${cellStyleLabel(request.cellStyle)} · ${fontFamilyLabel(request.fontFamily)}`;
  const labelWidth = measure(fontSet, label, LABEL_SIZE);
  // The label is right-aligned on the same edge the title would run to, so
  // the title has to stop short of it — a long title is otherwise printed on
  // top of the label and the two become unreadable.
  const title = truncateTitle(
    fontSet,
    request.title,
    TITLE_SIZE,
    layout.contentWidth - labelWidth - HEADER_LABEL_GAP,
  );
  const titleBaseline = bandCentre + baselineOffset(fontSet, title, TITLE_SIZE);
  const labelBaseline = bandCentre + baselineOffset(fontSet, label, LABEL_SIZE);
  drawText(canvas, fontSet, title, TITLE_SIZE, layout.contentX, titleBaseline, COLOR_TITLE, scale);
  drawText(
    canvas,
    fontSet,
    label,
    LABEL_SIZE,
    layout.contentX + layout.contentWidth - labelWidth,
    labelBaseline,
    COLOR_LABEL,
    scale,
  );
  const ruleY = MARGIN + HEADER_HEIGHT;
  strokeLine(
    canvas,
    MARGIN * scale,
    ruleY * scale,
    (MARGIN + layout.contentWidth) * scale,
    ruleY * scale,
    HEADER_RULE_HEIGHT * scale,
    COLOR_HEADER_RULE,
  );
}

/** The footer: a rule and the site host, centred under it. */
function drawFooter(
  canvas: Canvas,
  request: WorksheetPageRequest,
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
): void {
  const textTop = layout.pageHeight - MARGIN - FOOTER_SIZE;
  const ruleY = textTop - 8;
  strokeLine(
    canvas,
    MARGIN * scale,
    ruleY * scale,
    (MARGIN + layout.contentWidth) * scale,
    ruleY * scale,
    1 * scale,
    COLOR_FOOTER_RULE,
  );
  const width = measure(fontSet, request.siteHost, FOOTER_SIZE);
  drawText(
    canvas,
    fontSet,
    request.siteHost,
    FOOTER_SIZE,
    (layout.pageWidth - width) / 2,
    textTop + FOOTER_SIZE / 2 + baselineOffset(fontSet, request.siteHost, FOOTER_SIZE),
    COLOR_FOOTER_TEXT,
    scale,
  );
}

/**
 * Cuts a title that does not fit the content width and appends an ellipsis.
 *
 * A title is a label, not a paragraph: wrapping it would need a line-breaking
 * algorithm, so the title is cut instead.
 */
function truncateTitle(fontSet: FontSet, title: string, size: number, maxWidth: number): string {
  if (measure(fontSet, title, size) <= maxWidth) return title;
  const ellipsis = '…';
  const budget = maxWidth - measure(fontSet, ellipsis, size);
  let width = 0;
  let cut = '';
  for (const char of Array.from(title)) {
    const next = width + measure(fontSet, char, size);
    if (next > budget) break;
    width = next;
    cut += char;
  }
  return cut + ellipsis;
}
