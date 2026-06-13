// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (SELECT \`char\` FROM chars WHERE pinyin LIKE 'covtest%')`);
  await pool.query(`DELETE FROM chars WHERE pinyin LIKE 'covtest%'`);
  await pool.query(`DELETE FROM users WHERE id IN (?)`, [testUserIds]);
  testUserIds = [];
}

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

d('admin: GET /api/admin/chars/coverage', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    await getPool().query('SELECT 1');
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closePool();
  });

  it('returns coverage stats (admin only)', async () => {
    const adminId = await insertUser('adm_cov_1', true);
    const token = await signSession({ id: adminId, username: 'adm_cov_1' });
    loginAs(token);

    const pool = getPool();
    // use a pinyin-prefix marker so cleanup is deterministic
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('一', 1, 'covtest-yi', '一', 1, 'U+4E00')`
    );
    await pool.execute(`INSERT INTO char_etymology (\`char\`, story) VALUES ('一', 'story')`);

    const { GET } = await import('@/app/api/admin/chars/coverage/route');
    const r = await GET(new Request('http://x/api/admin/chars/coverage') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.totalChars).toBeGreaterThanOrEqual(1);
    expect(j.data.charsWithEtymology).toBeGreaterThanOrEqual(1);
    expect(typeof j.data.coveragePct).toBe('number');

    logout();
  });

  it('403 when not admin', async () => {
    const userId = await insertUser('usr_cov_1', false);
    const token = await signSession({ id: userId, username: 'usr_cov_1' });
    loginAs(token);

    const { GET } = await import('@/app/api/admin/chars/coverage/route');
    const r = await GET(new Request('http://x/api/admin/chars/coverage') as any);
    expect(r.status).toBe(403);

    logout();
  });
});
