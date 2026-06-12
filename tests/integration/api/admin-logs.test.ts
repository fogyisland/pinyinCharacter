// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Mock next/headers cookies() — same pattern as admin-users-disable.test.ts
const testCookieStore: Record<string, { value: string }> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

import { getPool, closePool } from '../../../lib/db';
import { GET } from '../../../app/api/admin/logs/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let userId: number;
let cookieValue: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/logs', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_logs', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_logs', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    const token = await signSession({ id: adminId, username: 'adm_logs' });
    cookieValue = `auth_token=${token}`;
    testCookieStore['auth_token'] = { value: token };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [adminId, userId]);
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  async function getLogs(query: string = '') {
    const req = new NextRequest(`http://localhost/api/admin/logs${query}`, { headers: { cookie: cookieValue } });
    const res = await GET(req);
    return res.json();
  }

  it('returns items from all 3 sources by default', async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO audit_log (user_id, event) VALUES (?, 'login')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    await pool.query(`INSERT INTO ai_calls (user_id, feature, model, status) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok')`, [userId]);
    const body = await getLogs();
    expect(body.ok).toBe(true);
    const sources = new Set(body.data.items.map((i: any) => i.source));
    expect(sources.has('audit')).toBe(true);
    expect(sources.has('download')).toBe(true);
    expect(sources.has('ai_call')).toBe(true);
    // Verify desc sort by createdAt
    const times = body.data.items.map((i: any) => new Date(i.createdAt).getTime());
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }
  });

  it('filters by type=download_logged', async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO audit_log (user_id, event) VALUES (?, 'login')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    const body = await getLogs('?type=download_logged');
    expect(body.ok).toBe(true);
    for (const item of body.data.items) expect(item.source).toBe('download');
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by userId', async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO audit_log (user_id, event) VALUES (?, 'login')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    await pool.query(`INSERT INTO ai_calls (user_id, feature, model, status) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok')`, [userId]);
    const body = await getLogs(`?userId=${userId}`);
    expect(body.ok).toBe(true);
    for (const item of body.data.items) expect(item.userId).toBe(userId);
    expect(body.data.items.length).toBeGreaterThanOrEqual(3);
  });

  it('filters by date range ?from=', async () => {
    const pool = getPool();
    // Old row from 2020 should be filtered out by ?from=2021-01-01
    await pool.query(`INSERT INTO audit_log (user_id, event, created_at) VALUES (?, 'old_evt', '2020-01-01 00:00:00')`, [userId]);
    await pool.query(`INSERT INTO audit_log (user_id, event) VALUES (?, 'new_evt')`, [userId]);
    const body = await getLogs('?from=2021-01-01T00:00:00Z');
    expect(body.ok).toBe(true);
    // Only "new_evt" should be returned (not the 2020 row)
    const userRows = body.data.items.filter((i: any) => i.userId === userId);
    for (const item of userRows) {
      expect(new Date(item.createdAt).getTime()).toBeGreaterThanOrEqual(new Date('2021-01-01').getTime());
    }
  });

  it('empty result returns ok with empty items', async () => {
    const body = await getLogs('?userId=99999999');
    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });
});