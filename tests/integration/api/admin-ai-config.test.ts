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
import { GET, PUT } from '../../../app/api/admin/ai/config/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let userId: number;
let adminToken: string;
let adminCookie: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/ai/config', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_aicfg', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_aicfg', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    adminToken = await signSession({ id: adminId, username: 'adm_aicfg' });
    adminCookie = `auth_token=${adminToken}`;
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [adminId, userId]);
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'ai.%'`);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'ai.%'`);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  function getReq(): NextRequest {
    return new NextRequest('http://localhost/api/admin/ai/config', { headers: { cookie: adminCookie } });
  }
  function putReq(body: object): NextRequest {
    return new NextRequest('http://localhost/api/admin/ai/config', {
      method: 'PUT',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('GET returns 6 keys with api_key masked + hasApiKey flag', async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES ('ai.api_key', 'sk-secret') ON DUPLICATE KEY UPDATE value = VALUES(value)`);

    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.hasApiKey).toBe(true);
    expect(body.data.config['ai.api_key']).toBe('');
    const expected = ['ai.base_url', 'ai.api_key', 'ai.model', 'ai.rate_limit_per_user_per_day', 'ai.timeout_ms', 'ai.temperature'];
    for (const k of expected) {
      expect(body.data.config).toHaveProperty(k);
      expect(typeof body.data.config[k]).toBe('string');
    }
  });

  it('GET hasApiKey=false when api_key not set', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.data.hasApiKey).toBe(false);
    expect(body.data.config['ai.api_key']).toBe('');
  });

  it('PUT updates ai.model and reads back the masked shape', async () => {
    const put = await PUT(putReq({ 'ai.model': 'gpt-4o' }));
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.ok).toBe(true);
    expect(putBody.data.config['ai.model']).toBe('gpt-4o');

    const get = await GET(getReq());
    const getBody = await get.json();
    expect(getBody.data.config['ai.model']).toBe('gpt-4o');
  });

  it('PUT updates ai.base_url with valid https URL', async () => {
    const put = await PUT(putReq({ 'ai.base_url': 'https://api.openai.com/v1' }));
    expect(put.status).toBe(200);
    const get = await GET(getReq());
    const getBody = await get.json();
    expect(getBody.data.config['ai.base_url']).toBe('https://api.openai.com/v1');
  });

  it('PUT validates bad ai.base_url (no http scheme) → 400', async () => {
    const res = await PUT(putReq({ 'ai.base_url': 'ftp://example.com' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation');
    expect(String(body.error.message)).toMatch(/base_url/);
  });

  it('PUT validates bad value (timeout_ms=10 < 1000) → 400', async () => {
    const res = await PUT(putReq({ 'ai.timeout_ms': '10' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('validation');
    expect(String(body.error.message)).toMatch(/timeout_ms/);
  });

  it('PUT writes an ai_config_updated audit row with secrets masked', async () => {
    const pool = getPool();
    const put = await PUT(putReq({ 'ai.api_key': 'sk-newkey', 'ai.temperature': '0.5' }));
    expect(put.status).toBe(200);
    const [rows] = await pool.query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'ai_config_updated'`,
      [adminId],
    );
    expect(rows.length).toBeGreaterThan(0);
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
    expect(meta).toMatchObject({ 'ai.temperature': '0.5', 'ai.api_key': '***' });
  });
});
