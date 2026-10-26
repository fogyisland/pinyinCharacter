/**
 * A small anti-aliased software rasteriser.
 *
 * Everything the worksheet needs is reduced to "fill a polygon": the
 * rectangle, the grid line and the outline stroke all end up in
 * `fillPolygon`, so there is exactly one anti-aliasing rule in the codebase
 * and no shape can disagree with another at the edges.
 *
 * The canvas is a plain RGBA8 buffer, top-left origin, no dependencies.
 */

import { type Color, type Polygon } from './geometry';

export type { Color, Point, Polygon, Rect } from './geometry';

/** An RGBA8 image buffer. Four bytes per pixel, row major, top-left origin. */
export interface Canvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * How many sub-scanlines each pixel row is sampled with.
 *
 * Four is enough to keep a half-pixel edge visibly smooth without making
 * the fill quadratic in the polygon size; the coverage of a row is the
 * average of its four samples.
 */
const SUBSCANLINES_PER_ROW = 4;

/** The paper colour a canvas starts as: opaque white. */
const WHITE: Color = { r: 255, g: 255, b: 255, a: 255 };

/**
 * Creates a canvas filled with a single colour.
 *
 * The default fill is opaque white: the PNG needs an alpha channel, but the
 * canvas itself is opaque — the translucency of a worksheet lives in the
 * pixels that are drawn on it, not in the background.
 */
export function createCanvas(width: number, height: number, fill: Color = WHITE): Canvas {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(
      `Invalid canvas size ${width}x${height}: both dimensions must be positive integers.`,
    );
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = fill.r;
    data[offset + 1] = fill.g;
    data[offset + 2] = fill.b;
    data[offset + 3] = fill.a;
  }
  return { width, height, data };
}

/**
 * Fills an axis-aligned rectangle.
 *
 * The rectangle is turned into a polygon and handed to `fillPolygon`, so a
 * rectangle that starts on a half pixel gets the same anti-aliased edge as
 * any other shape. There is deliberately no fast path for whole-pixel
 * rectangles: two fill rules in one rasteriser is how edges start to
 * disagree with each other.
 *
 * A zero size draws nothing; a negative size is a caller bug and throws,
 * because a silently swallowed negative width hides a flipped coordinate
 * system.
 */
export function fillRect(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Color,
): void {
  if (width < 0 || height < 0) {
    throw new Error(`fillRect: the size must not be negative, got ${width} by ${height}.`);
  }
  if (width === 0 || height === 0) return;
  fillPolygon(
    canvas,
    [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    color,
  );
}

/**
 * Fills a polygon with an anti-aliased edge.
 *
 * The rule is the even-odd one: a point is inside the polygon when a ray
 * cast from it crosses the outline an odd number of times. A ring that walks
 * out and back over itself therefore leaves a hole, which is what the
 * worksheet frames and the 田字格 need.
 *
 * The coverage of a pixel is measured, not sampled: every pixel row is cut
 * into four sub-scanlines, and the horizontal overlap of a pixel with a
 * covered span contributes a quarter of itself. The coverage of the whole
 * polygon is accumulated first and composited once, so that the four samples
 * of one edge do not darken each other.
 */
export function fillPolygon(canvas: Canvas, polygon: Polygon, color: Color): void {
  if (polygon.length < 3) return;
  assertFinitePolygon(polygon);
  const bounds = polygonBounds(polygon);
  const firstRow = Math.max(0, Math.floor(bounds.minY));
  const lastRow = Math.min(canvas.height - 1, Math.ceil(bounds.maxY) - 1);
  if (firstRow > lastRow) return;

  const coverage = new Float32Array(canvas.width);
  const weight = 1 / SUBSCANLINES_PER_ROW;
  for (let y = firstRow; y <= lastRow; y += 1) {
    coverage.fill(0);
    for (let sample = 0; sample < SUBSCANLINES_PER_ROW; sample += 1) {
      const scanY = y + (sample + 0.5) / SUBSCANLINES_PER_ROW;
      for (const [x0, x1] of scanlineSpans(polygon, scanY)) {
        addSpanCoverage(coverage, x0, x1, canvas.width, weight);
      }
    }
    compositeRow(canvas, y, coverage, color);
  }
}

/**
 * Draws a straight line of the given width.
 *
 * The line is a rectangle around the segment: the two ends are cut square,
 * which is what the grid lines and the borders of a character cell want.
 */
export function strokeLine(
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: Color,
): void {
  if (!(width > 0)) return;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    // A zero-length segment is a dot; square it off so it still has area.
    const half = width / 2;
    fillPolygon(
      canvas,
      [
        { x: x1 - half, y: y1 - half },
        { x: x1 + half, y: y1 - half },
        { x: x1 + half, y: y1 + half },
        { x: x1 - half, y: y1 + half },
      ],
      color,
    );
    return;
  }
  const offsetX = (-dy / length) * (width / 2);
  const offsetY = (dx / length) * (width / 2);
  fillPolygon(
    canvas,
    [
      { x: x1 + offsetX, y: y1 + offsetY },
      { x: x2 + offsetX, y: y2 + offsetY },
      { x: x2 - offsetX, y: y2 - offsetY },
      { x: x1 - offsetX, y: y1 - offsetY },
    ],
    color,
  );
}

/**
 * Strokes the outline of every polygon.
 *
 * Each edge is extended by half the stroke width at both ends, so the
 * corners of a frame overlap instead of leaving a notch.
 *
 * @param polygons A list of rings. A single ring has to be wrapped in an
 * array — passing a flat list of points would otherwise draw nothing at all,
 * so it is rejected instead of silently ignored.
 */
export function strokeOutline(canvas: Canvas, polygons: Polygon[], width: number, color: Color): void {
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) {
      throw new Error(
        'strokeOutline: every entry must be a polygon (an array of points). ' +
          'A single ring has to be wrapped: strokeOutline(canvas, [ring], width, colour).',
      );
    }
    for (let i = 0; i < polygon.length; i += 1) {
      const from = polygon[i];
      const to = polygon[(i + 1) % polygon.length];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const extension = (width / 2) / length;
      strokeLine(
        canvas,
        from.x - dx * extension,
        from.y - dy * extension,
        to.x + dx * extension,
        to.y + dy * extension,
        width,
        color,
      );
    }
  }
}

/**
 * Reads one pixel.
 *
 * @throws If the coordinates are outside the canvas — a silent black pixel
 * would hide a flipped coordinate system.
 */
export function getPixel(canvas: Canvas, x: number, y: number): Color {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    throw new Error(`Pixel (${x}, ${y}) is outside the ${canvas.width}x${canvas.height} canvas.`);
  }
  const offset = (y * canvas.width + x) * 4;
  return {
    r: canvas.data[offset],
    g: canvas.data[offset + 1],
    b: canvas.data[offset + 2],
    a: canvas.data[offset + 3],
  };
}

interface VerticalBounds {
  minY: number;
  maxY: number;
}

function polygonBounds(polygon: Polygon): VerticalBounds {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minY, maxY };
}

function assertFinitePolygon(polygon: Polygon): void {
  for (const point of polygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`Invalid polygon point (${point.x}, ${point.y}): coordinates must be finite.`);
    }
  }
}

/**
 * Returns the covered spans of one horizontal scan line.
 *
 * The crossings of the outline are sorted and paired up two by two, which
 * is the even-odd rule: a point between the first and the second crossing
 * is inside, a point between the second and the third is outside again.
 */
function scanlineSpans(polygon: Polygon, scanY: number): Array<[number, number]> {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const from = polygon[j];
    const to = polygon[i];
    if (from.y > scanY === to.y > scanY) continue;
    const ratio = (scanY - from.y) / (to.y - from.y);
    crossings.push(from.x + ratio * (to.x - from.x));
  }
  crossings.sort((left, right) => left - right);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    spans.push([crossings[i], crossings[i + 1]]);
  }
  return spans;
}

/**
 * Adds one covered span to the coverage row.
 *
 * The horizontal overlap of a pixel with the span is exact, so a vertical
 * edge that lands between two pixels covers them only in part.
 */
function addSpanCoverage(
  coverage: Float32Array,
  x0: number,
  x1: number,
  width: number,
  weight: number,
): void {
  if (!(x1 > x0)) return;
  const first = Math.max(0, Math.floor(x0));
  const last = Math.min(width - 1, Math.ceil(x1) - 1);
  for (let px = first; px <= last; px += 1) {
    const overlap = Math.min(x1, px + 1) - Math.max(x0, px);
    if (overlap > 0) coverage[px] += overlap * weight;
  }
}

/**
 * Composites one covered row onto the canvas with the source-over rule.
 *
 * The coverage of the whole polygon is applied in one go, so the four
 * sub-scanlines of an edge do not stack four separate semi-transparent
 * layers on top of each other.
 */
function compositeRow(canvas: Canvas, y: number, coverage: Float32Array, color: Color): void {
  const rowStart = y * canvas.width * 4;
  for (let px = 0; px < canvas.width; px += 1) {
    const raw = coverage[px];
    if (raw <= 0) continue;
    const sourceAlpha = (color.a / 255) * Math.min(1, raw);
    if (sourceAlpha <= 0) continue;
    const offset = rowStart + px * 4;
    const destinationAlpha = canvas.data[offset + 3] / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    const weight = destinationAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const source = channel === 0 ? color.r : channel === 1 ? color.g : color.b;
      const blended = source * sourceAlpha + canvas.data[offset + channel] * weight;
      canvas.data[offset + channel] = outAlpha > 0 ? blended / outAlpha : 0;
    }
    canvas.data[offset + 3] = outAlpha * 255;
  }
}
