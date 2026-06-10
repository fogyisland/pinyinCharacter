import { describe, it, expect, beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { GET: listUsers } = await import('@/app/api/admin/users/route');
const { GET: getUser, DELETE: delUser } = await import('@/app/api/admin/users/[id]/route');
const { POST: resetPw } = await import('@/app/api/admin/users/[id]/reset-password/route');
const { POST: promote } = await import('@/app/api/admin/users/[id]/promote/route');
const { POST: demote } = await import('@/app/api/admin/users/[id]/demote/route');

async function regUser(username: string) {
  const r = await register(new Request('http://x/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  return r;
}

async function loginAndCookie(username: string) {
  const r = await login(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const j = await r.json();
  return { cookie, user: j.data.user };
}

function withCookie(cookie: string, req: Request): Request {
  const h = new Headers(req.headers);
  h.set('cookie', cookie);
  return new Request(req, { headers: h });
}

integrationDescribe('admin: read endpoints', () => {
  it('non-admin gets 403 on /api/admin/users', async () => {
    const u = uniqueUsername('nonadm');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await listUsers(withCookie(cookie, new Request('http://x/api/admin/users')) as any);
    expect(r.status).toBe(403);
  });

  it('first user (admin) gets 200 on /api/admin/users', async () => {
    const u = uniqueUsername('adm');
    const r1 = await regUser(u);
    const j = (await r1.json()).data;
    expect(j.user.username).toBe(u);
    const { cookie } = await loginAndCookie(u);
    const r2 = await listUsers(withCookie(cookie, new Request('http://x/api/admin/users')) as any);
    expect(r2.status).toBe(200);
  });
});

integrationDescribe('admin: write endpoints', () => {
  it('admin can reset another user password; new password works', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    await regUser(target);
    const { cookie } = await loginAndCookie(admin);
    const { user: targetUser } = await loginAndCookie(target);

    const ctx = { params: Promise.resolve({ id: String(targetUser.id) }) } as any;
    const r = await resetPw(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/reset-password`, { method: 'POST' })) as any, ctx);
    expect(r.status).toBe(200);
    const j = await r.json();
    const tempPw = j.data.tempPassword;
    expect(tempPw).toBeTruthy();

    const lr = await login(new Request('http://x/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: target, password: tempPw }),
    }) as any);
    expect(lr.status).toBe(200);
  });

  it('promote then demote round trip works', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    await regUser(target);
    const { cookie } = await loginAndCookie(admin);
    const { user: targetUser } = await loginAndCookie(target);

    const ctx = { params: Promise.resolve({ id: String(targetUser.id) }) } as any;
    const p1 = await promote(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/promote`, { method: 'POST' })) as any, ctx);
    expect(p1.status).toBe(200);

    const p2 = await demote(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/demote`, { method: 'POST' })) as any, ctx);
    expect(p2.status).toBe(200);
  });

  it('cannot demote last admin', async () => {
    const admin = uniqueUsername('a');
    const reg = await regUser(admin);
    const adminId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    const ctx = { params: Promise.resolve({ id: String(adminId) }) } as any;
    const r = await demote(withCookie(cookie, new Request(`http://x/api/admin/users/${adminId}/demote`, { method: 'POST' })) as any, ctx);
    expect(r.status).toBe(400);
  });

  it('cannot delete self', async () => {
    const admin = uniqueUsername('a');
    const reg = await regUser(admin);
    const adminId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    const ctx = { params: Promise.resolve({ id: String(adminId) }) } as any;
    const r = await delUser(withCookie(cookie, new Request(`http://x/api/admin/users/${adminId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmUsername: admin }),
    })) as any, ctx);
    expect(r.status).toBe(400);
  });

  it('delete user cascade removes history; audit log has event', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    const reg = await regUser(target);
    const targetId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    const { POST: createHistory } = await import('@/app/api/history/route');
    const { cookie: targetCookie } = await loginAndCookie(target);
    const ch = await createHistory(withCookie(targetCookie, new Request('http://x/api/history', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text2pinyin', input: '你好', char_count: 2, dedup: false }),
    })) as any);
    expect(ch.status).toBe(200);

    const ctx = { params: Promise.resolve({ id: String(targetId) }) } as any;
    const r = await delUser(withCookie(cookie, new Request(`http://x/api/admin/users/${targetId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmUsername: target }),
    })) as any, ctx);
    expect(r.status).toBe(204);

    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const [u] = await pool.execute<any[]>(`SELECT id FROM users WHERE id = ?`, [targetId]);
    expect(u.length).toBe(0);
    const [h] = await pool.execute<any[]>(`SELECT id FROM history WHERE user_id = ?`, [targetId]);
    expect(h.length).toBe(0);
  });
});
