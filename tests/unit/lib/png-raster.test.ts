import { describe, it, expect } from 'vitest';
import {
  createCanvas,
  fillPolygon,
  fillRect,
  getPixel,
  type Point,
  type Polygon,
} from '@/lib/png/raster';
import { parseColor } from '@/lib/png/geometry';

describe('parseColor', () => {
  it('parses a short hex colour', () => {
    expect(parseColor('#555')).toEqual({ r: 0x55, g: 0x55, b: 0x55, a: 255 });
    expect(parseColor('#1d4ed8')).toEqual({ r: 0x1d, g: 0x4e, b: 0xd8, a: 255 });
  });

  it('parses an eight-digit hex colour with alpha', () => {
    expect(parseColor('#3a2a1433')).toEqual({ r: 0x3a, g: 0x2a, b: 0x14, a: 0x33 });
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
