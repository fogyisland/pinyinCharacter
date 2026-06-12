import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET } from '@/app/api/admin/users/[id]/activity/route';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM audit_log WHERE user_id IN (?)`, [testUserIds]);
  await pool.query(`DELETE FROM downloads WHERE user_id IN (?)`, [testUserIds]);
  await pool.query(`DELETE FROM ai_calls WHERE user_id IN (?)`, [testUserIds]);
  await pool.query(`DELETE FROM users WHERE id IN (?)`, [testUserIds]);
  testUserIds = [];
}

// Test-local cookie store. See admin-users-disable.test.ts for rationale.
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

/** Insert a user via SQL — bypasses setSessionCookie. */
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

const d = HAS_DB ? describe : describe.skip;

d('admin: GET /api/admin/users/[id]/activity', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    // Touch pool; tables pre-exist from instrumentation.
    await getPool().query('SELECT 1');
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closePool();
  });

  it('returns items from all 3 sources (audit, download, ai_call) sorted desc', async () => {
    const adminId = await insertUser('adm_act_1', true);
    const userId = await insertUser('usr_act_1', false);
    const token = await signSession({ id: adminId, username: 'adm_act_1' });
    loginAs(token);

    const pool = getPool();
    await pool.execute(
      `INSERT INTO audit_log (user_id, event) VALUES (?, 'login')`,
      [userId],
    );
    await pool.execute(
      `INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '7')`,
      [userId],
    );
    await pool.execute(
      `INSERT INTO ai_calls (user_id, feature, model, status) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok')`,
      [userId],
    );

    const req = new Request(`http://x/api/admin/users/${userId}/activity`) as any;
    const res = await GET(req, { params: Promise.resolve({ id: String(userId) }) } as any);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(3);

    const sources = new Set(body.data.items.map((i: any) => i.source));
    expect(sources.has('audit')).toBe(true);
    expect(sources.has('download')).toBe(true);
    expect(sources.has('ai_call')).toBe(true);

    // Verify desc sort: each item's createdAt >= the next
    const times = body.data.items.map((i: any) => new Date(i.createdAt).getTime());
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }

    // Verify metadata carried through (download row)
    const dlItem = body.data.items.find((i: any) => i.source === 'download');
    expect(dlItem.metadata.sourceType).toBe('poem');
    expect(dlItem.metadata.format).toBe('print');
    expect(dlItem.metadata.status).toBe('ok');

    // Verify audit row
    const auditItem = body.data.items.find((i: any) => i.source === 'audit');
    expect(auditItem.event).toBe('login');

    // Verify ai_call row
    const aiItem = body.data.items.find((i: any) => i.source === 'ai_call');
    expect(aiItem.event).toBe('rare-char-story');
    expect(aiItem.metadata.model).toBe('gpt-4o-mini');

    logout();
  });

  it('paginates with ?after= timestamp (older cutoff excludes newer rows)', async () => {
    const adminId = await insertUser('adm_act_2', true);
    const userId = await insertUser('usr_act_2', false);
    const token = await signSession({ id: adminId, username: 'adm_act_2' });
    loginAs(token);

    const pool = getPool();
    // Insert one row far in the past (year 2020)
    const [r1] = await pool.execute<any>(
      `INSERT INTO audit_log (user_id, event, created_at) VALUES (?, 'old_event', '2020-01-01 00:00:00')`,
      [userId],
    );
    // Insert one row "now" via default timestamp
    await pool.execute(
      `INSERT INTO audit_log (user_id, event) VALUES (?, 'new_event')`,
      [userId],
    );

    // No `after` → both rows
    const req1 = new Request(`http://x/api/admin/users/${userId}/activity`) as any;
    const res1 = await GET(req1, { params: Promise.resolve({ id: String(userId) }) } as any);
    const body1 = await res1.json();
    expect(body1.data.items.length).toBe(2);

    // With `after=2021-01-01` → only new_event (the 2020 row is filtered out)
    const req2 = new Request(`http://x/api/admin/users/${userId}/activity?after=2021-01-01T00:00:00Z`) as any;
    const res2 = await GET(req2, { params: Promise.resolve({ id: String(userId) }) } as any);
    const body2 = await res2.json();
    expect(body2.data.items.length).toBe(1);
    expect(body2.data.items[0].event).toBe('new_event');

    // With `after=2019-01-01` → both rows (the 2020 row is included)
    const req3 = new Request(`http://x/api/admin/users/${userId}/activity?after=2019-01-01T00:00:00Z`) as any;
    const res3 = await GET(req3, { params: Promise.resolve({ id: String(userId) }) } as any);
    const body3 = await res3.json();
    expect(body3.data.items.length).toBe(2);

    logout();
  });
});
