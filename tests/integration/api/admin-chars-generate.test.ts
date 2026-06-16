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
import { POST } from '../../../app/api/admin/chars/generate/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let adminId: number;
let adminToken: string;
let adminCookie: string;
const TEST_CHARS = ['亜', '亟', '乜'];
const TEST_RARE_CHARS = ['龘', '靐', '齉'];

const d = HAS_DB ? describe : describe.skip;

d('admin/chars/generate', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_chargen', 'x', 1)`);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    adminToken = await signSession({ id: adminId, username: 'adm_chargen' });
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
    if (TEST_RARE_CHARS.length > 0) {
      await pool.query(
        `DELETE FROM rare_chars WHERE \`char\` IN (${TEST_RARE_CHARS.map(() => '?').join(',')})`,
        TEST_RARE_CHARS,
      );
    }
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  function postReq(body: object): NextRequest {
    return new NextRequest('http://localhost/api/admin/chars/generate', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('generates meaning_zh for a fresh char', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, 3, 'yà', 'U+4E9C')`,
      ['亜'],
    );

    const res = await POST(postReq({ chars: ['亜'], fields: { meaning_zh: true } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.perField.meaning_zh.generated).toBe(1);
    expect(body.data.perField.meaning_zh.skipped).toBe(0);

    const [rows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = ?`, ['亜']);
    expect(rows[0].meaning_zh).toBe('生成的释义: 测试');
  });

  it('skips char that already has meaning_zh', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO chars (\`char\`, level, pinyin, meaning_zh, unicode_codepoint) VALUES (?, 3, 'jí', '已有人工释义', 'U+4E7E')`,
      ['亟'],
    );

    const res = await POST(postReq({ chars: ['亟'], fields: { meaning_zh: true } }));
    const body = await res.json();
    expect(body.data.perField.meaning_zh.skipped).toBe(1);
    expect(body.data.perField.meaning_zh.generated).toBe(0);

    const [rows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = ?`, ['亟']);
    expect(rows[0].meaning_zh).toBe('已有人工释义');
  });

  it('generates rare_char meaning + story', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story) VALUES (?, 'dá', '', '')`,
      ['龘'],
    );

    const res = await POST(postReq({ chars: ['龘'], fields: { rare_meaning: true, rare_story: true } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.perField.rare_meaning.generated).toBe(1);
    expect(body.data.perField.rare_story.generated).toBe(1);

    const [rows] = await pool.query<any[]>(
      `SELECT meaning, story FROM rare_chars WHERE \`char\` = ?`,
      ['龘'],
    );
    expect(rows[0].meaning).toBe('罕见字释义 龘');
    expect(rows[0].story).toBe('罕见字故事 龘');
  });

  it('returns 400 when no fields selected', async () => {
    const res = await POST(postReq({ chars: ['亜'], fields: {} }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns error per field for char not in chars table', async () => {
    const res = await POST(postReq({ chars: ['龥'], fields: { meaning_zh: true } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.perField.meaning_zh.generated).toBe(0);
    expect(body.data.perField.meaning_zh.errors.length).toBe(1);
    expect(body.data.perField.meaning_zh.errors[0].char).toBe('龥');
    expect(body.data.perField.meaning_zh.errors[0].message).toMatch(/not in chars/);
  });

  it('writes pinyin_alt + variants as JSON-encoded strings', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, 3, 'miē', 'U+4E5C')`,
      ['乜'],
    );

    const res = await POST(postReq({ chars: ['乜'], fields: { pinyin_alt: true, variants: true } }));
    const body = await res.json();
    expect(body.data.perField.pinyin_alt.generated).toBe(1);
    expect(body.data.perField.variants.generated).toBe(1);

    const [rows] = await pool.query<any[]>(
      `SELECT pinyin_alt, variants FROM chars WHERE \`char\` = ?`,
      ['乜'],
    );
    expect(JSON.parse(rows[0].pinyin_alt)).toEqual(['yī', 'yí']);
    expect(JSON.parse(rows[0].variants)).toEqual(['壹']);
  });

  it('skips rare char that already has meaning', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story) VALUES (?, 'bìng', '已有释义', '')`,
      ['靐'],
    );

    const res = await POST(postReq({ chars: ['靐'], fields: { rare_meaning: true } }));
    const body = await res.json();
    expect(body.data.perField.rare_meaning.skipped).toBe(1);

    const [rows] = await pool.query<any[]>(`SELECT meaning FROM rare_chars WHERE \`char\` = ?`, ['靐']);
    expect(rows[0].meaning).toBe('已有释义');
  });
});