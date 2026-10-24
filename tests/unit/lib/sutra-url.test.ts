import { describe, it, expect } from 'vitest';
import { buildSutraHref, parseSutraQuery } from '@/lib/sutra-url';

describe('parseSutraQuery', () => {
  it('falls back to the defaults for an empty query', () => {
    expect(parseSutraQuery({})).toEqual({ q: '', page: 1 });
  });

  it('reads the search term and the page', () => {
    expect(parseSutraQuery({ q: '  金刚经 ', page: '2' })).toEqual({ q: '金刚经', page: 2 });
  });

  it('rejects a broken page number', () => {
    expect(parseSutraQuery({ page: 'abc' }).page).toBe(1);
    expect(parseSutraQuery({ page: '-3' }).page).toBe(1);
    expect(parseSutraQuery({ page: '0' }).page).toBe(1);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseSutraQuery({ q: ['金刚经', '心经'] }).q).toBe('金刚经');
  });
});

describe('buildSutraHref', () => {
  it('leaves out the empty values and the first page', () => {
    expect(buildSutraHref({ q: '', page: 1 })).toBe('/sutra');
  });

  it('writes the filter state into the query string', () => {
    const href = buildSutraHref({ q: '金刚经', page: 2 });
    const params = new URLSearchParams(href.slice('/sutra?'.length));
    expect(params.get('q')).toBe('金刚经');
    expect(params.get('page')).toBe('2');
  });

  it('applies the overrides', () => {
    expect(buildSutraHref({ q: '金刚经', page: 3 }, { q: '心经', page: 1 })).toBe(
      '/sutra?q=%E5%BF%83%E7%BB%8F',
    );
  });
});
