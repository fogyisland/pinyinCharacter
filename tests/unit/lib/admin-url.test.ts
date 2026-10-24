/**
 * Tests for the shared admin URL helpers.
 *
 * These back the /admin/logs, /admin/downloads and /admin/ai pages: the pages
 * read their filter state from the query string on the server, and the filter
 * bars build the very same query string in the browser. A mismatch would
 * silently drop a filter, so the parsing and the building are pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  buildQuery,
  dateRangeToIso,
  defaultFromDate,
  isoDate,
  parseUserId,
  readIntParam,
  readParam,
  todayDate,
} from '@/lib/admin-url';

describe('readParam', () => {
  it('reads a single value', () => {
    expect(readParam({ source: 'audit' }, 'source')).toBe('audit');
  });

  it('returns an empty string for a missing param', () => {
    expect(readParam({}, 'source')).toBe('');
  });

  it('takes the first value of a repeated param', () => {
    expect(readParam({ source: ['audit', 'download'] }, 'source')).toBe('audit');
  });
});

describe('readIntParam', () => {
  it('reads a positive integer', () => {
    expect(readIntParam({ page: '3' }, 'page', 1)).toBe(3);
  });

  it('falls back for a missing or broken value', () => {
    expect(readIntParam({}, 'page', 1)).toBe(1);
    expect(readIntParam({ page: 'abc' }, 'page', 1)).toBe(1);
    expect(readIntParam({ page: '-3' }, 'page', 1)).toBe(1);
    expect(readIntParam({ page: '0' }, 'page', 1)).toBe(1);
  });
});

describe('date helpers', () => {
  it('formats a date as yyyy-mm-dd', () => {
    expect(isoDate(new Date('2026-10-24T08:30:00Z'))).toBe('2026-10-24');
  });

  it('defaults `from` to 7 days ago', () => {
    const expected = isoDate(new Date(Date.now() - 7 * 86_400_000));
    expect(defaultFromDate(7)).toBe(expected);
  });

  it('defaults `to` to today', () => {
    expect(todayDate()).toBe(isoDate(new Date()));
  });
});

describe('dateRangeToIso', () => {
  it('maps the from date to the start of the day', () => {
    const range = dateRangeToIso('2026-10-24', '');
    expect(range.from).toBe(new Date('2026-10-24').toISOString());
    expect(range.to).toBeUndefined();
  });

  it('maps the to date to the end of the day', () => {
    const range = dateRangeToIso('', '2026-10-24');
    expect(range.from).toBeUndefined();
    // 23:59:59 local time — the exact offset depends on the timezone.
    expect(new Date(range.to!).getHours()).toBe(23);
    expect(new Date(range.to!).getMinutes()).toBe(59);
  });

  it('ignores a broken date', () => {
    expect(dateRangeToIso('not-a-date', 'not-a-date')).toEqual({});
  });
});

describe('buildQuery', () => {
  it('drops the empty values', () => {
    expect(buildQuery({ a: '1', b: '', c: null, d: undefined, e: 0 })).toBe('a=1&e=0');
  });

  it('returns an empty string when nothing is left', () => {
    expect(buildQuery({ a: '', b: null })).toBe('');
  });
});

describe('parseUserId', () => {
  it('accepts a plain integer', () => {
    expect(parseUserId('42')).toBe(42);
  });

  it('rejects anything that is not an id', () => {
    expect(parseUserId('')).toBeUndefined();
    expect(parseUserId('abc')).toBeUndefined();
    expect(parseUserId('4.2')).toBeUndefined();
    expect(parseUserId('-1')).toBeUndefined();
    expect(parseUserId('1e3')).toBeUndefined();
  });
});
