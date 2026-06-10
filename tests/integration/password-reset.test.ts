import { describe, it, expect, beforeAll, vi } from 'vitest';
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
const { POST: forgot } = await import('@/app/api/auth/forgot/route');
const { GET: resetInfo } = await import('@/app/api/auth/reset-info/route');
const { POST: reset } = await import('@/app/api/auth/reset/route');

function makeReq(url: string, body?: any) {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

integrationDescribe('password reset full flow', () => {
  it('forgot → reset-info → reset with valid token logs in user', async () => {
    const username = uniqueUsername('pr');
    const r1 = await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    expect(r1.status).toBe(200);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r2 = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    expect(r2.status).toBe(200);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    expect(m).not.toBeNull();
    const token = m![1];
    consoleSpy.mockRestore();

    const r3 = await resetInfo(makeReq(`http://x/api/auth/reset-info?token=${token}`) as any);
    expect(r3.status).toBe(200);
    const j3 = await r3.json();
    expect(j3.data.username).toBe(username);

    const r4 = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(r4.status).toBe(200);
    expect(r4.headers.get('set-cookie')).toMatch(/auth_token=/);

    const r5 = await login(makeReq('http://x/api/auth/login', { username, password: 'newpassword1' }) as any);
    expect(r5.status).toBe(200);

    const r6 = await login(makeReq('http://x/api/auth/login', { username, password: 'oldpassword1' }) as any);
    expect(r6.status).toBe(401);
  });

  it('token reuse: second reset with same token returns 400', async () => {
    const username = uniqueUsername('pr2');
    await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    const token = m![1];
    consoleSpy.mockRestore();

    const a = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(a.status).toBe(200);
    const b = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword2' }) as any);
    expect(b.status).toBe(400);
  });

  it('expired token: manually expire, then use returns 400', async () => {
    const username = uniqueUsername('pr3');
    const r1 = await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const userId = (await r1.json()).data.user.id;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    const token = m![1];
    consoleSpy.mockRestore();

    const pool = getPool();
    await pool.execute(`UPDATE password_resets SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?`, [userId]);
    const r2 = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(r2.status).toBe(400);
  });

  it('unknown username: forgot returns 200, no row created', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await forgot(makeReq('http://x/api/auth/forgot', { username: 'nobody_here_xxx' }) as any);
    consoleSpy.mockRestore();
    expect(r.status).toBe(200);
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
      ['nobody_here_xxx']);
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  it('rate limit: two forgot in 1 second: second 429', async () => {
    const username = uniqueUsername('pr4');
    await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const b = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    consoleSpy.mockRestore();
    expect(a.status).toBe(200);
    expect(b.status).toBe(429);
  });
});
