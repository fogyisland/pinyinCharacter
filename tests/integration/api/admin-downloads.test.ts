// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Test-local cookie store. See admin-users-disable.test.ts for rationale.
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
import { GET as listDownloadsRoute } from '../../../app/api/admin/downloads/route';
import { GET as statsRoute } from '../../../app/api/admin/downloads/stats/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let userId: number;
let cookieValue: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/downloads', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_dl', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_dl', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'pdf', 'worksheet', '5')`, [userId]);
    const token = await signSession({ id: adminId, username: 'adm_dl' });
    cookieValue = `auth_token=${token}`;
    testCookieStore['auth_token'] = { value: token };
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  async function getList(q: string = '') {
    const req = new NextRequest(`http://localhost/api/admin/downloads${q}`, { headers: { cookie: cookieValue } });
    return (await listDownloadsRoute(req)).json();
  }
  async function getStats() {
    const req = new NextRequest(`http://localhost/api/admin/downloads/stats`, { headers: { cookie: cookieValue } });
    return (await statsRoute(req)).json();
  }

  it('list with default filters', async () => {
    const body = await getList();
    expect(body.ok).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('filter by sourceType=poem', async () => {
    const body = await getList('?sourceType=poem');
    expect(body.ok).toBe(true);
    for (const i of body.data.items) expect(i.sourceType).toBe('poem');
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('stats aggregate by source type and top user', async () => {
    const body = await getStats();
    expect(body.ok).toBe(true);
    expect(body.data.total).toBeGreaterThanOrEqual(2);
    expect(body.data.bySourceType.poem).toBeGreaterThanOrEqual(1);
    expect(body.data.bySourceType.worksheet).toBeGreaterThanOrEqual(1);
  });
});