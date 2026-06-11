import { describe, it, expect } from 'vitest';
import { generateLayout, validateWorksheetInput } from '@/lib/worksheet';

describe('worksheet pure helpers', () => {
  describe('generateLayout', () => {
    it('returns one cell per char in order', () => {
      const cells = generateLayout(['你', '好', '世', '界'], 'brush');
      expect(cells).toEqual([
        { char: '你', style: 'brush', index: 0 },
        { char: '好', style: 'brush', index: 1 },
        { char: '世', style: 'brush', index: 2 },
        { char: '界', style: 'brush', index: 3 },
      ]);
    });

    it('returns empty array for empty content', () => {
      expect(generateLayout([], 'square')).toEqual([]);
    });

    it('preserves duplicates', () => {
      const cells = generateLayout(['你', '你', '你'], 'square');
      expect(cells).toHaveLength(3);
      expect(cells.every((c) => c.char === '你')).toBe(true);
    });

    it('passes through the style', () => {
      const brush = generateLayout(['你'], 'brush');
      const square = generateLayout(['你'], 'square');
      expect(brush[0]!.style).toBe('brush');
      expect(square[0]!.style).toBe('square');
    });
  });

  describe('validateWorksheetInput', () => {
    it('accepts a valid input', () => {
      const result = validateWorksheetInput({
        title: 'My worksheet',
        content: ['你', '好'],
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty title', () => {
      const result = validateWorksheetInput({ title: '', content: ['你'], cellStyle: 'brush' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title/i);
    });

    it('rejects title > 80 chars', () => {
      const result = validateWorksheetInput({
        title: 'a'.repeat(81),
        content: ['你'],
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects empty content', () => {
      const result = validateWorksheetInput({ title: 't', content: [], cellStyle: 'brush' });
      expect(result.ok).toBe(false);
    });

    it('rejects content > 500', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: Array(501).fill('你'),
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects non-CJK char in content', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: ['你', 'a'],
        cellStyle: 'brush',
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
  });
});
