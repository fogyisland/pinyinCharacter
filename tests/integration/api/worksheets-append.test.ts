import { beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv, truncateAll } from '../setup';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: append } = await import('@/app/api/worksheets/append/route');
import { afterEach } from 'vitest';

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

integrationDescribe('POST /api/worksheets/append (integration)', () => {
  afterEach(async () => { await truncateAll(); });

  it('rejects unauthenticated request with 401', async () => {
    const r = await append(new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    }) as any);
    expect(r.status).toBe(401);
  });

  it('rejects non-CJK char with 400', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我我' }),
    })) as any);
    expect(r.status).toBe(400);
  });

  it('first append creates 我的字帖 and returns added=true', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.added).toBe(true);
    expect(j.data.worksheetId).toBeGreaterThan(0);
  });

  it('appending different chars preserves order', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r1 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const j1 = await r1.json();
    const r2 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '你' }),
    })) as any);
    const j2 = await r2.json();

    expect(j1.data.worksheetId).toBe(j2.data.worksheetId);
    expect(j2.data.added).toBe(true);

    const { getPool } = await import('@/lib/db');
    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [j2.data.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我', '你']);
  });

  it('appending same char twice returns added=false second time', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const r2 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const j2 = await r2.json();
    expect(j2.data.added).toBe(false);
  });
});
