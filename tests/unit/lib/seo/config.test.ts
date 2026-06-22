import { describe, it, expect, vi, afterEach } from 'vitest';

describe('getSiteUrl', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

  it('returns env value when set, stripping trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://pinyin.example.com/';
    return import('@/lib/seo/config').then(m => {
      expect(m.getSiteUrl()).toBe('https://pinyin.example.com');
    });
  });

  it('returns fallback when env missing', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    return import('@/lib/seo/config').then(m => {
      expect(m.getSiteUrl()).toBe('http://localhost:3000');
    });
  });
});

describe('buildCanonicalUrl', () => {
  it('prepends site url and adds leading slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    return import('@/lib/seo/config').then(m => {
      expect(m.buildCanonicalUrl('/poetry/1')).toBe('https://x.com/poetry/1');
      expect(m.buildCanonicalUrl('poetry/1')).toBe('https://x.com/poetry/1');
    });
  });

  it('passes through absolute URLs unchanged', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    return import('@/lib/seo/config').then(m => {
      expect(m.buildCanonicalUrl('https://other.com/y')).toBe('https://other.com/y');
    });
  });
});
