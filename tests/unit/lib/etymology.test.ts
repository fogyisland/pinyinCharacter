import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { getPool } from '@/lib/db';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery, execute: mockedQuery });

// Force getContent to fall back to DB by pretending the JSON file is missing.
beforeEach(() => {
  mockedQuery.mockReset();
  vi.mocked(existsSync).mockReset();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReset();
});

// getContent() makes 4 DB queries (chars, char_etymology, char_story, rare_chars).
// Mock all 4 with empty rows so getContent returns a content object whose
// etymology block is empty (forcing fallback to legacy DB columns).
const FOUR_EMPTY = [
  [[]],  // chars
  [[]],  // char_etymology
  [[]],  // char_story
  [[]],  // rare_chars
];

describe('getEtymology', () => {
  it('returns null when char not in char_etymology', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getEtymology('龘');
    expect(result).toBeNull();
  });

  it('returns full etymology with 5 era slots', async () => {
    mockedQuery.mockResolvedValueOnce([[{
      char: '一',
      era_jiaguwen_font: 'YinQiJiaGuWen', era_jiaguwen_has: 1,
      era_jinwen_font: 'HanDianJinWen', era_jinwen_has: 1,
      era_xiaozhuan_font: 'QuanZiKuShuoWen', era_xiaozhuan_has: 1,
      era_lishu_font: 'QuanZiKuLiDing', era_lishu_has: 1,
      era_kaishu_font: 'KaiTi', era_kaishu_has: 1,
      story: '一 字演变...',
      generated_by: 'gpt-4o',
      generated_at: new Date('2026-06-13T00:00:00Z'),
    }]]);
    // getContent fallback chain
    for (const r of FOUR_EMPTY) mockedQuery.mockResolvedValueOnce(r);

    const result = await getEtymology('一');
    expect(result?.char).toBe('一');
    expect(result?.eraGlyphs).toHaveLength(5);
    expect(result?.eraGlyphs[0].era).toBe('jiaguwen');
    expect(result?.eraGlyphs[0].hasGlyph).toBe(true);
    expect(result?.story).toBe('一 字演变...');
  });

  it('marks missing glyphs as hasGlyph=false', async () => {
    mockedQuery.mockResolvedValueOnce([[{
      char: '龘', era_jiaguwen_has: 0, era_jinwen_has: 0,
      era_xiaozhuan_has: 0, era_lishu_has: 0, era_kaishu_has: 1,
      era_jiaguwen_font: 'YinQiJiaGuWen', era_jinwen_font: 'HanDianJinWen',
      era_xiaozhuan_font: 'QuanZiKuShuoWen', era_lishu_font: 'QuanZiKuLiDing',
      era_kaishu_font: 'KaiTi',
      story: null, generated_by: null, generated_at: null,
    }]]);
    for (const r of FOUR_EMPTY) mockedQuery.mockResolvedValueOnce(r);

    const result = await getEtymology('龘');
    expect(result?.eraGlyphs[0].hasGlyph).toBe(false);
    expect(result?.eraGlyphs[4].hasGlyph).toBe(true);
  });
});

describe('getAdjacentChars', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns prev and next by unicode codepoint order', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '丁' }]]); // prev
    mockedQuery.mockResolvedValueOnce([[{ char: '七' }]]); // next

    const result = await getAdjacentChars('一');
    expect(result.prev).toBe('丁');
    expect(result.next).toBe('七');
  });

  it('returns null prev when char is first', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    mockedQuery.mockResolvedValueOnce([[{ char: '万' }]]);

    const result = await getAdjacentChars('一');
    expect(result.prev).toBeNull();
    expect(result.next).toBe('万');
  });

  it('returns null next when char is last', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '万' }]]);
    mockedQuery.mockResolvedValueOnce([[]]);

    const result = await getAdjacentChars('蠼');
    expect(result.next).toBeNull();
  });
});