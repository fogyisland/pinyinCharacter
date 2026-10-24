/**
 * Tests for the /admin/ai URL state.
 *
 * The tab and the call filters live in the query string, so the page can be
 * rendered on the server and a filtered view can be shared as a link.
 */
import { describe, it, expect } from 'vitest';
import {
  AI_STATUS_OPTIONS,
  AI_TABS,
  buildAiHref,
  defaultAiCallsQuery,
  parseAiCallsQuery,
  parseAiStatus,
  parseAiTab,
} from '@/lib/admin-ai-url';

describe('parseAiTab', () => {
  it('accepts the 3 known tabs', () => {
    expect(parseAiTab('calls')).toBe('calls');
    expect(parseAiTab('config')).toBe('config');
    expect(parseAiTab('mock')).toBe('mock');
  });

  it('falls back to the call list', () => {
    expect(parseAiTab('')).toBe('calls');
    expect(parseAiTab('nope')).toBe('calls');
  });
});

describe('parseAiStatus', () => {
  it('accepts the 3 known statuses', () => {
    expect(parseAiStatus('ok')).toBe('ok');
    expect(parseAiStatus('error')).toBe('error');
    expect(parseAiStatus('rate-limited')).toBe('rate-limited');
  });

  it('rejects everything else', () => {
    expect(parseAiStatus('')).toBe('');
    expect(parseAiStatus('OK')).toBe('');
  });
});

describe('parseAiCallsQuery', () => {
  it('falls back to the defaults for an empty query', () => {
    const query = parseAiCallsQuery({});
    expect(query.feature).toBe('');
    expect(query.status).toBe('');
    expect(query.userId).toBe('');
    expect(query.page).toBe(1);
    expect(query.from).toBe(defaultAiCallsQuery().from);
    expect(query.to).toBe(defaultAiCallsQuery().to);
  });

  it('reads every filter', () => {
    const query = parseAiCallsQuery({
      feature: 'char-recognize',
      status: 'error',
      userId: '5',
      from: '2026-03-01',
      to: '2026-03-31',
      page: '2',
    });
    expect(query).toEqual({
      feature: 'char-recognize',
      status: 'error',
      userId: '5',
      from: '2026-03-01',
      to: '2026-03-31',
      page: 2,
    });
  });
});

describe('buildAiHref', () => {
  it('links the config and the mock tab', () => {
    expect(buildAiHref('config')).toBe('/admin/ai?tab=config');
    expect(buildAiHref('mock')).toBe('/admin/ai?tab=mock');
  });

  it('keeps the call filters on the call list', () => {
    const href = buildAiHref('calls', {
      feature: 'char-recognize',
      status: 'error',
      userId: '5',
      from: '2026-03-01',
      to: '2026-03-31',
      page: 2,
    });
    const params = new URLSearchParams(href.slice('/admin/ai?'.length));
    expect(params.get('feature')).toBe('char-recognize');
    expect(params.get('status')).toBe('error');
    expect(params.get('userId')).toBe('5');
    expect(params.get('page')).toBe('2');
  });

  it('drops the call filters when another tab is selected', () => {
    const href = buildAiHref('config', {
      feature: 'char-recognize',
      status: 'error',
      userId: '5',
      from: '2026-03-01',
      to: '2026-03-31',
      page: 2,
    });
    expect(href).toBe('/admin/ai?tab=config');
  });

  it('leaves out the empty values and the first page', () => {
    const href = buildAiHref('calls', {
      feature: '',
      status: '',
      userId: '',
      from: '2026-03-01',
      to: '2026-03-31',
      page: 1,
    });
    expect(href).toBe('/admin/ai?from=2026-03-01&to=2026-03-31');
  });
});

describe('the tab and status options', () => {
  it('offers the 3 tabs', () => {
    expect(AI_TABS.map((t) => t.value)).toEqual(['calls', 'config', 'mock']);
  });

  it('offers the 3 statuses plus "all"', () => {
    expect(AI_STATUS_OPTIONS.map((s) => s.value)).toEqual(['', 'ok', 'error', 'rate-limited']);
  });
});
