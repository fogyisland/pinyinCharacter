// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET, PUT } from '@/app/api/admin/paypal/config/route';
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

d('admin/paypal/config routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_config (
      \`key\` VARCHAR(64) NOT NULL, value TEXT NOT NULL,
      updated_by BIGINT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Clean stale paypal config + audit
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_paypal', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_paypal' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    await pool.query(`DELETE FROM audit_log WHERE user_id = ?`, [adminId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  const hdr = () => ({ cookie: `auth_token=${adminToken}` });
  const json = (_b: any) => ({ ...hdr(), 'content-type': 'application/json' });

  it('GET returns all 4 fields masked when not set', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/paypal/config', { headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      mode: 'sandbox', hasClientId: false, hasSecret: false, hasWebhookId: false,
    });
    expect(body.data.webhookUrl).toContain('/api/webhooks/paypal');
  });

  it('PUT updates mode and writes audit', async () => {
    const res = await PUT(new NextRequest('http://localhost/api/admin/paypal/config', {
      method: 'PUT', headers: json({}), body: JSON.stringify({ mode: 'live' }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('live');
    const [audit] = await getPool().query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'paypal_config_updated'`,
      [adminId],
    );
    expect(audit.length).toBe(1);
  });

  it('PUT writes secret and masks on subsequent GET', async () => {
    await PUT(new NextRequest('http://localhost/api/admin/paypal/config', {
      method: 'PUT', headers: json({}), body: JSON.stringify({ clientSecret: 'super-secret-1234567890' }),
    }));
    const get = await GET(new NextRequest('http://localhost/api/admin/paypal/config', { headers: hdr() }));
    const { data } = await get.json();
    expect(data.hasSecret).toBe(true);
    // Confirm raw value is not returned anywhere
    const rawJson = JSON.stringify(data);
    expect(rawJson).not.toContain('super-secret-1234567890');
  });
});
