import { describe, it, expect } from 'vitest';
import { getPoetryBackLink } from '@/app/poetry/[id]/back-link';

describe('getPoetryBackLink', () => {
  it('returns plain /poetry when back is undefined', () => {
    expect(getPoetryBackLink(undefined)).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('returns plain /poetry when back is empty string', () => {
    expect(getPoetryBackLink('')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('passes through /poetry with a query string (preserves form filter)', () => {
    expect(getPoetryBackLink('/poetry?form=%E4%BA%94%E8%A8%80')).toEqual({
      href: '/poetry?form=%E4%BA%94%E8%A8%80',
      label: '返回诗词',
    });
  });

  it('passes through /poetry without query string', () => {
    expect(getPoetryBackLink('/poetry')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  // Open-redirect hardening
  it('rejects protocol-relative URL (//evil.com)', () => {
    expect(getPoetryBackLink('//evil.com')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('rejects absolute http URL', () => {
    expect(getPoetryBackLink('http://evil.com')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('rejects absolute https URL', () => {
    expect(getPoetryBackLink('https://evil.com')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('rejects paths to other sections (e.g. /dictionary)', () => {
    expect(getPoetryBackLink('/dictionary')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });

  it('rejects paths that merely contain /poetry but go elsewhere', () => {
    expect(getPoetryBackLink('/poetry-evil')).toEqual({
      href: '/poetry',
      label: '返回诗词',
    });
  });
});