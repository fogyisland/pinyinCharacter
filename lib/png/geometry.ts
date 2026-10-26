/**
 * Geometry primitives for the worksheet rasteriser.
 *
 * Pure maths, no canvas and no I/O: the rasteriser in `raster.ts` builds on
 * these types and the PNG encoder in `encode.ts` only has to serialise the
 * result. Keeping the maths separate from the pixels means the crossing
 * rule can be tested against an independent implementation of the same rule.
 */

/** A point in canvas space. The origin is the top-left pixel corner. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A closed ring of points.
 *
 * The ring is implicitly closed: the last point connects back to the first.
 * The rasteriser fills it with the even-odd rule, so a ring that walks out
 * and back over itself leaves a hole instead of filling it.
 */
export type Polygon = Point[];

/** An axis-aligned rectangle, in canvas space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A straight (non-premultiplied) 8-bit colour.
 *
 * `a` is the opacity of the colour itself, 0 (transparent) to 255 (opaque);
 * the anti-aliased coverage of a shape multiplies it at draw time.
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Parses `#rgb`, `#rrggbb` or `#rrggbbaa` into a colour.
 *
 * The eight-digit form carries the alpha as a raw byte, exactly like CSS:
 * `#3a2a1433` is alpha `0x33`, not a 20 % opacity. No sRGB linearisation is
 * applied — the worksheet is printed, not lit.
 *
 * @param alpha Overrides the alpha parsed from the string, when given.
 * @throws If the string is not a supported hex colour, or `alpha` is out of range.
 */
export function parseColor(hex: string, alpha?: number): Color {
  const trimmed = hex.trim();
  if (!trimmed.startsWith('#')) {
    throw new Error(`Invalid colour "${hex}": it must start with "#".`);
  }
  const digits = trimmed.slice(1);
  if (!HEX_PATTERN.test(digits)) {
    throw new Error(`Invalid colour "${hex}": "${digits}" is not hexadecimal.`);
  }
  const parsed = parseHexDigits(digits, hex);
  const resolvedAlpha = alpha === undefined ? parsed.a : assertAlpha(alpha, hex);
  return { r: parsed.r, g: parsed.g, b: parsed.b, a: resolvedAlpha };
}

interface ParsedChannels {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseHexDigits(digits: string, hex: string): ParsedChannels {
  if (digits.length === 3 || digits.length === 4) {
    // The short form repeats each digit: `#5` means `#55`.
    const expanded = digits.split('').map((digit) => digit + digit).join('');
    return parseHexDigits(expanded, hex);
  }
  if (digits.length === 6 || digits.length === 8) {
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255,
    };
  }
  throw new Error(`Invalid colour "${hex}": expected 3, 4, 6 or 8 hex digits, got ${digits.length}.`);
}

function assertAlpha(alpha: number, hex: string): number {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 255) {
    throw new Error(`Invalid alpha ${alpha} for colour "${hex}": it must be between 0 and 255.`);
  }
  return Math.round(alpha);
}

/**
 * Flattens a quadratic Bézier into a polyline.
 *
 * The start point is *not* repeated in the result — the caller already has
 * it — but the end point is, so the returned points can be appended to the
 * incoming polyline directly.
 */
export function flattenQuadCurve(p0: Point, c: Point, p1: Point, segments = 8): Point[] {
  const count = assertSegments(segments);
  const points: Point[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    const rest = 1 - t;
    points.push({
      x: rest * rest * p0.x + 2 * rest * t * c.x + t * t * p1.x,
      y: rest * rest * p0.y + 2 * rest * t * c.y + t * t * p1.y,
    });
  }
  return points;
}

/**
 * Flattens a cubic Bézier into a polyline.
 *
 * Same convention as `flattenQuadCurve`: the end point is included, the
 * start point is not.
 */
export function flattenBezierCurve(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  segments = 8,
): Point[] {
  const count = assertSegments(segments);
  const points: Point[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    const rest = 1 - t;
    points.push({
      x: rest ** 3 * p0.x + 3 * rest ** 2 * t * c1.x + 3 * rest * t ** 2 * c2.x + t ** 3 * p1.x,
      y: rest ** 3 * p0.y + 3 * rest ** 2 * t * c1.y + 3 * rest * t ** 2 * c2.y + t ** 3 * p1.y,
    });
  }
  return points;
}

function assertSegments(segments: number): number {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error(`Invalid segment count ${segments}: it must be a positive integer.`);
  }
  return segments;
}
