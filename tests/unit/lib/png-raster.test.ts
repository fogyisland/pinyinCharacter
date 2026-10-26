import { describe, it, expect } from 'vitest';
import {
  createCanvas,
  fillPolygon,
  fillRect,
  getPixel,
  strokeLine,
  strokeOutline,
  type Point,
  type Polygon,
} from '@/lib/png/raster';
import { flattenBezierCurve, flattenQuadCurve, parseColor } from '@/lib/png/geometry';

describe('parseColor', () => {
  it('parses a short hex colour', () => {
    expect(parseColor('#555')).toEqual({ r: 0x55, g: 0x55, b: 0x55, a: 255 });
    expect(parseColor('#1d4ed8')).toEqual({ r: 0x1d, g: 0x4e, b: 0xd8, a: 255 });
  });

  it('parses an eight-digit hex colour with alpha', () => {
    expect(parseColor('#3a2a1433')).toEqual({ r: 0x3a, g: 0x2a, b: 0x14, a: 0x33 });
  });

  it('rejects a four-digit hex colour', () => {
    expect(() => parseColor('#1d4e')).toThrow(/3, 6 or 8/);
    expect(() => parseColor('#1d4e5')).toThrow(/3, 6 or 8/);
    // Three digits are still the short form, so they are still legal.
    expect(parseColor('#1d4')).toEqual({ r: 0x11, g: 0xdd, b: 0x44, a: 255 });
  });
});

describe('fillRect', () => {
  it('fills a rectangle', () => {
    const canvas = createCanvas(10, 10, { r: 255, g: 255, b: 255, a: 255 });
    fillRect(canvas, 2, 2, 4, 4, { r: 0, g: 0, b: 0, a: 255 });
    expect(getPixel(canvas, 3, 3)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(getPixel(canvas, 0, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('anti-aliases the edge of a square', () => {
    const canvas = createCanvas(10, 10, { r: 255, g: 255, b: 255, a: 255 });
    fillRect(canvas, 2.5, 2.5, 4, 4, { r: 0, g: 0, b: 0, a: 255 });
    const edge = getPixel(canvas, 2, 4);
    expect(edge.r).toBeGreaterThan(0);
    expect(edge.r).toBeLessThan(255);
  });

  it('refuses a negative rectangle size', () => {
    const canvas = createCanvas(10, 10, { r: 255, g: 255, b: 255, a: 255 });
    expect(() => fillRect(canvas, 2, 2, -4, 4, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/negative/);
  });
});

describe('strokeLine', () => {
  it('strokes a line one pixel wide', () => {
    const canvas = createCanvas(10, 10, { r: 255, g: 255, b: 255, a: 255 });
    strokeLine(canvas, 2, 5, 8, 5, 1, { r: 0, g: 0, b: 0, a: 255 });
    // A 1 px line on the integer coordinate y=5 covers half of the row above
    // and half of the row below.
    expect(getPixel(canvas, 5, 4).r).toBe(128);
    expect(getPixel(canvas, 5, 5).r).toBe(128);
    expect(getPixel(canvas, 5, 6).r).toBe(255);
  });
});

describe('strokeOutline', () => {
  it('outlines a rectangle with the same value on the edge and at the corner', () => {
    const canvas = createCanvas(20, 20, { r: 255, g: 255, b: 255, a: 255 });
    strokeOutline(
      canvas,
      [
        [
          { x: 4, y: 4 },
          { x: 14, y: 4 },
          { x: 14, y: 14 },
          { x: 4, y: 14 },
        ],
      ],
      1,
      { r: 0, g: 0, b: 0, a: 255 },
    );
    // An edge pixel is half covered by the line: 128.
    // A corner pixel is half covered by the horizontal edge and half by the
    // vertical one, so 75% of it is covered: 64.
    expect(getPixel(canvas, 8, 4).r).toBe(128);
    expect(getPixel(canvas, 4, 4).r).toBe(64);
  });

  it('rejects a flat list of points instead of drawing nothing', () => {
    const canvas = createCanvas(20, 20, { r: 255, g: 255, b: 255, a: 255 });
    const flat = [{ x: 4, y: 4 }, { x: 14, y: 4 }] as unknown as Polygon[];
    expect(() => strokeOutline(canvas, flat, 1, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/polygon/);
  });
});

describe('curve flattening', () => {
  it('flattens a quadratic curve into segments', () => {
    const points = flattenQuadCurve({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 8);
    expect(points).toHaveLength(8); // 8 segments = 8 points (no start point, with the end point)
    expect(points[7]).toEqual({ x: 10, y: 0 }); // the end point is included
    expect(points[0]).not.toEqual({ x: 0, y: 0 }); // the start is not (the caller already has it)
  });

  it('flattens a bezier curve into segments', () => {
    const points = flattenBezierCurve(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      8,
    );
    expect(points).toHaveLength(8);
    expect(points[7]).toEqual({ x: 10, y: 0 });
  });
});

/**
 * The textbook crossing-number test.
 *
 * This is the reference the filler has to agree with — an independent
 * implementation of the same rule, not a restatement of the filler.
 */
function pointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y === b.y > point.y) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/**
 * A square with a square hole, traced as ONE ring.
 *
 * The outer square and the inner square are wound the SAME way, and the
 * seam along the top-left corner is walked out and back. Under the even-odd
 * rule the hole stays empty; under the non-zero rule the two rings would
 * add up and the middle would be filled. This is the polygon that tells
 * the two rules apart.
 *
 * Every coordinate is a HALF-INTEGER on purpose. An edge on a whole
 * number would run along a pixel boundary, and the pixels straddling it
 * would be exactly half covered — the reference samples a point, the
 * rasteriser averages an area, and the two answers would disagree there
 * for no good reason. With half-integer coordinates every edge cuts a
 * pixel cleanly in half and no pixel *corner* ever sits on an edge.
 */
const DONUT: Polygon = [
  { x: 1.5, y: 1.5 }, { x: 19.5, y: 1.5 }, { x: 19.5, y: 19.5 }, { x: 1.5, y: 19.5 },
  { x: 1.5, y: 5.5 }, { x: 5.5, y: 5.5 },
  { x: 15.5, y: 5.5 }, { x: 15.5, y: 15.5 }, { x: 5.5, y: 15.5 }, { x: 5.5, y: 5.5 },
  { x: 1.5, y: 5.5 }, { x: 1.5, y: 1.5 },
];

describe('fillPolygon', () => {
  it('leaves the hole of a self-overlapping polygon empty (even-odd rule)', () => {
    const canvas = createCanvas(21, 21, { r: 255, g: 255, b: 255, a: 255 });
    fillPolygon(canvas, DONUT, { r: 0, g: 0, b: 0, a: 255 });
    // The hole: the middle of the inner square.
    expect(getPixel(canvas, 10, 10)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    // The ring: between the two squares.
    expect(getPixel(canvas, 3, 3)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it('agrees with a point-in-polygon test on every unambiguous pixel', () => {
    const canvas = createCanvas(21, 21, { r: 255, g: 255, b: 255, a: 255 });
    fillPolygon(canvas, DONUT, { r: 0, g: 0, b: 0, a: 255 });
    const mismatches: string[] = [];
    let covered = 0;
    let uncovered = 0;
    for (let y = 0; y < 21; y += 1) {
      for (let x = 0; x < 21; x += 1) {
        const red = getPixel(canvas, x, y).r;
        // A pixel on the boundary is only partly covered. The reference asks
        // "is the centre inside?", the rasteriser asks "how much of the area
        // is inside?" — on that one-pixel band the two legitimately differ,
        // so those pixels are skipped. Every other pixel must agree.
        if (red > 8 && red < 247) continue;
        const expected = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, DONUT);
        if (expected) covered += 1;
        else uncovered += 1;
        if (expected !== red <= 8) mismatches.push(`(${x},${y})`);
      }
    }
    // The comparison has to have actually run, on both sides.
    expect(covered).toBeGreaterThan(50);
    expect(uncovered).toBeGreaterThan(50);
    expect(mismatches).toEqual([]);
  });

  it('covers exactly the area of the polygon', () => {
    const canvas = createCanvas(21, 21, { r: 255, g: 255, b: 255, a: 255 });
    fillPolygon(canvas, DONUT, { r: 0, g: 0, b: 0, a: 255 });
    // The outer square is 18x18 and the hole is 10x10, so the filled area is
    // 324 - 100 = 224. A non-zero winding would fill the hole as well and
    // come out at 324; a clipped or doubled fill comes out at something else
    // entirely. The window is +/- 1 because the coverage is quantised to 1/255
    // per pixel, and the ~300 pixels of the shape can each be off by half a
    // step.
    let area = 0;
    for (let y = 0; y < 21; y += 1) {
      for (let x = 0; x < 21; x += 1) {
        area += (255 - getPixel(canvas, x, y).r) / 255;
      }
    }
    expect(area).toBeGreaterThan(223);
    expect(area).toBeLessThan(225);
  });
});
