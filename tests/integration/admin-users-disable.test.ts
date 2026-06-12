import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { POST as disable } from '@/app/api/admin/users/[id]/disable/route';
import { POST as enable } from '@/app/api/admin/users/[id]/enable/route';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM audit_log WHERE user_id IN (?)`, [testUserIds]);
  await pool.query(`DELETE FROM users WHERE id IN (?)`, [testUserIds]);
  testUserIds = [];
}

// Test-local cookie store. We pre-populate it with the JWT for the current
// "logged-in" user before each request. This shims Next 15's cookies() (which
// requires a request scope that vitest doesn't provide) with a process-local
// stub. vi.mock is scoped to this file, so other tests are unaffected.
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

function loginAs(token: string) {
  testCookieStore['auth_token'] = { value: token };
}
function logout() {
  delete testCookieStore['auth_token'];
}

/** Insert a user via SQL — bypasses setSessionCookie (which needs Next request scope). */
async function insertUser(username: string, isAdmin = false): Promise<number> {
  const pool = getPool();
  const hash = await hashPassword('longenoughpwd');
  const [res] = await pool.execute<any>(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
    [username, hash, isAdmin ? 1 : 0],
  );
  const id = Number(res.insertId);
  testUserIds.push(id);
  return id;
}

// Conditionally register tests only when DB is configured
const d = HAS_DB ? describe : describe.skip;

d('admin: disable + enable user', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    // Touch the pool to make sure it's open. We don't run initDb() because
    // its auto-populate step hits external network (build-poems/build-sutras)
    // and is unreliable in CI. Tables are pre-created by instrumentation on
    // server start; we just need users + audit_log to exist.
    const pool = getPool();
    await pool.query('SELECT 1');
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closePool();
  });

  it('admin disables a user; disabled_at is set; admin re-enables; disabled_at is null', async () => {
    const adminId = await insertUser('adm_dis_1', true);
    const targetId = await insertUser('vic_dis_1', false);
    const token = await signSession({ id: adminId, username: 'adm_dis_1' });
    loginAs(token);

    // DISABLE
    const ctx = { params: Promise.resolve({ id: String(targetId) }) } as any;
    const r1 = await disable(new Request(`http://x/api/admin/users/${targetId}/disable`, { method: 'POST' }) as any, ctx);
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
    expect(j1.data.disabled).toBe(true);
    expect(j1.data.id).toBe(targetId);

    // disabled_at is now non-null in DB
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(
      `SELECT disabled_at FROM users WHERE id = ?`, [targetId],
    );
    expect(rows[0].disabled_at).not.toBeNull();

    // ENABLE
    const r2 = await enable(new Request(`http://x/api/admin/users/${targetId}/enable`, { method: 'POST' }) as any, ctx);
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.data.disabled).toBe(false);

    const [rows2] = await pool.execute<any[]>(
      `SELECT disabled_at FROM users WHERE id = ?`, [targetId],
    );
    expect(rows2[0].disabled_at).toBeNull();

    // audit_log has user_disabled + user_reenabled events
    const [audit] = await pool.execute<any[]>(
      `SELECT event, metadata FROM audit_log WHERE event IN ('user_disabled','user_reenabled') ORDER BY id ASC`,
    );
    expect(audit.length).toBe(2);
    const events = audit.map((r: any) => r.event);
    expect(events).toContain('user_disabled');
    expect(events).toContain('user_reenabled');
    // mysql2 returns JSON columns as already-parsed objects
    const disabledRow = audit.find((r: any) => r.event === 'user_disabled');
    const disabledMeta = typeof disabledRow.metadata === 'string'
      ? JSON.parse(disabledRow.metadata)
      : disabledRow.metadata;
    expect(disabledMeta.targetUserId).toBe(targetId);

    logout();
  });

  it('non-admin gets 403 on disable', async () => {
    const victimId = await insertUser('vic_403', false);
    const intruderId = await insertUser('noadm_403', false);
    const token = await signSession({ id: intruderId, username: 'noadm_403' });
    loginAs(token);

    const ctx = { params: Promise.resolve({ id: String(victimId) }) } as any;
    const r = await disable(new Request(`http://x/api/admin/users/${victimId}/disable`, { method: 'POST' }) as any, ctx);
    expect(r.status).toBe(403);

    logout();
  });

  it('admin cannot disable themselves', async () => {
    const adminId = await insertUser('adm_self_1', true);
    const token = await signSession({ id: adminId, username: 'adm_self_1' });
    loginAs(token);

    const ctx = { params: Promise.resolve({ id: String(adminId) }) } as any;
    const r = await disable(new Request(`http://x/api/admin/users/${adminId}/disable`, { method: 'POST' }) as any, ctx);
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error.code).toBe('self_disable');

    logout();
  });
});
