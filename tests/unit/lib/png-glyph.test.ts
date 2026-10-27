import { describe, expect, it } from 'vitest';
import { findMissingGlyphs, fontFileFor, loadFontSet } from '@/lib/png/glyph';
import { createCanvas, fillPolygon, getPixel } from '@/lib/png/raster';
import type { Polygon } from '@/lib/png/geometry';

/** Renders rings on a white canvas and returns the canvas. */
function renderPolygons(polygons: Polygon[], width: number, height: number) {
  const canvas = createCanvas(width, height);
  for (const polygon of polygons) {
    fillPolygon(canvas, polygon, { r: 0, g: 0, b: 0, a: 255 });
  }
  return canvas;
}

describe('fontFileFor', () => {
  it('maps every font family to a woff2 file or null', () => {
    expect(fontFileFor('wenkai-gb')).toBe('LXGWWenKaiGB-Regular.woff2');
    expect(fontFileFor('ma-shan-zheng')).toBe('ma-shan-zheng.woff2');
    expect(fontFileFor('song')).toBeNull();
    expect(fontFileFor('kai')).toBeNull();
    expect(fontFileFor('hei')).toBeNull();
  });
});

describe('outline', () => {
  it('draws a character above the baseline', async () => {
    const fonts = await loadFontSet('wenkai-gb');
    const { polygons } = fonts.outline('一', 70, 0, 100);
    expect(polygons.length).toBeGreaterThan(0);
    const ys = polygons.flat().map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(60);
    expect(Math.max(...ys)).toBeLessThan(100);
  });

  it('does not mirror a character with strokes above and below the baseline', async () => {
    const fonts = await loadFontSet('wenkai-gb');
    const { polygons } = fonts.outline('永', 70, 0, 100);
    const ys = polygons.flat().map((p) => p.y);
    // Measured (70 px, baseline 100): 永's ink runs from y 44.0 to 106.7 —
    // the top half is above the baseline and the last stroke reaches 6.7 px
    // below it. A flipped y would put the whole run between 93 and 157.
    expect(Math.min(...ys)).toBeLessThan(60);
    expect(Math.max(...ys)).toBeGreaterThan(100);
  });

  it('advances the pen by the glyph advance', async () => {
    const fonts = await loadFontSet('wenkai-gb');
    const { advance } = fonts.outline('一一', 70, 0, 100);
    // 霞鹜文楷 GB is a full-width font: one glyph is one em.
    expect(advance).toBeCloseTo(140, 1);
  });

  it('draws a tofu box for a character no font has', async () => {
    const fonts = await loadFontSet('wenkai-gb');
    expect(fonts.missingGlyphs).toEqual([]);
    const rare = await loadFontSet('wenkai-gb');
    const out = rare.outline('\u{20000}', 70, 0, 100);
    expect(rare.missingGlyphs).toContain('\u{20000}');
    expect(out.polygons.length).toBeGreaterThan(0);
  });

  it('draws all four sides of the tofu box', async () => {
    const fonts = await loadFontSet('wenkai-gb');
    const { polygons } = fonts.outline('\u{20000}', 70, 0, 100);
    const canvas = renderPolygons(polygons, 60, 120);
    // The box is 42 × 49 px at (0, 51)–(42, 100) with a 1.4 px frame.
    // The frame is one ring with a hole, and a ring that walks the outer and
    // the inner rectangle with two different bridges breaks its left edge
    // into slivers under the even-odd rule — so every side is asserted.
    expect(getPixel(canvas, 0, 75).r).toBeLessThan(128); // left
    expect(getPixel(canvas, 41, 75).r).toBeLessThan(128); // right
    expect(getPixel(canvas, 20, 51).r).toBeLessThan(128); // top
    expect(getPixel(canvas, 20, 99).r).toBeLessThan(128); // bottom
    expect(getPixel(canvas, 20, 75).r).toBe(255); // the hole stays empty
  });
});

describe('findMissingGlyphs', () => {
  it('lists the characters no font in the chain has', () => {
    expect(findMissingGlyphs('一永', 'wenkai-gb')).toEqual([]);
    const rare = findMissingGlyphs('一\u{20000}', 'wenkai-gb');
    expect(rare).toContain('\u{20000}');
    expect(rare).not.toContain('一');
    // The same character twice is reported once.
    expect(findMissingGlyphs('\u{20000}\u{20000}', 'wenkai-gb')).toEqual(['\u{20000}']);
  });

  it('reports a real missing character inside the BMP', () => {
    // 丂 (U+4E02) is in none of the three fonts of the chain.
    expect(findMissingGlyphs('丂', 'wenkai-gb')).toEqual(['丂']);
  });
});

describe('loadFontSet', () => {
  it('caches the font objects by file name', async () => {
    const first = await loadFontSet('wenkai-gb');
    const second = await loadFontSet('wenkai-gb');
    expect(second.fonts[0]).toBe(first.fonts[0]);
  });

  it('does not share the missing-glyph list between calls', async () => {
    const first = await loadFontSet('wenkai-gb');
    first.outline('\u{20000}', 70, 0, 100);
    expect(first.missingGlyphs).toContain('\u{20000}');
    const second = await loadFontSet('wenkai-gb');
    expect(second.missingGlyphs).toEqual([]);
  });
});
