// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

const mockGetPoem = vi.fn();
vi.mock('@/lib/poetry', () => ({
  getPoem: (...args: any[]) => mockGetPoem(...args),
  getRandomPoem: vi.fn(),
  listPoems: vi.fn(),
  listForms: vi.fn(),
  listDynasties: vi.fn(),
  loadManifest: vi.fn(),
  loadPoem: vi.fn(),
  invalidateManifestCache: vi.fn(),
}));

import { getPool, closePool } from '../../../lib/db';
import { POST as printWorksheet } from '../../../app/api/worksheets/[id]/print/route';
import { POST as printPoem } from '../../../app/api/poetry/[id]/print/route';
import { POST as printSutra } from '../../../app/api/sutra/[slug]/print/route';
import { POST as printRareChar } from '../../../app/api/rare-chars/[char]/print/route';
import { signSession } from '../../../lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let userId: number;
let disabledId: number;
let userToken: string;
let userCookie: string;
let disabledToken: string;
let disabledCookie: string;
let worksheetId: number;
let poemId: number;
let sutraSlug: string;
let rareChar: string;

const d = HAS_DB ? describe : describe.skip;

function postReq(path: string, body: object | null, cookie: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: 'POST', headers };
  if (body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost${path}`, init);
}

d('print logging', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');

    // 1 regular user
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_print', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    userToken = await signSession({ id: userId, username: 'usr_print' });
    userCookie = `auth_token=${userToken}`;
    testCookieStore['auth_token'] = { value: userToken };

    // 1 disabled user
    await pool.query(`INSERT INTO users (username, password_hash, disabled_at) VALUES ('usr_print_dis', 'x', NOW())`);
    const [dd] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    disabledId = Number(dd[0].id);
    disabledToken = await signSession({ id: disabledId, username: 'usr_print_dis' });
    disabledCookie = `auth_token=${disabledToken}`;

    // 1 worksheet owned by the regular user
    const [w] = await pool.query<any>(
      `INSERT INTO worksheets (user_id, title, content, cell_style) VALUES (?, ?, ?, 'brush')`,
      [userId, '测试字帖', JSON.stringify(['永', '和', '中'])],
    );
    worksheetId = Number(w.insertId);

    // 1 poem (use a mock — no poems table after Task 5)
    sutraSlug = `xinjing-test-${Date.now()}`;
    rareChar = '禅';
    poemId = 1;
    mockGetPoem.mockResolvedValue({
      id: poemId, title: 'mock title', author: 'X', dynasty: 'tang',
      form: null, content: [], pinyin: [], appreciation: null,
    });

    // 1 sutra with unique slug
    await pool.query(
      `INSERT INTO sutras (title, slug, chunks) VALUES (?, ?, ?)`,
      ['心经测试', sutraSlug, JSON.stringify([{ id: 0, label: '心经', content: ['观自在菩萨'], pinyin: [['guān']] }])],
    );

    // 1 rare char (use a BMP-safe one)
    await pool.query(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story) VALUES (?, 'chán', '禅定', '佛教故事')`,
      [rareChar],
    );
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM downloads WHERE user_id IN (?, ?)`, [userId, disabledId]);
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [userId, disabledId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM worksheets WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM sutras WHERE slug = ?`, [sutraSlug]);
    await pool.query(`DELETE FROM rare_chars WHERE \`char\` = ?`, [rareChar]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [userId, disabledId]);
    await closePool();
  });

  it('all 4 print routes insert a downloads row with the right source_type', async () => {
    const pool = getPool();
    testCookieStore['auth_token'] = { value: userToken };

    // 1) worksheet
    let res = await printWorksheet(
      postReq(`/api/worksheets/${worksheetId}/print`, null, userCookie),
      { params: Promise.resolve({ id: String(worksheetId) }) },
    );
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // 2) poem
    res = await printPoem(
      postReq(`/api/poetry/${poemId}/print`, null, userCookie),
      { params: Promise.resolve({ id: String(poemId) }) },
    );
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // 3) sutra (needs body)
    res = await printSutra(
      postReq(`/api/sutra/${sutraSlug}/print`, { sourceId: `${sutraSlug}#0` }, userCookie),
      { params: Promise.resolve({ slug: sutraSlug }) },
    );
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // 4) rare char (URL-encoded BMP char)
    const enc = encodeURIComponent(rareChar);
    res = await printRareChar(
      postReq(`/api/rare-chars/${enc}/print`, null, userCookie),
      { params: Promise.resolve({ char: enc }) },
    );
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify the 4 downloads rows
    const [rows] = await pool.query<any[]>(
      `SELECT source_type, source_id FROM downloads WHERE user_id = ? AND format = 'print' ORDER BY id`,
      [userId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const types = rows.map((r: any) => r.source_type);
    expect(types).toContain('worksheet');
    expect(types).toContain('poem');
    expect(types).toContain('sutra');
    expect(types).toContain('rare-char-card');
  });

  it('anonymous (no cookie) → 401', async () => {
    // Clear cookie store to simulate anonymous
    delete testCookieStore['auth_token'];
    const res = await printWorksheet(
      postReq(`/api/worksheets/${worksheetId}/print`, null, null),
      { params: Promise.resolve({ id: String(worksheetId) }) },
    );
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthenticated');
    // Restore
    testCookieStore['auth_token'] = { value: userToken };
  });

  it('disabled user → 403 account_disabled', async () => {
    // Swap in the disabled user's token
    testCookieStore['auth_token'] = { value: disabledToken };
    const res = await printWorksheet(
      postReq(`/api/worksheets/${worksheetId}/print`, null, disabledCookie),
      { params: Promise.resolve({ id: String(worksheetId) }) },
    );
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('account_disabled');
    // Restore
    testCookieStore['auth_token'] = { value: userToken };
  });
});
