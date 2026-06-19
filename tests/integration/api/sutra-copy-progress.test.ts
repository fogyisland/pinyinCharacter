// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

import { getPool, closePool } from '@/lib/db';
import { GET, POST } from '@/app/api/sutra/[slug]/copy-progress/route';
import { signSession } from '@/lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

let userId: number;
let userToken: string;
let sutraSlug: string;

function req(method: string, path: string, body: object | null = null, cookie: string | null = userToken): NextRequest {
  const headers: Record<string, string> = { cookie: `auth_token=${cookie}` };
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://test${path}`, init);
}

function anonReq(method: string, path: string, body: object | null = null): NextRequest {
  const headers: Record<string, string> = {};
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://test${path}`, init);
}

d('sutra copy-progress API', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');

    await pool.query(`DELETE FROM users WHERE username = 'usr_copy'`);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_copy', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    userToken = await signSession({ id: userId, username: 'usr_copy' });
    testCookieStore['auth_token'] = { value: userToken };

    await pool.query(`DELETE FROM sutra_copy_progress WHERE user_id = ?`, [userId]);

    await pool.query(`DELETE FROM sutras WHERE slug = 'copytest'`);
    const [s] = await pool.query<any>(
      `INSERT INTO sutras (title, slug, chunks) VALUES (?, ?, ?)`,
      ['抄经测试', 'copytest', JSON.stringify([
        { id: 0, label: '全段', content: ['观自在菩萨', '行深般若波罗蜜多时'], pinyin: [] },
      ])]
    );
    sutraSlug = 'copytest';
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM sutras WHERE slug = 'copytest'`);
    await pool.query(`DELETE FROM users WHERE username = 'usr_copy'`);
    await closePool();
  });

  it('GET 401 anonymous', async () => {
    delete testCookieStore['auth_token'];
    const r = await GET(anonReq('GET', `/api/sutra/${sutraSlug}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(401);
    testCookieStore['auth_token'] = { value: userToken };
  });

  it('POST 401 anonymous', async () => {
    delete testCookieStore['auth_token'];
    const r = await POST(anonReq('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 0, writtenChars: [true] }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(401);
    testCookieStore['auth_token'] = { value: userToken };
  });

  it('GET 200 with progress=null for fresh user', async () => {
    const r = await GET(req('GET', `/api/sutra/${sutraSlug}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.progress).toBeNull();
  });

  it('POST 200 upserts; subsequent GET returns same array', async () => {
    const r1 = await POST(req('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 0, writtenChars: [true, false, true, true] }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r1.status).toBe(200);
    const r2 = await GET(req('GET', `/api/sutra/${sutraSlug}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    const body = await r2.json();
    expect(body.data.progress.writtenChars).toEqual([true, false, true, true]);
    expect(body.data.progress.completedAt).toBeNull();
  });

  it('POST 400 on out-of-range chunkIdx', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 99, writtenChars: [true] }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(400);
  });

  it('POST 400 on non-array writtenChars', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 0, writtenChars: 'nope' }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(400);
  });

  it('POST with completed=true sets completed_at when all true', async () => {
    await POST(req('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 0, writtenChars: [true, true, true, true], completed: true }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    const r = await GET(req('GET', `/api/sutra/${sutraSlug}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    const body = await r.json();
    expect(body.data.progress.completedAt).not.toBeNull();
  });

  it('POST reset=true deletes the row', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraSlug}/copy-progress`, { chunkIdx: 0, reset: true }) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    expect(r.status).toBe(200);
    const r2 = await GET(req('GET', `/api/sutra/${sutraSlug}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ slug: sutraSlug }) });
    const body = await r2.json();
    expect(body.data.progress).toBeNull();
  });
});
