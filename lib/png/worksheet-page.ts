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
 */

import { parseColor, type Color, type Polygon } from './geometry';
import { createCanvas, fillPolygon, strokeLine, strokeOutline, type Canvas } from './raster';
import { loadFontSet, type FontSet } from './glyph';
import { cellsPerPage } from '../worksheet-page-count';
import {
  cellStyleLabel,
  fontFamilyLabel,
  fourLineRowsPerPage,
  getIsTrace,
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
/** The smallest gap between the title and the right-aligned label of the band. */
const HEADER_LABEL_GAP = 12;
/** The gap between two grid cells. */
const GRID_GAP = 8;
/** The gap between two four-line rows. */
const FOUR_LINE_ROW_GAP = 16;
/** The em sizes of the three text roles on the page. */
const TITLE_SIZE = 20;
const LABEL_SIZE = 12;
const FOOTER_SIZE = 9;
/** The em size of a character inside a grid cell: the full cell for a trace, 60 % otherwise. */
const TRACE_SIZE_RATIO = 1;
const NORMAL_SIZE_RATIO = 0.6;
/** The em size of the four-line text and the distance of its left edge from the row. */
const FOUR_LINE_TEXT_SIZE = 28;
const FOUR_LINE_TEXT_INSET = 8;
/** The distance between the four rules of a four-line row, as a fraction of the row height. */
const FOUR_LINE_GAP_RATIO = 12 / 38;
/** The width of the four rules of a four-line row. */
const FOUR_LINE_RULE_WIDTHS = [2, 2, 3, 2];

const COLOR_TITLE = parseColor('#3a2a14');
const COLOR_LABEL = parseColor('#5a4530');
const COLOR_HEADER_RULE = parseColor('#3a2a1433');
const COLOR_FOOTER_RULE = parseColor('#3a2a141a');
const COLOR_FOOTER_TEXT = parseColor('#999');
const COLOR_CELL_BORDER = parseColor('#555');
const COLOR_GUIDE = parseColor('#bbb');
const COLOR_CHARACTER = parseColor('#bbb');
const COLOR_TRACE_FILL = parseColor('#ddd');
const COLOR_TRACE_STROKE = parseColor('#c0392b');
const COLOR_FOUR_LINE_RULES = [
  parseColor('#1d4ed8'),
  parseColor('#d94c4c'),
  parseColor('#c0392b'),
  parseColor('#1d4ed8'),
];

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
  drawHeader(canvas, request, layout, fontSet, scale);
  drawRows(canvas, request, layout, fontSet, scale);
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

/** Draws the rows of the requested page, in the style the cell style asks for. */
function drawRows(
  canvas: Canvas,
  request: WorksheetPageRequest,
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
): void {
  const perPage = pageCellCount(request.cellStyle, request.paperSize);
  if (perPage <= 0) return;
  const cells = request.cells.slice((request.page - 1) * perPage, request.page * perPage);
  const presentation = getPresentation(request.cellStyle);
  if (presentation === 'lined') {
    drawLinedRows(canvas, layout, scale);
    return;
  }
  if (presentation === 'four-line') {
    drawFourLineRows(canvas, cells, layout, fontSet, scale);
    return;
  }
  drawGridCells(canvas, cells, request, layout, fontSet, scale);
}

/** The blank ruled paper: one rule at the bottom of every full-width row. */
function drawLinedRows(canvas: Canvas, layout: PageLayout, scale: number): void {
  for (let row = 0; row < layout.rows; row += 1) {
    const y = rowTop(layout, row) + layout.rowHeight - 0.5;
    strokeLine(
      canvas,
      layout.contentX * scale,
      y * scale,
      (layout.contentX + layout.contentWidth) * scale,
      y * scale,
      1 * scale,
      COLOR_CELL_BORDER,
    );
  }
}

/** The four-line paper: four rules per row and the row's text on the third rule. */
function drawFourLineRows(
  canvas: Canvas,
  cells: Cell[],
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
): void {
  const gap = layout.rowHeight * FOUR_LINE_GAP_RATIO;
  for (let row = 0; row < layout.rows; row += 1) {
    const top = rowTop(layout, row);
    for (let line = 0; line < FOUR_LINE_RULE_WIDTHS.length; line += 1) {
      const y = top + gap * line;
      strokeLine(
        canvas,
        layout.contentX * scale,
        y * scale,
        (layout.contentX + layout.contentWidth) * scale,
        y * scale,
        FOUR_LINE_RULE_WIDTHS[line] * scale,
        COLOR_FOUR_LINE_RULES[line],
      );
    }
    const text = cells[row]?.char ?? '';
    if (!text) continue;
    drawText(
      canvas,
      fontSet,
      text,
      FOUR_LINE_TEXT_SIZE,
      layout.contentX + FOUR_LINE_TEXT_INSET,
      top + gap * 2,
      COLOR_TRACE_FILL,
      scale,
      COLOR_TRACE_STROKE,
    );
  }
}

/** The grid cells: the frame, the guides and the character. */
function drawGridCells(
  canvas: Canvas,
  cells: Cell[],
  request: WorksheetPageRequest,
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
): void {
  const isTrace = getIsTrace(request.cellStyle);
  const isCross = getPresentation(request.cellStyle) === 'cross';
  const unit = layout.cellSize / 100;
  const fontSize = layout.cellSize * (isTrace ? TRACE_SIZE_RATIO : NORMAL_SIZE_RATIO);
  for (let index = 0; index < cells.length; index += 1) {
    const row = Math.floor(index / layout.cols);
    const col = index % layout.cols;
    const x = layout.contentX + col * (layout.cellSize + layout.rowGap);
    const y = layout.contentY + row * (layout.rowHeight + layout.rowGap);
    drawCellFrame(canvas, x, y, unit, isCross, scale);
    const char = cells[index].char;
    if (!char) continue;
    drawCellCharacter(canvas, fontSet, char, x, y, layout.cellSize, fontSize, isTrace, scale);
  }
}

/**
 * The frame of a grid cell, in the 100-unit viewBox of `WorksheetCell.tsx`.
 *
 * The border is stroked edge by edge — see `strokeRect` for why a filled
 * frame would break the left side of the cell.
 */
function drawCellFrame(
  canvas: Canvas,
  x: number,
  y: number,
  unit: number,
  isCross: boolean,
  scale: number,
): void {
  const left = x + 2 * unit;
  const top = y + 2 * unit;
  const right = x + 98 * unit;
  const bottom = y + 98 * unit;
  strokeRect(canvas, left, top, right, bottom, 1, COLOR_CELL_BORDER, scale);
  strokeLine(
    canvas,
    (x + 50 * unit) * scale,
    top * scale,
    (x + 50 * unit) * scale,
    bottom * scale,
    0.5 * scale,
    COLOR_GUIDE,
  );
  strokeLine(
    canvas,
    left * scale,
    (y + 50 * unit) * scale,
    right * scale,
    (y + 50 * unit) * scale,
    0.5 * scale,
    COLOR_GUIDE,
  );
  if (!isCross) return;
  strokeCrossDiagonals(canvas, x, y, unit, scale);
}

/**
 * The three diagonals of a cross cell (米字格).
 *
 * They are the 米 of the 米字格: the two crossing diagonals and the short
 * one along the bottom edge. The geometry is the one of `WorksheetCell.tsx`.
 */
function strokeCrossDiagonals(
  canvas: Canvas,
  x: number,
  y: number,
  unit: number,
  scale: number,
): void {
  const left = x + 2 * unit;
  const top = y + 2 * unit;
  const right = x + 98 * unit;
  const bottom = y + 98 * unit;
  strokeLine(
    canvas,
    left * scale,
    top * scale,
    right * scale,
    bottom * scale,
    0.5 * scale,
    COLOR_GUIDE,
  );
  strokeLine(
    canvas,
    right * scale,
    top * scale,
    left * scale,
    bottom * scale,
    0.5 * scale,
    COLOR_GUIDE,
  );
  strokeLine(
    canvas,
    left * scale,
    (y + 90 * unit) * scale,
    right * scale,
    bottom * scale,
    0.5 * scale,
    COLOR_GUIDE,
  );
}

/**
 * The character of a grid cell.
 *
 * The character is centred by its em box: the baseline sits below the centre
 * of the cell by half the font's ascent-descent distance, so a cell holds the
 * same part of the glyph the browser holds.
 */
function drawCellCharacter(
  canvas: Canvas,
  fontSet: FontSet,
  char: string,
  x: number,
  y: number,
  cellSize: number,
  fontSize: number,
  isTrace: boolean,
  scale: number,
): void {
  const centreX = x + cellSize / 2;
  const centreY = y + cellSize / 2;
  const baseline = centreY + baselineOffset(fontSet, char, fontSize);
  const penX = centreX - measure(fontSet, char, fontSize) / 2;
  const { polygons } = fontSet.outline(char, fontSize, penX, baseline);
  const scaled = polygons.map((polygon) => scalePolygon(polygon, scale));
  for (const polygon of scaled) {
    fillPolygon(canvas, polygon, isTrace ? COLOR_TRACE_FILL : COLOR_CHARACTER);
  }
  if (!isTrace) return;
  strokeOutline(canvas, scaled, 1.5 * scale, COLOR_TRACE_STROKE);
}

/**
 * Draws text with the font chain, optionally with an outline around it.
 *
 * `baselineY` is the real baseline, not the centre of the em box: the
 * four-line text has to sit exactly on its third rule.
 */
function drawText(
  canvas: Canvas,
  fontSet: FontSet,
  text: string,
  size: number,
  penX: number,
  baselineY: number,
  color: Color,
  scale: number,
  outline?: Color,
): void {
  if (!text) return;
  const { polygons } = fontSet.outline(text, size, penX, baselineY);
  const scaled = polygons.map((polygon) => scalePolygon(polygon, scale));
  for (const polygon of scaled) fillPolygon(canvas, polygon, color);
  if (!outline) return;
  strokeOutline(canvas, scaled, 1 * scale, outline);
}

/** The width the font chain would give `text`. */
function measure(fontSet: FontSet, text: string, size: number): number {
  if (!text) return 0;
  return fontSet.outline(text, size, 0, 0).advance;
}

/**
 * The distance from the centre of the em box to the baseline, in pixels.
 *
 * The font that will draw the character decides it: the fonts the site ships
 * do not share one set of metrics, and a fallback font with a taller em box
 * would sit lower in the cell.
 */
function baselineOffset(fontSet: FontSet, text: string, size: number): number {
  const first = Array.from(text)[0];
  const font = first ? fontSet.fonts.find((candidate) => candidate.hasGlyph(first)) : undefined;
  if (!font) return 0;
  return ((font.ascentEm + font.descentEm) / 2) * size;
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

/** The top edge of a row, in CSS px. */
function rowTop(layout: PageLayout, row: number): number {
  return layout.contentY + row * (layout.rowHeight + layout.rowGap);
}

/** Multiplies every point of a ring by the scale factor. */
function scalePolygon(polygon: Polygon, scale: number): Polygon {
  return polygon.map((point) => ({ x: point.x * scale, y: point.y * scale }));
}

/**
 * A rectangle drawn as a stroke: the width is centred on the path, like the
 * `stroke` of an SVG rectangle.
 *
 * The four edges are stroked one by one rather than filled as one ring with
 * a hole: a single ring that walks the outer rectangle and then the inner one
 * is joined by two bridges, and under the even-odd rule those bridges cut
 * the left edge into slivers. Stroking the edges separately gives every side
 * the same coverage.
 */
function strokeRect(
  canvas: Canvas,
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  color: Color,
  scale: number,
): void {
  const ring: Polygon = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  strokeOutline(canvas, [scalePolygon(ring, scale)], width * scale, color);
}
