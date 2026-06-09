import { describe, expect, beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';
import { getPool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');

function makeReq(body?: any) {
  return new Request('http://x/api/auth/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

integrationDescribe('POST /api/auth/register', () => {
  it('rejects too-short username', async () => {
    const r = await register(makeReq({ username: 'ab', password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(400);
  });

  it('rejects too-short password', async () => {
    const r = await register(makeReq({ username: 'validuser', password: 'short' }) as any);
    expect(r.status).toBe(400);
  });

  it('creates first user as admin and sets cookie', async () => {
    const username = uniqueUsername('first');
    const r = await register(makeReq({ username, password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.user.username).toBe(username);
    expect(r.headers.get('set-cookie')).toMatch(/auth_token=/);

    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT is_admin FROM users WHERE id = ?`, [j.data.user.id]);
    expect(Number(rows[0]?.is_admin)).toBe(1);
  });

  it('second user is not admin', async () => {
    await register(makeReq({ username: uniqueUsername('a'), password: 'longenoughpwd' }) as any);
    const r2 = await register(makeReq({ username: uniqueUsername('b'), password: 'longenoughpwd' }) as any);
    const j2 = await r2.json();
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT is_admin FROM users WHERE id = ?`, [j2.data.user.id]);
    expect(Number(rows[0]?.is_admin)).toBe(0);
  });

  it('returns 409 on duplicate username', async () => {
    const username = uniqueUsername('dup');
    const r1 = await register(makeReq({ username, password: 'longenoughpwd' }) as any);
    expect(r1.status).toBe(200);
    const r2 = await register(makeReq({ username, password: 'longenoughpwd' }) as any);
    expect(r2.status).toBe(409);
  });
});

integrationDescribe('POST /api/auth/login', () => {
  it('returns 401 on bad password', async () => {
    const username = uniqueUsername('login');
    await register(makeReq({ username, password: 'longenoughpwd' }) as any);
    const r = await login(makeReq({ username, password: 'wrongwrong' }) as any);
    expect(r.status).toBe(401);
  });

  it('returns 200 + cookie on good credentials', async () => {
    const username = uniqueUsername('login');
    await register(makeReq({ username, password: 'longenoughpwd' }) as any);
    const r = await login(makeReq({ username, password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/auth_token=/);
  });
});
