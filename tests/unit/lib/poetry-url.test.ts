import { describe, it, expect } from 'vitest';
import {
  POETRY_DEFAULT_DYNASTY,
  buildPoetryHref,
  parsePoetryQuery,
} from '@/lib/poetry-url';

describe('parsePoetryQuery', () => {
  it('falls back to the defaults for an empty query', () => {
    const query = parsePoetryQuery({});
    expect(query.dynasty).toBe(POETRY_DEFAULT_DYNASTY);
    expect(query.q).toBe('');
    expect(query.forms).toEqual([]);
    expect(query.page).toBe(1);
  });

  it('reads the dynasty, the search term, the forms and the page', () => {
    const query = parsePoetryQuery({
      dynasty: 'song',
      q: '  静夜思 ',
      form: '五律,七律',
      page: '3',
    });
    expect(query).toEqual({ dynasty: 'song', q: '静夜思', forms: ['五律', '七律'], page: 3 });
  });

  it('rejects a broken page number', () => {
    expect(parsePoetryQuery({ page: 'abc' }).page).toBe(1);
    expect(parsePoetryQuery({ page: '-3' }).page).toBe(1);
    expect(parsePoetryQuery({ page: '0' }).page).toBe(1);
  });

  it('takes the first value of a repeated parameter', () => {
    const query = parsePoetryQuery({ dynasty: ['song', 'tang'], form: ['五律'] });
    expect(query.dynasty).toBe('song');
    expect(query.forms).toEqual(['五律']);
  });
});

describe('buildPoetryHref', () => {
  it('writes the filter state into the query string', () => {
    const href = buildPoetryHref({
      dynasty: 'tang',
      q: '静夜思',
      forms: ['五律'],
      page: 2,
    });
    const params = new URLSearchParams(href.slice('/poetry?'.length));
    expect(params.get('dynasty')).toBe('tang');
    expect(params.get('q')).toBe('静夜思');
    expect(params.get('form')).toBe('五律');
    expect(params.get('page')).toBe('2');
  });

  it('leaves out the empty values and the first page', () => {
    const href = buildPoetryHref({ dynasty: 'tang', q: '', forms: [], page: 1 });
    expect(href).toBe('/poetry?dynasty=tang');
  });

  it('applies the overrides', () => {
    const href = buildPoetryHref(
      { dynasty: 'tang', q: '静夜思', forms: ['五律'], page: 4 },
      { dynasty: 'song', forms: [], page: 1 },
    );
    expect(href).toBe('/poetry?dynasty=song&q=%E9%9D%99%E5%A4%9C%E6%80%9D');
  });
});
