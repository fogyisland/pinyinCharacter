/**
 * Tests for the /admin/downloads URL state.
 *
 * The page parses the query on the server and the filter bar builds it in the
 * browser — both through this module, so a filter can never be dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  DOWNLOAD_SOURCE_OPTIONS,
  buildDownloadsHref,
  defaultDownloadsQuery,
  parseDownloadSourceType,
  parseDownloadsQuery,
} from '@/lib/admin-downloads-url';

describe('parseDownloadsQuery', () => {
  it('falls back to the defaults for an empty query', () => {
    const query = parseDownloadsQuery({});
    expect(query.sourceType).toBe('');
    expect(query.userId).toBe('');
    expect(query.page).toBe(1);
    expect(query.from).toBe(defaultDownloadsQuery().from);
    expect(query.to).toBe(defaultDownloadsQuery().to);
  });

  it('reads every filter', () => {
    const query = parseDownloadsQuery({
      sourceType: 'poem',
      userId: '9',
      from: '2026-02-01',
      to: '2026-02-28',
      page: '3',
    });
    expect(query).toEqual({
      sourceType: 'poem',
      userId: '9',
      from: '2026-02-01',
      to: '2026-02-28',
      page: 3,
    });
  });

  it('rejects an unknown source type', () => {
    expect(parseDownloadsQuery({ sourceType: 'nope' }).sourceType).toBe('');
  });
});

describe('parseDownloadSourceType', () => {
  it('accepts the 4 known types', () => {
    for (const value of ['worksheet', 'poem', 'sutra', 'rare-char-card']) {
      expect(parseDownloadSourceType(value)).toBe(value);
    }
  });

  it('rejects everything else', () => {
    expect(parseDownloadSourceType('')).toBe('');
    expect(parseDownloadSourceType('Worksheet')).toBe('');
  });
});

describe('buildDownloadsHref', () => {
  it('writes the filter state into the query string', () => {
    const href = buildDownloadsHref({
      sourceType: 'sutra',
      userId: '9',
      from: '2026-02-01',
      to: '2026-02-28',
      page: 2,
    });
    const params = new URLSearchParams(href.slice('/admin/downloads?'.length));
    expect(params.get('sourceType')).toBe('sutra');
    expect(params.get('userId')).toBe('9');
    expect(params.get('page')).toBe('2');
  });

  it('leaves out the empty values and the first page', () => {
    const href = buildDownloadsHref({
      sourceType: '',
      userId: '',
      from: '2026-02-01',
      to: '2026-02-28',
      page: 1,
    });
    expect(href).toBe('/admin/downloads?from=2026-02-01&to=2026-02-28');
  });

  it('round-trips through parseDownloadsQuery', () => {
    const query = parseDownloadsQuery({ sourceType: 'worksheet', userId: '3', page: '2' });
    const params = new URLSearchParams(buildDownloadsHref(query).slice('/admin/downloads?'.length));
    expect(parseDownloadsQuery(Object.fromEntries(params.entries()))).toEqual(query);
  });
});

describe('the source options', () => {
  it('offers the 4 types plus "all"', () => {
    expect(DOWNLOAD_SOURCE_OPTIONS.map((o) => o.value)).toEqual([
      '',
      'worksheet',
      'poem',
      'sutra',
      'rare-char-card',
    ]);
  });
});
