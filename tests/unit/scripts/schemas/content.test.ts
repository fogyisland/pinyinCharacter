import { describe, it, expect } from 'vitest';
import { CharContentSchema, ContentManifestSchema } from '@/scripts/schemas/content';

describe('CharContentSchema', () => {
  it('accepts minimal valid (char + pinyin only)', () => {
    const r = CharContentSchema.parse({ char: '一', pinyin: 'yī' });
    expect(r.char).toBe('一');
    expect(r.pinyin).toBe('yī');
    expect(r.meaning_zh).toBeUndefined();
  });

  it('accepts full char with all fields', () => {
    const r = CharContentSchema.parse({
      char: '一',
      pinyin: 'yī',
      meaning_zh: '一,数之始也',
      etymology_story: '甲骨文作一,象形。横画也,至楷书定形。'.repeat(8), // 152 字
      hanzi_story: '《说文》载,一,数之始也。天地之道,惟此一理贯通。',
    });
    expect(r.meaning_zh).toContain('数之始');
  });

  it('rejects multi-char char field', () => {
    expect(() => CharContentSchema.parse({ char: '丁七', pinyin: 'dīng' })).toThrow();
  });

  it('rejects etymology_story too short', () => {
    expect(() => CharContentSchema.parse({
      char: '一', pinyin: 'yī', etymology_story: '短'
    })).toThrow();
  });

  it('rejects hanzi_story too long', () => {
    expect(() => CharContentSchema.parse({
      char: '一', pinyin: 'yī', hanzi_story: 'x'.repeat(81)
    })).toThrow();
  });
});

describe('ContentManifestSchema', () => {
  it('accepts initial all-zero manifest', () => {
    const r = ContentManifestSchema.parse({
      version: 1, totalChars: 8105,
      byField: { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 },
      generatedAt: '2026-06-15T10:00:00.000Z',
    });
    expect(r.totalChars).toBe(8105);
  });

  it('rejects wrong version', () => {
    expect(() => ContentManifestSchema.parse({
      version: 2, totalChars: 8105,
      byField: { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 },
      generatedAt: '2026-06-15T10:00:00.000Z',
    })).toThrow();
  });
});