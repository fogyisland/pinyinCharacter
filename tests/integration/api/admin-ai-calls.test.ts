// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

import { getPool, closePool } from '../../../lib/db';
import { GET as listRoute } from '../../../app/api/admin/ai/calls/route';
import { GET as statsRoute } from '../../../app/api/admin/ai/stats/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let userId: number;
let adminToken: string;
let userToken: string;
let adminCookie: string;
let userCookie: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/ai', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_ai', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_ai', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    adminToken = await signSession({ id: adminId, username: 'adm_ai' });
    userToken = await signSession({ id: userId, username: 'usr_ai' });
    adminCookie = `auth_token=${adminToken}`;
    userCookie = `auth_token=${userToken}`;
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_calls WHERE user_id IN (?, ?)`, [adminId, userId]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  function req(path: string, q: string = '', cookie: string = adminCookie): NextRequest {
    return new NextRequest(`http://localhost${path}${q}`, { headers: { cookie } });
  }

  async function getList(q: string = '', cookie: string = adminCookie) {
    const res = await listRoute(req('/api/admin/ai/calls', q, cookie));
    return { status: res.status, body: await res.json() };
  }
  async function getStats(q: string = '', cookie: string = adminCookie) {
    const res = await statsRoute(req('/api/admin/ai/stats', q, cookie));
    return { status: res.status, body: await res.json() };
  }

  it('non-admin denied (403), admin returns rows (200)', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok', 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'pinyin-tone', 'gpt-4o-mini', 'ok', 200)`,
      [userId],
    );
    // Non-admin user → swap the cookie store to the user token → 403
    testCookieStore['auth_token'] = { value: userToken };
    const denied = await getList('');
    expect(denied.status).toBe(403);
    // Restore admin token for the admin call below
    testCookieStore['auth_token'] = { value: adminToken };
    // Admin → 200 with our two rows visible (filtered by userId to avoid noise)
    const { status, body } = await getList(`?userId=${userId}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('?status=error returns only error rows', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok', 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'pinyin-tone', 'gpt-4o-mini', 'error', 200)`,
      [userId],
    );
    const { status, body } = await getList(`?userId=${userId}&status=error`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    for (const i of body.data.items) expect(i.status).toBe('error');
  });

  it('?feature=rare-char-story returns only that feature', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok', 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'pinyin-tone', 'gpt-4o-mini', 'ok', 200)`,
      [userId],
    );
    const { status, body } = await getList(`?userId=${userId}&feature=rare-char-story`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    for (const i of body.data.items) expect(i.feature).toBe('rare-char-story');
  });

  it('stats aggregate returns expected shape with non-null p50/p95', async () => {
    const pool = getPool();
    // Insert rows with known sorted durations: 100, 200, 300, 400, 500
    for (const d of [100, 200, 300, 400, 500]) {
      await pool.query(
        `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok', ?)`,
        [userId, d],
      );
    }
    const { status, body } = await getStats();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      total: expect.any(Number),
      byDay: expect.any(Array),
      errorRate: expect.any(Number),
      topUsers: expect.any(Array),
    });
    expect(body.data.p50Duration).not.toBeNull();
    expect(body.data.p95Duration).not.toBeNull();
    expect(typeof body.data.p50Duration).toBe('number');
    expect(typeof body.data.p95Duration).toBe('number');
    // errorRate must be in [0, 1]
    expect(body.data.errorRate).toBeGreaterThanOrEqual(0);
    expect(body.data.errorRate).toBeLessThanOrEqual(1);
  });
});