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

import { getTopPaths } from '@/lib/admin-pageviews';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
});

describe('getTopPaths', () => {
  it('queries FROM page_views with INTERVAL clause + LIMIT', async () => {
    await getTopPaths(7, 20);
    const q = queryLog.find((x) => x.sql.includes('FROM page_views'));
    expect(q).toBeDefined();
    expect(q!.sql).toContain('GROUP BY path');
    expect(q!.sql).toContain('ORDER BY');
    expect(q!.sql).toContain('LIMIT ?');
    expect(q!.params).toEqual([7, 20]);
  });

  it('uses COUNT(DISTINCT COALESCE(user_id, ip)) for unique visitors', async () => {
    queryResults['FROM page_views'] = [[
      { path: '/x', views: 5, unique_visitors: 3 },
    ]];
    await getTopPaths(7, 10);
    expect(queryLog[0].sql).toMatch(/COUNT\(DISTINCT COALESCE\(user_id, ip\)\)/);
  });

  it('groups by path, orders by views DESC, maps {path, views, unique}', async () => {
    queryResults['FROM page_views'] = [[
      { path: '/a', views: 100, unique_visitors: 50 },
      { path: '/b', views: 50, unique_visitors: 30 },
    ]];
    const result = await getTopPaths(7, 10);
    expect(result).toEqual([
      { path: '/a', views: 100, unique: 50 },
      { path: '/b', views: 50, unique: 30 },
    ]);
  });

  it('returns [] for empty result set', async () => {
    queryResults['FROM page_views'] = [[]];
    expect(await getTopPaths(7, 20)).toEqual([]);
  });

  it('passes limit parameter as 2nd SQL param', async () => {
    await getTopPaths(30, 100);
    expect(queryLog[0].params).toEqual([30, 100]);
  });
});