// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Mock the AI wrappers BEFORE importing the route.
vi.mock('@/lib/char-ai', () => ({
  generateMeaningZh: vi.fn(async () => '生成的释义: 测试'),
  generateMeaningEn: vi.fn(async () => 'generated meaning: test'),
  generatePinyinAlt: vi.fn(async () => ['yī', 'yí']),
  generateVariants: vi.fn(async () => ['壹']),
  generateEtymologyStory: vi.fn(async () => '生成的字源故事,150-250字之间...'),
  explainChar: vi.fn(),
}));

vi.mock('@/lib/ai-rare-chars', () => ({
  generateRareCharContent: vi.fn(async (input: { char: string }) => ({
    meaning: `罕见字释义 ${input.char}`,
    story: `罕见字故事 ${input.char}`,
  })),
}));

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

import { getPool, closePool } from '../../../lib/db';
import { POST } from '../../../app/api/admin/chars/generate-by-level/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let adminToken: string;
let adminCookie: string;
const TEST_CHARS = ['㐀', '㐁', '㐂', '㐃', '㐄'];

const d = HAS_DB ? describe : describe.skip;

d('admin/chars/generate-by-level', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_batchlvl', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    adminToken = await signSession({ id: adminId, username: 'adm_batchlvl' });
    adminCookie = `auth_token=${adminToken}`;
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    if (TEST_CHARS.length > 0) {
      await pool.query(
        `DELETE FROM chars WHERE \`char\` IN (${TEST_CHARS.map(() => '?').join(',')})`,
        TEST_CHARS,
      );
      await pool.query(
        `DELETE FROM char_etymology WHERE \`char\` IN (${TEST_CHARS.map(() => '?').join(',')})`,
        TEST_CHARS,
      );
    }
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  function postReq(body: object): NextRequest {
    return new NextRequest('http://localhost/api/admin/chars/generate-by-level', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function seedLevel(level: number, chars: string[], withMeaning?: string): Promise<void> {
    const pool = getPool();
    for (const c of chars) {
      await pool.query(
        `INSERT INTO chars (\`char\`, level, pinyin, meaning_zh, unicode_codepoint)
         VALUES (?, ?, 'yà', ?, 'U+20000')`,
        [c, level, withMeaning ?? null],
      );
    }
  }

  it('processes a chunk, returns totalChars/processed/nextOffset', async () => {
    const pool = getPool();
    const [before] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM chars WHERE level = 1`);
    const beforeN = Number(before[0].n);

    await seedLevel(1, TEST_CHARS);

    const res = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: 0,
      limit: 30,
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.totalChars).toBe(beforeN + TEST_CHARS.length);
    expect(body.data.processed).toBe(30);
    expect(body.data.nextOffset).toBe(30);
    expect(body.data.done).toBe(false);

    // The seeded chars should all have meaning_zh now
    const [rows] = await pool.query<any[]>(
      `SELECT \`char\`, meaning_zh FROM chars WHERE \`char\` IN (${TEST_CHARS.map(() => '?').join(',')})`,
      TEST_CHARS,
    );
    for (const r of rows) {
      expect(r.meaning_zh).toBe('生成的释义: 测试');
    }
  });

  it('returns 400 on bad level', async () => {
    const res = await POST(postReq({ level: 99, fields: { meaning_zh: true } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty fields', async () => {
    const res = await POST(postReq({ level: 1, fields: {} }));
    expect(res.status).toBe(400);
  });

  it('returns done=true with processed=0 when offset >= totalChars', async () => {
    const res = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: 999_999,
      limit: 30,
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.done).toBe(true);
    expect(body.data.processed).toBe(0);
  });

  it('walks offset forward across consecutive calls (resume)', async () => {
    const pool = getPool();
    await seedLevel(1, TEST_CHARS);

    const res1 = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: 0,
      limit: 2,
    }));
    const body1 = await res1.json();
    expect(body1.data.processed).toBe(2);
    expect(body1.data.nextOffset).toBe(2);
    expect(body1.data.done).toBe(false);

    const res2 = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: body1.data.nextOffset,
      limit: 2,
    }));
    const body2 = await res2.json();
    expect(body2.data.processed).toBe(2);
    expect(body2.data.nextOffset).toBe(4);
  });

  it('skips chars that already have meaning_zh (does not overwrite)', async () => {
    const pool = getPool();
    await seedLevel(1, [TEST_CHARS[0]], '已有人工释义');

    // Process with a chunk that we know includes our char.
    // Use level=1 with a wide limit so our char is guaranteed to be in the chunk.
    const res = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: 0,
      limit: 30,
    }));
    expect(res.status).toBe(200);

    // Our char's meaning_zh must remain unchanged
    const [rows] = await pool.query<any[]>(
      `SELECT meaning_zh FROM chars WHERE \`char\` = ?`,
      [TEST_CHARS[0]],
    );
    expect(rows[0].meaning_zh).toBe('已有人工释义');
  });

  it('handles concurrency=1 (sequential fallback)', async () => {
    const pool = getPool();
    await seedLevel(1, [TEST_CHARS[0]]);

    const res = await POST(postReq({
      level: 1,
      fields: { meaning_zh: true },
      offset: 0,
      limit: 30,
      concurrency: 1,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [rows] = await pool.query<any[]>(
      `SELECT meaning_zh FROM chars WHERE \`char\` = ?`,
      [TEST_CHARS[0]],
    );
    expect(rows[0].meaning_zh).toBe('生成的释义: 测试');
  });

  it('rare_* fields are no-ops for non-rare chars (no errors)', async () => {
    const pool = getPool();
    await seedLevel(1, TEST_CHARS);

    const res = await POST(postReq({
      level: 1,
      fields: { rare_meaning: true, rare_story: true },
      offset: 0,
      limit: 30,
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.perField.rare_meaning.errors).toEqual([]);
    expect(body.data.perField.rare_story.errors).toEqual([]);
  });

  it('writes pinyin_alt and variants as JSON-encoded strings', async () => {
    const pool = getPool();
    await seedLevel(1, [TEST_CHARS[0]]);

    const res = await POST(postReq({
      level: 1,
      fields: { pinyin_alt: true, variants: true },
      offset: 0,
      limit: 30,
    }));
    expect(res.status).toBe(200);

    const [rows] = await pool.query<any[]>(
      `SELECT pinyin_alt, variants FROM chars WHERE \`char\` = ?`,
      [TEST_CHARS[0]],
    );
    expect(JSON.parse(rows[0].pinyin_alt)).toEqual(['yī', 'yí']);
    expect(JSON.parse(rows[0].variants)).toEqual(['壹']);
  });

  it('writes etymology story to char_etymology', async () => {
    const pool = getPool();
    await seedLevel(1, [TEST_CHARS[0]]);

    const res = await POST(postReq({
      level: 1,
      fields: { etymology_story: true },
      offset: 0,
      limit: 30,
    }));
    expect(res.status).toBe(200);

    const [rows] = await pool.query<any[]>(
      `SELECT story FROM char_etymology WHERE \`char\` = ?`,
      [TEST_CHARS[0]],
    );
    expect(rows[0].story).toMatch(/字源故事/);
  });
});