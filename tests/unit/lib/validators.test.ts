import { describe, it, expect } from 'vitest';
import {
  searchQuerySchema,
  worksheetIdParamSchema,
  charParamSchema,
  saveWorksheetSchema,
  poemListQuerySchema,
  poemIdParamSchema,
  gameRoundQuerySchema,
} from '@/lib/validators';

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

    it('trims surrounding whitespace from q', () => {
      const r = searchQuerySchema.parse({ q: '  da  ' });
      expect(r.q).toBe('da');
    });

    it('normalizes whitespace-only q to empty string', () => {
      const r = searchQuerySchema.parse({ q: '   ' });
      expect(r.q).toBe('');
    });

    it('rejects q > 32 chars', () => {
      expect(() => searchQuerySchema.parse({ q: 'a'.repeat(33) })).toThrow();
    });

    it('rejects page < 1', () => {
      expect(() => searchQuerySchema.parse({ page: '0' })).toThrow();
    });
  });

  describe('worksheetIdParamSchema', () => {
    it('accepts a positive integer', () => {
      const r = worksheetIdParamSchema.parse({ id: 42 });
      expect(r.id).toBe(42);
    });

    it('coerces numeric string to integer', () => {
      const r = worksheetIdParamSchema.parse({ id: '123' });
      expect(r.id).toBe(123);
    });

    it('rejects zero', () => {
      expect(() => worksheetIdParamSchema.parse({ id: 0 })).toThrow();
    });

    it('rejects negative integer', () => {
      expect(() => worksheetIdParamSchema.parse({ id: -1 })).toThrow();
    });

    it('rejects non-numeric string', () => {
      expect(() => worksheetIdParamSchema.parse({ id: 'abc' })).toThrow();
    });
  });

  describe('charParamSchema', () => {
    it('accepts a single CJK char', () => {
      const r = charParamSchema.parse({ char: '你' });
      expect(r.char).toBe('你');
    });

    it('rejects empty string', () => {
      expect(() => charParamSchema.parse({ char: '' })).toThrow();
    });

    it('rejects multi-char string', () => {
      expect(() => charParamSchema.parse({ char: '你好' })).toThrow();
    });

    it('rejects ASCII char', () => {
      expect(() => charParamSchema.parse({ char: 'a' })).toThrow();
    });
  });

  describe('saveWorksheetSchema', () => {
    it('accepts a valid input', () => {
      const r = saveWorksheetSchema.parse({
        title: 'My',
        content: ['你', '好'],
        cellStyle: 'brush-square',
      });
      expect(r.cellStyle).toBe('brush-square');
    });

    it('rejects empty content', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: [], cellStyle: 'brush-square' })
      ).toThrow();
    });

    it('rejects non-CJK char', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['a'], cellStyle: 'brush-square' })
      ).toThrow();
    });

    it('rejects invalid cellStyle', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['你'], cellStyle: 'xyz' })
      ).toThrow();
    });

    it('accepts brush-square', () => {
      const r = saveWorksheetSchema.safeParse({
        title: 'test',
        content: ['永', '字', '八', '法'],
        cellStyle: 'brush-square',
      });
      expect(r.success).toBe(true);
    });

    it('rejects old cellStyle "brush"', () => {
      const r = saveWorksheetSchema.safeParse({
        title: 'test',
        content: ['永'],
        cellStyle: 'brush',
      });
      expect(r.success).toBe(false);
    });

    it('rejects unknown composite "pen-tracing"', () => {
      const r = saveWorksheetSchema.safeParse({
        title: 'test',
        content: ['永'],
        cellStyle: 'pen-tracing',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('poemListQuerySchema', () => {
    it('defaults dynasty to tang', () => {
      expect(poemListQuerySchema.parse({}).dynasty).toBe('tang');
    });

    it('rejects unknown dynasty', () => {
      expect(() => poemListQuerySchema.parse({ dynasty: 'yuan' })).toThrow();
    });

    it('trims q', () => {
      const r = poemListQuerySchema.parse({ q: '  李白  ' });
      expect(r.q).toBe('李白');
    });

    it('coerces page and pageSize', () => {
      const r = poemListQuerySchema.parse({ page: '3', pageSize: '50' });
      expect(r.page).toBe(3);
      expect(r.pageSize).toBe(50);
    });
  });

  describe('poemIdParamSchema', () => {
    it('accepts positive int', () => {
      expect(poemIdParamSchema.parse({ id: '5' }).id).toBe(5);
    });
    it('rejects non-positive', () => {
      expect(() => poemIdParamSchema.parse({ id: '0' })).toThrow();
    });
  });
});

describe('gameRoundQuerySchema', () => {
  it('defaults count to 4 when missing', () => {
    const r = gameRoundQuerySchema.parse({});
    expect(r.count).toBe(4);
  });
  it('accepts count 1-8', () => {
    for (const n of [1, 2, 4, 8]) {
      expect(gameRoundQuerySchema.parse({ count: String(n) }).count).toBe(n);
    }
  });
  it('rejects count 0 and count 9', () => {
    expect(() => gameRoundQuerySchema.parse({ count: '0' })).toThrow();
    expect(() => gameRoundQuerySchema.parse({ count: '9' })).toThrow();
  });
  it('parses seed as int when present', () => {
    const r = gameRoundQuerySchema.parse({ seed: '42' });
    expect(r.seed).toBe(42);
  });
  it('seed is optional', () => {
    const r = gameRoundQuerySchema.parse({});
    expect(r.seed).toBeUndefined();
  });
});
