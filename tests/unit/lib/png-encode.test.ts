import sharp from 'sharp';
import { describe, it, expect } from 'vitest';
import { createCanvas, fillRect } from '@/lib/png/raster';
import { encodePng } from '@/lib/png/encode';

describe('encodePng', () => {
  it('writes a PNG that sharp can decode', async () => {
    const canvas = createCanvas(4, 3, { r: 255, g: 255, b: 255, a: 255 });
    fillRect(canvas, 1, 1, 2, 1, { r: 0, g: 0, b: 0, a: 255 });
    const bytes = encodePng(canvas);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(4);
    expect(meta.height).toBe(3);
    expect(meta.format).toBe('png');
  });

  it('writes the pixels where they were drawn', async () => {
    const canvas = createCanvas(4, 3, { r: 255, g: 255, b: 255, a: 255 });
    fillRect(canvas, 1, 1, 2, 1, { r: 0, g: 0, b: 0, a: 255 });
    const { data } = await sharp(Buffer.from(encodePng(canvas))).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);      // The top-left corner is white.
    expect(data[(1 * 4 + 1) * 4]).toBe(0);  // The black rectangle starts at (1, 1).
  });

  it('starts with the PNG signature', () => {
    const canvas = createCanvas(1, 1);
    const bytes = encodePng(canvas);
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
