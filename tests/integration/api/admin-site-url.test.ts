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
import { GET, PATCH } from '../../../app/api/admin/site-url/route';
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

d('admin/site-url', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    // ensure env fallback resolves to a known value
    process.env.NEXT_PUBLIC_SITE_URL = 'https://env.example.com';
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`DELETE FROM app_config WHERE \`key\` = 'site.url'`);
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_siteurl', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_siteurl', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    adminToken = await signSession({ id: adminId, username: 'adm_siteurl' });
    userToken = await signSession({ id: userId, username: 'usr_siteurl' });
    adminCookie = `auth_token=${adminToken}`;
    userCookie = `auth_token=${userToken}`;
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` = 'site.url'`);
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (?, ?) AND event = 'site_url_updated'`, [adminId, userId]);
    // restore admin session for next test
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` = 'site.url'`);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  function getReq(cookie = adminCookie): NextRequest {
    return new NextRequest('http://localhost/api/admin/site-url', { headers: { cookie } });
  }
  function patchReq(body: object, cookie = adminCookie): NextRequest {
    return new NextRequest('http://localhost/api/admin/site-url', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('GET requires admin (401 without auth)', async () => {
    const res = await GET(getReq(''));
    expect(res.status).toBe(401);
  });

  it('GET requires admin (403 for non-admin)', async () => {
    const res = await GET(getReq(userCookie));
    expect(res.status).toBe(403);
  });

  it('GET returns env fallback with source=env when app_config is empty', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.source).toBe('env');
    expect(body.data.url).toBe('https://env.example.com');
  });

  it('GET returns app_config value with source=app_config when set', async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES ('site.url', 'https://override.example.com/')`);
    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.source).toBe('app_config');
    // trailing slash stripped
    expect(body.data.url).toBe('https://override.example.com');
  });

  it('PATCH with invalid URL returns 400', async () => {
    const res = await PATCH(patchReq({ url: 'ftp://nope' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('validation');
  });

  it('PATCH with non-http URL returns 400', async () => {
    const res = await PATCH(patchReq({ url: 'example.com' }));
    expect(res.status).toBe(400);
  });

  it('PATCH with valid URL writes to app_config and returns 200', async () => {
    const res = await PATCH(patchReq({ url: 'https://pinyin.example.com/' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://pinyin.example.com');
    expect(body.data.source).toBe('app_config');

    const pool = getPool();
    const [rows] = await pool.query<any[]>(`SELECT value FROM app_config WHERE \`key\` = 'site.url'`);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe('https://pinyin.example.com/');

    // GET should now report the override
    const get = await GET(getReq());
    const getBody = await get.json();
    expect(getBody.data.source).toBe('app_config');
    expect(getBody.data.url).toBe('https://pinyin.example.com');
  });

  it('PATCH writes a site_url_updated audit row', async () => {
    const pool = getPool();
    await PATCH(patchReq({ url: 'https://audit.example.com' }));
    const [rows] = await pool.query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'site_url_updated' ORDER BY id DESC LIMIT 1`,
      [adminId],
    );
    expect(rows.length).toBeGreaterThan(0);
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
    expect(meta.url).toBe('https://audit.example.com');
  });

  it('PATCH requires admin (401 without auth)', async () => {
    const res = await PATCH(patchReq({ url: 'https://x.com' }, ''));
    expect(res.status).toBe(401);
  });
});
