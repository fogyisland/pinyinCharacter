import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from '@/lib/config';

describe('getSiteUrl', () => {
  it('returns env value when set, stripping trailing slash', async () => {
    const m = await import('@/lib/seo/config');
    expect(m.getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://pinyin.example.com/' } as unknown as NodeJS.ProcessEnv))
      .toBe('https://pinyin.example.com');
  });

  it('returns localhost fallback when env missing in dev', async () => {
    const m = await import('@/lib/seo/config');
    expect(m.getSiteUrl({ NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv))
      .toBe('http://localhost:3000');
  });

  it('returns localhost fallback when env missing in test', async () => {
    const m = await import('@/lib/seo/config');
    expect(m.getSiteUrl({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv))
      .toBe('http://localhost:3000');
  });

  it('throws in production when env missing (canonical/sitemap would leak localhost)', async () => {
    const m = await import('@/lib/seo/config');
    expect(() => m.getSiteUrl({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv))
      .toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('throws in production when env is empty string (treated as missing)', async () => {
    const m = await import('@/lib/seo/config');
    expect(() => m.getSiteUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: '' } as unknown as NodeJS.ProcessEnv))
      .toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('returns env value in production when env set', async () => {
    const m = await import('@/lib/seo/config');
    expect(m.getSiteUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://prod.example.com' } as unknown as NodeJS.ProcessEnv))
      .toBe('https://prod.example.com');
  });
});

describe('buildCanonicalUrl', () => {
  it('prepends site url and adds leading slash', async () => {
    const m = await import('@/lib/seo/config');
    const env = { NEXT_PUBLIC_SITE_URL: 'https://x.com' } as unknown as NodeJS.ProcessEnv;
    expect(m.buildCanonicalUrl('/poetry/1', env)).toBe('https://x.com/poetry/1');
    expect(m.buildCanonicalUrl('poetry/1', env)).toBe('https://x.com/poetry/1');
  });

  it('passes through absolute URLs unchanged', async () => {
    const m = await import('@/lib/seo/config');
    const env = { NEXT_PUBLIC_SITE_URL: 'https://x.com' } as unknown as NodeJS.ProcessEnv;
    expect(m.buildCanonicalUrl('https://other.com/y', env)).toBe('https://other.com/y');
  });

  it('throws in production when env missing (would emit localhost canonicals)', async () => {
    const m = await import('@/lib/seo/config');
    expect(() => m.buildCanonicalUrl('/poetry/1', { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv))
      .toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe('getRuntimeSiteUrl', () => {
  it('reads from app_config when set', async () => {
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue('https://override.example.com');
    const m = await import('@/lib/seo/config');
    expect(await m.getRuntimeSiteUrl()).toBe('https://override.example.com');
  });

  it('falls back to env when app_config is null', async () => {
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue(null);
    const m = await import('@/lib/seo/config');
    const result = await m.getRuntimeSiteUrl(
      { NEXT_PUBLIC_SITE_URL: 'https://env.example.com' } as unknown as NodeJS.ProcessEnv,
    );
    expect(result).toBe('https://env.example.com');
  });

  it('strips trailing slash from app_config value', async () => {
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue('https://x.com/');
    const m = await import('@/lib/seo/config');
    expect(await m.getRuntimeSiteUrl()).toBe('https://x.com');
  });
});
