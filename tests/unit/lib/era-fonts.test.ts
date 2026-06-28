import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config', () => ({
  getAllConfig: vi.fn(),
}));

import { ERA_FONTS, DEFAULT_ERA_FONTS, getActiveEraFonts } from '@/lib/era-fonts';
import { getAllConfig } from '@/lib/config';
import { ERAS } from '@/lib/etymology-types';

const mockedGetAllConfig = vi.mocked(getAllConfig);

describe('ERA_FONTS registry', () => {
  it('has exactly the 5 eras from ERAS', () => {
    for (const era of ERAS) {
      expect(ERA_FONTS[era]).toBeDefined();
      expect(ERA_FONTS[era].length).toBeGreaterThan(0);
    }
  });

  it('every option has id, label, file|desc shape', () => {
    for (const era of ERAS) {
      for (const opt of ERA_FONTS[era]) {
        expect(typeof opt.id).toBe('string');
        expect(opt.id.length).toBeGreaterThan(0);
        expect(typeof opt.label).toBe('string');
        expect(opt.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('default id for each era appears in that era\'s curated list', () => {
    for (const era of ERAS) {
      const ids = ERA_FONTS[era].map((o) => o.id);
      expect(ids).toContain(DEFAULT_ERA_FONTS[era]);
    }
  });
});

describe('DEFAULT_ERA_FONTS', () => {
  it('matches the spec values', () => {
    expect(DEFAULT_ERA_FONTS).toEqual({
      jiaguwen: 'Oracular',
      jinwen: 'WangHanzongWeibei',
      xiaozhuan: 'QuanZiKuShuoWen',
      lishu: 'WangHanzongLishu',
      kaishu: 'ZCOOLXiaoWei',
    });
  });
});

describe('getActiveEraFonts', () => {
  beforeEach(() => mockedGetAllConfig.mockReset());

  it('returns defaults when app_config is empty', async () => {
    mockedGetAllConfig.mockResolvedValue({});
    expect(await getActiveEraFonts()).toEqual(DEFAULT_ERA_FONTS);
  });

  it('overrides a single era when app_config has a valid id', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.jiaguwen.font': 'OracularInverted' });
    const out = await getActiveEraFonts();
    expect(out.jiaguwen).toBe('OracularInverted');
    expect(out.jinwen).toBe(DEFAULT_ERA_FONTS.jinwen);
  });

  it('ignores invalid ids (not in curated list) — keeps default', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.kaishu.font': 'NotARealFont' });
    const out = await getActiveEraFonts();
    expect(out.kaishu).toBe(DEFAULT_ERA_FONTS.kaishu);
  });

  it('ignores unrelated config keys', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'smtp.host': 'mail.example.com' });
    const out = await getActiveEraFonts();
    expect(out).toEqual(DEFAULT_ERA_FONTS);
  });
});