import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';
import { appendCharToMyWorksheet } from '@/lib/worksheet-append';
import { createHash, randomBytes } from 'node:crypto';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

function uniqueUser(): string {
  return 'u_' + createHash('sha256').update(randomBytes(8)).digest('hex').slice(0, 12);
}

async function insertUser(username: string): Promise<number> {
  const pool = getPool();
  const [r] = await pool.execute<any>(
    `INSERT INTO users (username, password_hash) VALUES (?, 'x')`,
    [username]
  );
  return r.insertId as number;
}

const d = HAS_DB ? describe : describe.skip;

d('appendCharToMyWorksheet', () => {
  beforeAll(async () => {
    if (!HAS_DB) return;
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    await initDb();
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await closePool();
  });

  it('first call creates 我的字帖 and returns added=true', async () => {
    const uid = await insertUser(uniqueUser());
    const r = await appendCharToMyWorksheet(uid, '我');
    expect(r.added).toBe(true);
    expect(r.worksheetId).toBeGreaterThan(0);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我']);
  });

  it('second call with different char appends and returns added=true', async () => {
    const uid = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(uid, '我');
    const r2 = await appendCharToMyWorksheet(uid, '你');
    expect(r2.added).toBe(true);
    expect(r2.worksheetId).toBe(r1.worksheetId);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r1.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我', '你']);
  });

  it('same char again returns added=false, content unchanged', async () => {
    const uid = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(uid, '我');
    const r2 = await appendCharToMyWorksheet(uid, '我');
    expect(r2.added).toBe(false);
    expect(r2.worksheetId).toBe(r1.worksheetId);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r1.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我']);
  });

  it('two users each get their own 我的字帖', async () => {
    const u1 = await insertUser(uniqueUser());
    const u2 = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(u1, '我');
    const r2 = await appendCharToMyWorksheet(u2, '你');
    expect(r1.worksheetId).not.toBe(r2.worksheetId);

    const [all] = await getPool().query<any[]>(
      `SELECT user_id, title FROM worksheets WHERE title = '我的字帖' AND user_id IN (?, ?)`,
      [u1, u2]
    );
    expect(all).toHaveLength(2);
  });
});
