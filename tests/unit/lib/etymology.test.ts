import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getEtymology } from '@/lib/etymology';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery, execute: mockedQuery });

describe('getEtymology', () => {
  beforeEach(() => mockedQuery.mockReset());

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

    const result = await getEtymology('龘');
    expect(result?.eraGlyphs[0].hasGlyph).toBe(false);
    expect(result?.eraGlyphs[4].hasGlyph).toBe(true);
  });
});