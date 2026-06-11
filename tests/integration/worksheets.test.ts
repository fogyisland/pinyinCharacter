import { beforeAll } from 'vitest';
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
const { GET: listSheets, POST: createSheet } = await import('@/app/api/worksheets/route');

async function regUser(username: string) {
  return register(new Request('http://x/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
}

async function loginAndCookie(username: string) {
  const r = await login(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { cookie };
}

function withCookie(cookie: string, req: Request): Request {
  const h = new Headers(req.headers);
  h.set('cookie', cookie);
  return new Request(req, { headers: h });
}

integrationDescribe('GET/POST /api/worksheets (integration)', () => {
  it('POST requires auth', async () => {
    const r = await createSheet(new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush' }),
    }) as any);
    expect(r.status).toBe(401);
  });

  it('POST saves and returns id', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My sheet', content: ['你', '好'], cellStyle: 'brush' }),
    })) as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.id).toBeGreaterThan(0);
  });

  it('POST validates empty content', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: [], cellStyle: 'brush' }),
    })) as any);
    expect(r.status).toBe(400);
  });

  it('GET list returns the user worksheets', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'first', content: ['你'], cellStyle: 'brush' }),
    })) as any);
    const r = await listSheets(withCookie(cookie, new Request('http://x/api/worksheets')) as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.worksheets.length).toBeGreaterThanOrEqual(1);
  });
});
