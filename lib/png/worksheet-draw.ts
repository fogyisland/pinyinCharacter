/**
 * The worksheet painter — everything on the sheet except the header band and
 * the footer.
 *
 * It paints the rows of a page: the blank ruled paper, the four-line paper and
 * the grid cells with their frames, guides and characters. It also owns the
 * typography of the sheet — the em size of every text role and the colour of
 * every stroke — so the header band and the footer draw their text through
 * the same functions the rows do.
 *
 * It loads no font and reads no file: the `FontSet` is handed in by the
 * caller, so this module never touches `node:fs` and a `'use client'` file
 * that imports it still builds. Only `worksheet-page.ts` loads the fonts.
 *
 * The layout it paints on is described by `PageLayout`, in CSS px; the canvas
 * is in device px and every drawing call multiplies by `scale` on the way in.
 */

import { parseColor, type Color, type Polygon } from './geometry';
import { fillPolygon, strokeLine, strokeOutline, type Canvas } from './raster';
import type { FontSet } from './glyph';
import { getIsTrace, getPresentation, type Cell } from '../worksheet-types';
import type { PageLayout, WorksheetPageRequest } from './worksheet-page';

/** The smallest gap between the title and the right-aligned label of the band. */
export const HEADER_LABEL_GAP = 12;
/** The em sizes of the three text roles on the page. */
export const TITLE_SIZE = 20;
export const LABEL_SIZE = 12;
export const FOOTER_SIZE = 9;
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

export const COLOR_TITLE = parseColor('#3a2a14');
export const COLOR_LABEL = parseColor('#5a4530');
export const COLOR_HEADER_RULE = parseColor('#3a2a1433');
export const COLOR_FOOTER_RULE = parseColor('#3a2a141a');
export const COLOR_FOOTER_TEXT = parseColor('#999');
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
 * Draws the rows of the requested page, in the style the cell style asks for.
 *
 * `perPage` is the number of cells one page holds — the page module counts
 * them, because the count is a property of the page and not of the painter.
 */
export function drawRows(
  canvas: Canvas,
  request: WorksheetPageRequest,
  layout: PageLayout,
  fontSet: FontSet,
  scale: number,
  perPage: number,
): void {
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
export function drawText(
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
export function measure(fontSet: FontSet, text: string, size: number): number {
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
export function baselineOffset(fontSet: FontSet, text: string, size: number): number {
  const first = Array.from(text)[0];
  const font = first ? fontSet.fonts.find((candidate) => candidate.hasGlyph(first)) : undefined;
  if (!font) return 0;
  return ((font.ascentEm + font.descentEm) / 2) * size;
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
