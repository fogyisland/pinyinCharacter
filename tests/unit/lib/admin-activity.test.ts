/**
 * Unit tests for lib/admin-activity.ts.
 *
 * Mock pool pattern mirrors tests/unit/lib/page-views.test.ts: key query
 * mocks off SQL substrings, return tuples in mysql2 [rows, fields] shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let queryResults: Record<string, any[]> = {};
let queryLog: Array<{ sql: string; params: any[] }> = [];

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key];
      }
      return [[]];
    }),
  }),
}));

import { getRecentActivity, ActivityItem } from '@/lib/admin-activity';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
});

function iso(dateStr: string): Date {
  return new Date(dateStr);
}

describe('getRecentActivity', () => {
  it('queries all 3 sources in parallel via Promise.all', async () => {
    await getRecentActivity(10);
    const auditQ = queryLog.find((q) => q.sql.includes('FROM audit_log'));
    const dlQ = queryLog.find((q) => q.sql.includes('FROM downloads'));
    const aiQ = queryLog.find((q) => q.sql.includes('FROM ai_calls'));
    expect(auditQ).toBeDefined();
    expect(dlQ).toBeDefined();
    expect(aiQ).toBeDefined();
  });

  it('queries each source with LIMIT max(10, limit*2)', async () => {
    await getRecentActivity(5);
    const auditQ = queryLog.find((q) => q.sql.includes('FROM audit_log'))!;
    expect(auditQ.params).toContain(10);  // max(10, 5*2) = 10
  });

  it('rows merged sorted by created_at DESC, sliced to limit', async () => {
    queryResults['FROM audit_log'] = [[
      { id: 1, event: 'login', metadata: { username: 'a' }, created_at: iso('2026-07-10T10:00:00Z') },
    ]];
    queryResults['FROM downloads'] = [[
      { id: 2, source_type: 'worksheet', source_id: 'ws-1', created_at: iso('2026-07-11T08:00:00Z') },
      { id: 3, source_type: 'poem', source_id: 'p-1', created_at: iso('2026-07-09T08:00:00Z') },
    ]];
    queryResults['FROM ai_calls'] = [[
      { id: 4, feature: 'explain', status: 'ok', created_at: iso('2026-07-11T09:00:00Z') },
    ]];

    const result = await getRecentActivity(10);
    expect(result.map((r) => +r.at)).toEqual([
      +new Date('2026-07-11T09:00:00Z'),  // ai
      +new Date('2026-07-11T08:00:00Z'),  // download
      +new Date('2026-07-10T10:00:00Z'),  // audit
      +new Date('2026-07-09T08:00:00Z'),  // download
    ]);
  });

  it('limits to top N after merge (not per source)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: i, source_type: 'worksheet', source_id: `ws-${i}`, created_at: iso(`2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    }));
    queryResults['FROM downloads'] = [rows];

    const result = await getRecentActivity(5);
    expect(result).toHaveLength(5);
  });

  it('audit row → ActivityItem with type=audit + Chinese summary via formatLogMessage', async () => {
    queryResults['FROM audit_log'] = [[
      { id: 42, event: 'login', metadata: { username: 'alice' }, created_at: iso('2026-07-11T10:00:00Z') },
    ]];
    queryResults['FROM downloads'] = [[]];
    queryResults['FROM ai_calls'] = [[]];

    const result = await getRecentActivity(10);
    expect(result[0].type).toBe('audit');
    expect(result[0].summary).toBe('登录(alice)');
    expect(result[0].href).toBe('/admin/audit?focus=42');
  });

  it('download row → ActivityItem with type=download + Chinese summary', async () => {
    queryResults['FROM audit_log'] = [[]];
    queryResults['FROM downloads'] = [[
      { id: 7, source_type: 'worksheet', source_id: 'my-sheet', created_at: iso('2026-07-11T10:00:00Z') },
    ]];
    queryResults['FROM ai_calls'] = [[]];

    const result = await getRecentActivity(10);
    expect(result[0].type).toBe('download');
    expect(result[0].summary).toBe('下载 worksheet #my-sheet');
    expect(result[0].href).toBe('/admin/downloads');
  });

  it('ai row → ActivityItem with type=ai + Chinese summary', async () => {
    queryResults['FROM audit_log'] = [[]];
    queryResults['FROM downloads'] = [[]];
    queryResults['FROM ai_calls'] = [[
      { id: 99, feature: 'explain', status: 'ok', created_at: iso('2026-07-11T10:00:00Z') },
    ]];

    const result = await getRecentActivity(10);
    expect(result[0].type).toBe('ai');
    expect(result[0].summary).toBe('AI 字义解释 成功');
    expect(result[0].href).toBe('/admin/ai?focus=99');
  });

  it('returns [] if all 3 sources empty', async () => {
    queryResults['FROM audit_log'] = [[]];
    queryResults['FROM downloads'] = [[]];
    queryResults['FROM ai_calls'] = [[]];
    const result = await getRecentActivity(10);
    expect(result).toEqual([]);
  });
});
