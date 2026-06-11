import { describe, it, expect } from 'vitest';
import { searchQuerySchema, saveWorksheetSchema } from '@/lib/validators';

describe('validators', () => {
  describe('searchQuerySchema', () => {
    it('accepts empty query and defaults page to 1', () => {
      const r = searchQuerySchema.parse({});
      expect(r.q).toBeUndefined();
      expect(r.page).toBe(1);
    });

    it('accepts a short q', () => {
      const r = searchQuerySchema.parse({ q: 'da', page: '3' });
      expect(r.q).toBe('da');
      expect(r.page).toBe(3);
    });

    it('rejects q > 32 chars', () => {
      expect(() => searchQuerySchema.parse({ q: 'a'.repeat(33) })).toThrow();
    });

    it('rejects page < 1', () => {
      expect(() => searchQuerySchema.parse({ page: '0' })).toThrow();
    });
  });

  describe('saveWorksheetSchema', () => {
    it('accepts a valid input', () => {
      const r = saveWorksheetSchema.parse({
        title: 'My',
        content: ['你', '好'],
        cellStyle: 'brush',
      });
      expect(r.cellStyle).toBe('brush');
    });

    it('rejects empty content', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: [], cellStyle: 'brush' })
      ).toThrow();
    });

    it('rejects non-CJK char', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['a'], cellStyle: 'brush' })
      ).toThrow();
    });

    it('rejects invalid cellStyle', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['你'], cellStyle: 'xyz' })
      ).toThrow();
    });
  });
});
