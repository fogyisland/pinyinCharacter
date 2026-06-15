// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET as listHandler, POST as grantHandler } from '@/app/api/admin/memberships/route';
import { POST as revokeHandler } from '@/app/api/admin/memberships/[id]/revoke/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let adminId: number, userId: number, adminToken: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/memberships routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    // Ensure schema
    await pool.query(`CREATE TABLE IF NOT EXISTS memberships (
      id BIGINT NOT NULL AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
      source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
      amount DECIMAL(10,2) NULL, currency ENUM('CNY','USD') NULL,
      source_payment_order_id BIGINT NULL,
      granted_by BIGINT NULL, note VARCHAR(255) NULL,
      granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL, revoked_by BIGINT NULL, revoke_reason VARCHAR(255) NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT,
      plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL,
      duration_days INT NOT NULL, amount DECIMAL(10,2) NOT NULL,
      currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Seed 4 plans + 16 features
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    for (const p of [
      { k: 'monthly_usd', dn: '月度会员', d: 30, a: '3.00', c: 'USD', e: 1, o: 1 },
      { k: 'yearly_usd', dn: '年度会员', d: 365, a: '15.00', c: 'USD', e: 1, o: 2 },
      { k: 'monthly_cny', dn: '月度会员', d: 30, a: '15.00', c: 'CNY', e: 0, o: 3 },
      { k: 'yearly_cny', dn: '年度会员', d: 365, a: '100.00', c: 'CNY', e: 0, o: 4 },
    ]) {
      await pool.execute(
        `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.k, p.dn, p.d, p.a, p.c, p.e, p.o],
      );
      const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
      for (const f of ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts']) {
        await pool.execute(`INSERT INTO membership_plan_features (plan_id, feature_key) VALUES (?, ?)`, [Number((r[0] as any).id), f]);
      }
    }

    // Seed admin + user
    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_mem', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_mem', ?)`, [hash]);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_mem' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    await getPool().query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [adminId, userId]);
    await getPool().query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  const cookieHeader = () => ({ cookie: `auth_token=${adminToken}` });
  const jsonHeader = () => ({ ...cookieHeader(), 'content-type': 'application/json' });

  it('POST /api/admin/memberships — grants a membership and writes audit', async () => {
    const req = new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    });
    const res = await grantHandler(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeGreaterThan(0);
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

    const [audit] = await getPool().query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'membership_granted'`,
      [adminId],
    );
    expect(audit.length).toBe(1);
  });

  it('POST with unknown planKey returns 404', async () => {
    const req = new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'unknown' }),
    });
    const res = await grantHandler(req);
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/memberships — lists rows for the user', async () => {
    const gr = await grantHandler(new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    }));
    const { data: granted } = await gr.json();

    const res = await listHandler(new NextRequest(`http://localhost/api/admin/memberships?userId=${userId}`, { headers: cookieHeader() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0].id).toBe(granted.id);
    expect(body.data.items[0].username).toBe('usr_mem');
  });

  it('POST /api/admin/memberships/[id]/revoke — revokes and writes audit', async () => {
    const gr = await grantHandler(new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    }));
    const { data: granted } = await gr.json();

    const rev = await revokeHandler(new NextRequest(`http://localhost/api/admin/memberships/${granted.id}/revoke`, {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ reason: 'test' }),
    }), { params: Promise.resolve({ id: String(granted.id) }) });
    const revBody = await rev.json();
    expect(rev.status).toBe(200);
    expect(revBody.data.revokedAt).not.toBeNull();

    const second = await revokeHandler(new NextRequest(`http://localhost/api/admin/memberships/${granted.id}/revoke`, {
      method: 'POST', headers: jsonHeader(), body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: String(granted.id) }) });
    expect(second.status).toBe(409);
  });

  it('Non-admin request returns 403', async () => {
    // Login as non-admin
    const usrTok = await signSession({ id: userId, username: 'usr_mem' });
    testCookieStore['auth_token'] = { value: usrTok };
    const res = await listHandler(new NextRequest('http://localhost/api/admin/memberships', {
      headers: { cookie: `auth_token=${usrTok}` },
    }));
    expect(res.status).toBe(403);
    testCookieStore['auth_token'] = { value: adminToken };
  });
});
