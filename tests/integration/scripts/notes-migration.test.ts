// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test';

describe('notes migration', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB_URL);
    // Verify table accessible; if migration not run, this throws.
    await conn.query("SELECT id FROM notes LIMIT 1");
  });

  afterAll(async () => { await conn.end(); });

  it('notes table has expected columns', async () => {
    const [cols] = await conn.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM notes");
    const names = (cols as any[]).map((c) => c.Field);
    for (const col of ['id', 'author_user_id', 'author_name', 'author_email', 'content',
                       'ip', 'user_agent', 'created_at', 'deleted_at', 'deleted_by']) {
      expect(names).toContain(col);
    }
  });

  it('notes_rate_limits primary key is composite', async () => {
    const [idx] = await conn.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM notes_rate_limits WHERE Key_name = 'PRIMARY'"
    );
    expect(idx.length).toBe(3);
    const colNames = (idx as any[]).map((i) => i.Column_name).sort();
    expect(colNames).toEqual(['key_value', 'scope', 'window_kind']);
  });

  it('round-trip: insert anon note + soft delete + restore idempotency', async () => {
    const [res] = await conn.query<any>(
      "INSERT INTO notes (author_name, content) VALUES (?, ?)",
      ['TestAnon', '这是一条测试留言']
    );
    const id = res.insertId;
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id, author_name, content FROM notes WHERE id = ?", [id]
    );
    expect((rows as any[])[0].author_name).toBe('TestAnon');

    // Soft delete
    await conn.query("UPDATE notes SET deleted_at = NOW() WHERE id = ?", [id]);
    const [del] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT deleted_at FROM notes WHERE id = ?", [id]
    );
    expect((del as any[])[0].deleted_at).not.toBeNull();

    // Cleanup
    await conn.query("DELETE FROM notes WHERE id = ?", [id]);
  });
});