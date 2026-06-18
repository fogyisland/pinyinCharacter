/**
 * Server-only: find-or-create "我的字帖" worksheet for a user and append a char.
 *
 * Concurrency note: this is a read-then-write. Under concurrent appends there's
 * a small window where two "我的字帖" rows could be created for one user.
 * Mitigated by the fact that all callers are browser-initiated user clicks, not
 * bulk jobs. If observed in production, add UNIQUE(user_id, title) via migration.
 */
import { getPool } from './db';

const MY_WORKSHEET_TITLE = '我的字帖';
const DEFAULT_CELL_STYLE = 'brush';
const DEFAULT_PAPER_SIZE = 'A4';
const DEFAULT_FONT_FAMILY = 'song';

export interface AppendResult {
  worksheetId: number;
  added: boolean;
}

export async function appendCharToMyWorksheet(userId: number, char: string): Promise<AppendResult> {
  const pool = getPool();

  const [rows] = await pool.query<any[]>(
    `SELECT id, content FROM worksheets WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, MY_WORKSHEET_TITLE]
  );

  if (rows.length === 0) {
    const [ins] = await pool.execute<any>(
      `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family)
       VALUES (?, ?, JSON_ARRAY(?), ?, ?, ?)`,
      [userId, MY_WORKSHEET_TITLE, char, DEFAULT_CELL_STYLE, DEFAULT_PAPER_SIZE, DEFAULT_FONT_FAMILY]
    );
    return { worksheetId: ins.insertId as number, added: true };
  }

  const worksheet = rows[0];
  const content: string[] = typeof worksheet.content === 'string'
    ? JSON.parse(worksheet.content)
    : worksheet.content;

  if (content.includes(char)) {
    return { worksheetId: worksheet.id, added: false };
  }

  await pool.execute<any>(
    `UPDATE worksheets SET content = JSON_ARRAY_APPEND(content, '$', ?) WHERE id = ?`,
    [char, worksheet.id]
  );
  return { worksheetId: worksheet.id, added: true };
}
