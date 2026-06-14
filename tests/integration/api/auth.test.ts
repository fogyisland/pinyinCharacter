import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { integrationDescribe, installTestEnv, uniqueUsername, truncateAll } from '../setup';

installTestEnv();
integrationDescribe('POST /api/auth/register', () => {
  function makeReq(body: unknown) {
    return new Request('http://x/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as any;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    getPool();
  });

  afterAll(async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    await truncateAll();
    await closePool();
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    await truncateAll();
  });

  it('persists email when registration succeeds', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { POST: register } = await import('@/app/api/auth/register/route');
    const username = uniqueUsername('plann_email');
    const r = await register(makeReq({
      username,
      email: 'planN@example.com',
      password: 'password123',
    }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);

    const pool = getPool();
    const [rows] = await pool.query<any[]>(`SELECT email FROM users WHERE username = ?`, [username]);
    expect(rows[0]?.email).toBe('planN@example.com');
  });

  it('rejects invalid email format', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { POST: register } = await import('@/app/api/auth/register/route');
    const username = uniqueUsername('plann_bademail');
    const r = await register(makeReq({
      username,
      email: 'not-an-email',
      password: 'password123',
    }));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error?.code).toBe('bad_input');
  });

  it('rejects missing email', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { POST: register } = await import('@/app/api/auth/register/route');
    const username = uniqueUsername('plann_noemail');
    const r = await register(makeReq({
      username,
      password: 'password123',
    }));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error?.code).toBe('bad_input');
  });

  it('rejects duplicate email', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { POST: register } = await import('@/app/api/auth/register/route');
    const u1 = uniqueUsername('plann_dup_a');
    const u2 = uniqueUsername('plann_dup_b');
    const r1 = await register(makeReq({ username: u1, email: 'dup@x.com', password: 'password123' }));
    expect(r1.status).toBe(200);
    const r2 = await register(makeReq({ username: u2, email: 'dup@x.com', password: 'password456' }));
    expect(r2.status).toBe(409);
    const j2 = await r2.json();
    expect(j2.error?.code).toBe('email_taken');
  });
});
