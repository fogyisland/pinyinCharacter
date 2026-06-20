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
const { GET: getSheet, DELETE: delSheet } = await import('@/app/api/worksheets/[id]/route');

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
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush-cross' }),
    }) as any);
    expect(r.status).toBe(401);
  });

  it('POST saves and returns id', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My sheet', content: ['你', '好'], cellStyle: 'brush-cross' }),
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
      body: JSON.stringify({ title: 't', content: [], cellStyle: 'brush-cross' }),
    })) as any);
    expect(r.status).toBe(400);
  });

  it('saves brush paper size round-trip', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'brush-12 sheet', content: ['你', '好'], cellStyle: 'brush-cross', paperSize: 'brush-12' }),
    })) as any);
    expect(r.status).toBe(200);
    const id = (await r.json()).data.id as number;
    // Read it back via the GET route and confirm paper_size='brush-12' round-trip
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const got = await getSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    const j = await got.json();
    expect(got.status).toBe(200);
    expect(j.data.paperSize).toBe('brush-12');
  });

  it('GET list returns the user worksheets', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'first', content: ['你'], cellStyle: 'brush-cross' }),
    })) as any);
    const r = await listSheets(withCookie(cookie, new Request('http://x/api/worksheets')) as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.worksheets.length).toBeGreaterThanOrEqual(1);
  });
});

integrationDescribe('GET/DELETE /api/worksheets/[id] (integration)', () => {
  it('GET returns the worksheet for its owner', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const created = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush-cross' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await getSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.id).toBe(id);
  });

  it('DELETE removes the worksheet', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const created = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush-cross' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await delSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`, { method: 'DELETE' })) as any, ctx);
    expect(r.status).toBe(204);
    const r2 = await getSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    expect(r2.status).toBe(404);
  });

  it('returns 403 for other user', async () => {
    const u1 = uniqueUsername('ws1');
    const u2 = uniqueUsername('ws2');
    await regUser(u1);
    await regUser(u2);
    const { cookie: c1 } = await loginAndCookie(u1);
    const { cookie: c2 } = await loginAndCookie(u2);
    const created = await createSheet(withCookie(c1, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush-cross' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await getSheet(withCookie(c2, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    expect(r.status).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const ctx = { params: Promise.resolve({ id: '9999999' }) } as any;
    const r = await getSheet(withCookie(cookie, new Request('http://x/api/worksheets/9999999')) as any, ctx);
    expect(r.status).toBe(404);
  });
});
