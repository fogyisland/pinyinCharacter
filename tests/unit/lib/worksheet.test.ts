import { describe, it, expect } from 'vitest';
import { generateLayout, validateWorksheetInput } from '@/lib/worksheet';

describe('worksheet pure helpers', () => {
  describe('generateLayout', () => {
    it('returns one cell per char in order', () => {
      const cells = generateLayout(['你', '好', '世', '界'], 'brush-cross');
      expect(cells).toEqual([
        { char: '你', style: 'brush-cross', index: 0 },
        { char: '好', style: 'brush-cross', index: 1 },
        { char: '世', style: 'brush-cross', index: 2 },
        { char: '界', style: 'brush-cross', index: 3 },
      ]);
    });

    it('returns empty array for empty content', () => {
      expect(generateLayout([], 'pen-square')).toEqual([]);
    });

    it('preserves duplicates', () => {
      const cells = generateLayout(['你', '你', '你'], 'pen-square');
      expect(cells).toHaveLength(3);
      expect(cells.every((c) => c.char === '你')).toBe(true);
    });

    it('passes through the style', () => {
      const brush = generateLayout(['你'], 'brush-cross');
      const square = generateLayout(['你'], 'pen-square');
      expect(brush[0]!.style).toBe('brush-cross');
      expect(square[0]!.style).toBe('pen-square');
    });
  });

  describe('validateWorksheetInput', () => {
    it('accepts a valid input', () => {
      const result = validateWorksheetInput({
        title: 'My worksheet',
        content: ['你', '好'],
        cellStyle: 'brush-cross',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty title', () => {
      const result = validateWorksheetInput({ title: '', content: ['你'], cellStyle: 'brush-cross' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title/i);
    });

    it('rejects title > 80 chars', () => {
      const result = validateWorksheetInput({
        title: 'a'.repeat(81),
        content: ['你'],
        cellStyle: 'brush-cross',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects empty content', () => {
      const result = validateWorksheetInput({ title: 't', content: [], cellStyle: 'brush-cross' });
      expect(result.ok).toBe(false);
    });

    it('rejects content > 500', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: Array(501).fill('你'),
        cellStyle: 'brush-cross',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects non-CJK char in content', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: ['你', 'a'],
        cellStyle: 'brush-cross',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid cellStyle', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: ['你'],
        cellStyle: 'invalid' as any,
      });
      expect(result.ok).toBe(false);
    });

    it('accepts cellStyle="pen-cross"', () => {
      const result = validateWorksheetInput({
        title: 'My worksheet',
        content: ['你', '好'],
        cellStyle: 'pen-cross',
      });
      expect(result).toEqual({
        ok: true,
        data: { title: 'My worksheet', content: ['你', '好'], cellStyle: 'pen-cross', paperSize: 'A4' },
      });
    });

    it('rejects cellStyle="nonsense"', () => {
      const result = validateWorksheetInput({
        title: 'My worksheet',
        content: ['你', '好'],
        cellStyle: 'nonsense',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('cellStyle must be one of: brush-square, brush-cross, pen-square, pen-cross, brush-trace-square, brush-trace-cross');
      }
    });
  });
});
