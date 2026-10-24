/**
 * Tests for the /admin/logs URL state.
 *
 * The page parses the query on the server and the filter bar builds it in the
 * browser — both through this module, so a filter can never be dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  AI_CALL_FEATURES,
  LOG_EVENT_GROUPS,
  LOG_SOURCE_OPTIONS,
  buildLogsHref,
  defaultLogsQuery,
  parseLogSource,
  parseLogsQuery,
} from '@/lib/admin-logs-url';

describe('parseLogsQuery', () => {
  it('falls back to the defaults for an empty query', () => {
    const query = parseLogsQuery({});
    expect(query.source).toBe('');
    expect(query.type).toBe('');
    expect(query.userId).toBe('');
    expect(query.ip).toBe('');
    expect(query.page).toBe(1);
    // The default window is the last 7 days.
    expect(query.to).toBe(defaultLogsQuery().to);
    expect(query.from).toBe(defaultLogsQuery().from);
  });

  it('reads every filter', () => {
    const query = parseLogsQuery({
      source: 'download',
      type: 'login',
      userId: '7',
      ip: '10.0.0.1',
      from: '2026-01-01',
      to: '2026-01-31',
      page: '4',
    });
    expect(query).toEqual({
      source: 'download',
      type: 'login',
      userId: '7',
      ip: '10.0.0.1',
      from: '2026-01-01',
      to: '2026-01-31',
      page: 4,
    });
  });

  it('rejects an unknown source', () => {
    expect(parseLogsQuery({ source: 'nope' }).source).toBe('');
  });

  it('takes the first value of a repeated param', () => {
    expect(parseLogsQuery({ source: ['audit', 'download'] }).source).toBe('audit');
  });
});

describe('parseLogSource', () => {
  it('accepts the 3 known sources', () => {
    expect(parseLogSource('audit')).toBe('audit');
    expect(parseLogSource('download')).toBe('download');
    expect(parseLogSource('ai_call')).toBe('ai_call');
  });

  it('rejects everything else', () => {
    expect(parseLogSource('')).toBe('');
    expect(parseLogSource('Audit')).toBe('');
    expect(parseLogSource('audit_log')).toBe('');
  });
});

describe('buildLogsHref', () => {
  it('writes the filter state into the query string', () => {
    const href = buildLogsHref({
      source: 'audit',
      type: 'login',
      userId: '7',
      ip: '10.0.0.1',
      from: '2026-01-01',
      to: '2026-01-31',
      page: 2,
    });
    const params = new URLSearchParams(href.slice('/admin/logs?'.length));
    expect(params.get('source')).toBe('audit');
    expect(params.get('type')).toBe('login');
    expect(params.get('userId')).toBe('7');
    expect(params.get('ip')).toBe('10.0.0.1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-01-31');
    expect(params.get('page')).toBe('2');
  });

  it('leaves out the empty values and the first page', () => {
    const href = buildLogsHref({
      source: '',
      type: '',
      userId: '',
      ip: '',
      from: '2026-01-01',
      to: '2026-01-31',
      page: 1,
    });
    expect(href).toBe('/admin/logs?from=2026-01-01&to=2026-01-31');
  });

  it('applies the overrides', () => {
    const href = buildLogsHref(parseLogsQuery({ source: 'audit', page: '3' }), { page: 4 });
    expect(href).toContain('page=4');
    expect(href).toContain('source=audit');
  });

  it('round-trips through parseLogsQuery', () => {
    const query = parseLogsQuery({ source: 'ai_call', type: 'char-recognize', page: '2' });
    const params = new URLSearchParams(buildLogsHref(query).slice('/admin/logs?'.length));
    expect(parseLogsQuery(Object.fromEntries(params.entries()))).toEqual(query);
  });
});

describe('the filter options', () => {
  it('offers the 3 sources plus "all"', () => {
    expect(LOG_SOURCE_OPTIONS.map((o) => o.value)).toEqual(['', 'audit', 'download', 'ai_call']);
  });

  it('offers the audit events, the download event and the AI features', () => {
    const values = LOG_EVENT_GROUPS.flatMap((group) => group.options.map((o) => o.value));
    expect(values).toContain('login');
    expect(values).toContain('download_logged');
    for (const feature of AI_CALL_FEATURES) {
      expect(values).toContain(feature);
    }
    // No duplicate values — a duplicate would break the select's key list.
    expect(new Set(values).size).toBe(values.length);
  });
});
