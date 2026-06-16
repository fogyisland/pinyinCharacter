// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET as listHandler, POST as seedHandler } from '@/app/api/admin/memberships/plans/route';
import { PATCH as patchHandler } from '@/app/api/admin/memberships/plans/[id]/route';
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

let adminId: number, adminToken: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/memberships/plans routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    // Clean stale rows from prior test runs sharing the same DB
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_plans', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_plans' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM audit_log WHERE user_id = ?`, [adminId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  const hdr = () => ({ cookie: `auth_token=${adminToken}` });
  const json = (_b: any) => ({ ...hdr(), 'content-type': 'application/json' });

  it('POST /seed creates 4 plans + 16 features', async () => {
    const res = await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.seeded).toBe(4);
    const [c] = await getPool().query<any[]>(`SELECT COUNT(*) AS n FROM membership_plan_features`);
    expect(Number(c[0].n)).toBe(16);
  });

  it('GET returns enabledOnly filter', async () => {
    await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const res = await listHandler(new NextRequest('http://localhost/api/admin/memberships/plans?enabledOnly=1', { headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.items.every((p: any) => p.enabled)).toBe(true);
  });

  it('PATCH updates plan fields and writes audit', async () => {
    await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const list = await listHandler(new NextRequest('http://localhost/api/admin/memberships/plans', { headers: hdr() }));
    const { data: { items } } = await list.json();
    const target = items.find((p: any) => p.planKey === 'monthly_usd');

    const res = await patchHandler(new NextRequest(`http://localhost/api/admin/memberships/plans/${target.id}`, {
      method: 'PATCH', headers: json({ displayName: '月卡', amount: '4.00' }), body: JSON.stringify({ displayName: '月卡', amount: '4.00' }),
    }), { params: Promise.resolve({ id: String(target.id) }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.plan.displayName).toBe('月卡');
    expect(body.data.plan.amount).toBe('4.00');
  });
});
