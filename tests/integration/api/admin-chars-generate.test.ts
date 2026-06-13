// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';

// Mock the AI wrapper BEFORE importing the route
vi.mock('@/lib/char-ai', () => ({
  generateEtymologyStory: vi.fn().mockResolvedValue('mocked story'),
}));

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (SELECT \`char\` FROM chars WHERE pinyin LIKE 'gentest%')`);
  await pool.query(`DELETE FROM chars WHERE pinyin LIKE 'gentest%'`);
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

d('admin: POST /api/admin/chars/generate', () => {
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

  it('generates story for a single char', async () => {
    const adminId = await insertUser('adm_gen_1', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_1' });
    loginAs(token);

    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, meaning_zh) VALUES ('一', 1, 'gentest-yi', '一', 1, 'U+4E00', '数目字')`
    );

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: ['一'] }),
    }) as any;
    const r = await POST(req);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.generated).toBe(1);

    const [rows] = await pool.query<any[]>(`SELECT story FROM char_etymology WHERE \`char\` = '一'`);
    expect(rows[0].story).toBe('mocked story');

    logout();
  });

  it('skips chars already in char_etymology with story', async () => {
    const adminId = await insertUser('adm_gen_2', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_2' });
    loginAs(token);

    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, meaning_zh) VALUES ('丁', 1, 'gentest-ding', '一', 2, 'U+4E01', '天干第四位')`
    );
    await pool.execute(`INSERT INTO char_etymology (\`char\`, story) VALUES ('丁', 'existing')`);

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: ['丁'] }),
    }) as any;
    const r = await POST(req);
    const j = await r.json();
    expect(j.data.skipped).toBe(1);
    expect(j.data.generated).toBe(0);

    logout();
  });

  it('400 on empty chars array', async () => {
    const adminId = await insertUser('adm_gen_3', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_3' });
    loginAs(token);

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: [] }),
    }) as any;
    const r = await POST(req);
    expect(r.status).toBe(400);

    logout();
  });
});
