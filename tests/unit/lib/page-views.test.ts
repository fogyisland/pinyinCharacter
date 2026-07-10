/**
 * Unit tests for lib/page-views.ts and lib/admin-pageviews.ts.
 *
 * Mirrors the audio-tracks mock-pool pattern: we never hit a real DB; we
 * key query mocks off SQL substrings and assert on the parameters that
 * were bound and on the destructured shape returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type QueryResult = any[];

let queryResults: Record<string, QueryResult> = {};
let queryLog: Array<{ sql: string; params: any[] }> = [];
let executeLog: Array<{ sql: string; params: any[] }> = [];

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [[], []];
    }),
    execute: vi.fn(async (sql: string, params: any[] = []) => {
      executeLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [{ insertId: 1, affectedRows: 1 }, []];
    }),
  }),
}));

import { recordPageView } from '@/lib/page-views';
import { getPageViewStats } from '@/lib/admin-pageviews';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
  executeLog = [];
});

describe('recordPageView', () => {
  it('inserts one row per call with all 4 params in order', async () => {
    queryResults['INSERT INTO page_views'] = [{ insertId: 100, affectedRows: 1 }, []];
    await recordPageView({
      userId: 7,
      path: '/char/汉',
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
    const ins = executeLog.find((q) => q.sql.includes('INSERT INTO page_views'));
    expect(ins).toBeDefined();
    expect(ins!.sql).toContain('(user_id, path, ip, user_agent)');
    expect(ins!.params).toEqual([7, '/char/汉', '203.0.113.5', 'Mozilla/5.0']);
  });

  it('passes userId=null + ip=1.2.3.4 through unchanged (user_id IS NULL)', async () => {
    queryResults['INSERT INTO page_views'] = [{ insertId: 101, affectedRows: 1 }, []];
    await recordPageView({
      userId: null,
      path: '/poems',
      ip: '1.2.3.4',
      userAgent: null,
    });
    const ins = executeLog.find((q) => q.sql.includes('INSERT INTO page_views'));
    expect(ins).toBeDefined();
    expect(ins!.params).toEqual([null, '/poems', '1.2.3.4', null]);
    // No defensive coercion: NULL is preserved as JS null
    expect(ins!.params[0]).toBeNull();
    expect(ins!.params[3]).toBeNull();
  });

  it('uses execute() (not query()) so the INSERT is binary-protocol safe', async () => {
    queryResults['INSERT INTO page_views'] = [{ insertId: 102, affectedRows: 1 }, []];
    await recordPageView({
      userId: 1,
      path: '/x',
      ip: null,
      userAgent: null,
    });
    // Regression guard for the mysql2 supp-plane bug:
    // pool.execute() uses the binary protocol and preserves 4-byte UTF-8;
    // pool.query() uses string interpolation and corrupts supp-plane chars.
    // The INSERT must go to executeLog and NOT to queryLog.
    const insertsOnExecute = executeLog.filter((q) => q.sql.includes('INSERT INTO page_views'));
    const insertsOnQuery = queryLog.filter((q) => q.sql.includes('INSERT INTO page_views'));
    expect(insertsOnExecute).toHaveLength(1);
    expect(insertsOnQuery).toHaveLength(0);
  });

  it('does NOT truncate path — the API route is responsible for that', async () => {
    // Per brief case 6: API route truncates to 255 chars before calling us;
    // we double-check that whatever path we receive is passed through as-is.
    const longPath = '/' + 'a'.repeat(500);
    queryResults['INSERT INTO page_views'] = [{ insertId: 103, affectedRows: 1 }, []];
    await recordPageView({ userId: null, path: longPath, ip: null, userAgent: null });
    const ins = executeLog.find((q) => q.sql.includes('INSERT INTO page_views'));
    expect(ins!.params[1]).toBe(longPath);
    expect((ins!.params[1] as string).length).toBe(501);
  });
});

describe('getPageViewStats', () => {
  it('returns todayPv from COUNT(*) WHERE created_at >= CURDATE()', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 42 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[], []];
    const stats = await getPageViewStats();
    expect(stats.todayPv).toBe(42);
  });

  it('returns todayUv from COUNT(DISTINCT COALESCE(user_id, ip))', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 100 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 17 }], []];
    queryResults['GROUP BY path'] = [[], []];
    const stats = await getPageViewStats();
    expect(stats.todayUv).toBe(17);
  });

  it('returns topPaths mapped to {path, count} in COUNT(*) DESC order, LIMIT 5', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 0 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[
      { path: '/poems', count: 50 },
      { path: '/char/学', count: 30 },
      { path: '/sutras', count: 20 },
      { path: '/etymology/字', count: 10 },
      { path: '/worksheets/new', count: 5 },
    ], []];
    const stats = await getPageViewStats();
    expect(stats.topPaths).toEqual([
      { path: '/poems', count: 50 },
      { path: '/char/学', count: 30 },
      { path: '/sutras', count: 20 },
      { path: '/etymology/字', count: 10 },
      { path: '/worksheets/new', count: 5 },
    ]);
  });

  it('coerces today_pv / today_uv / count to Number (mysql2 may return strings)', async () => {
    // mysql2 sometimes returns BIGINT as string depending on config.
    // The lib guards with Number() — verify that path actually fires.
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: '142' }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: '88' }], []];
    queryResults['GROUP BY path'] = [[
      { path: '/x', count: '12' },
    ], []];
    const stats = await getPageViewStats();
    expect(typeof stats.todayPv).toBe('number');
    expect(stats.todayPv).toBe(142);
    expect(typeof stats.todayUv).toBe('number');
    expect(stats.todayUv).toBe(88);
    expect(typeof stats.topPaths[0].count).toBe('number');
    expect(stats.topPaths[0].count).toBe(12);
  });

  it('defaults the days window to 7 and binds it as a single ? parameter', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 0 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[], []];
    await getPageViewStats();
    const topQ = queryLog.find((q) => q.sql.includes('GROUP BY path'));
    expect(topQ).toBeDefined();
    expect(topQ!.params).toEqual([7]);
    // And the SQL uses INTERVAL ? DAY so the number is bound, not interpolated
    expect(topQ!.sql).toContain('INTERVAL ? DAY');
  });

  it('respects a custom days argument (30) for the top-paths window', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 0 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[], []];
    await getPageViewStats(30);
    const topQ = queryLog.find((q) => q.sql.includes('GROUP BY path'));
    expect(topQ!.params).toEqual([30]);
  });

  it('the today window uses CURDATE() (not a bound parameter) and excludes 7d-old rows by date math', async () => {
    // Boundary test from brief case 7: the today PV/UV queries are anchored
    // to CURDATE() (midnight), so rows from before today are excluded by
    // the SQL itself — we don't pass any date params for those two queries.
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 0 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[], []];
    await getPageViewStats(7);
    const todayPvQ = queryLog.find((q) => q.sql.includes('today_pv'));
    const todayUvQ = queryLog.find((q) => q.sql.includes('today_uv'));
    expect(todayPvQ!.params).toEqual([]);
    expect(todayUvQ!.params).toEqual([]);
    expect(todayPvQ!.sql).toContain('CURDATE()');
    expect(todayUvQ!.sql).toContain('CURDATE()');
    // Only the top-paths query carries the bound day window
    const topQ = queryLog.find((q) => q.sql.includes('GROUP BY path'));
    expect(topQ!.params).toEqual([7]);
  });

  it('returns { todayPv: 0, todayUv: 0, topPaths: [] } when the table is empty', async () => {
    queryResults['COUNT(*) AS today_pv'] = [[{ today_pv: 0 }], []];
    queryResults['COUNT(DISTINCT COALESCE'] = [[{ today_uv: 0 }], []];
    queryResults['GROUP BY path'] = [[], []];
    expect(await getPageViewStats()).toEqual({
      todayPv: 0,
      todayUv: 0,
      topPaths: [],
    });
  });
});