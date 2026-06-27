/**
 * Server-only: append a CJK char to one of the user's worksheets.
 *
 * Three modes (mutually exclusive in body):
 *   1. worksheetId  — append to an existing worksheet the user owns
 *   2. newTitle     — find-or-create a worksheet by title for this user
 *   3. neither      — legacy default: find-or-create "我的字帖" (preserves
 *                      prior behavior for any caller that didn't migrate)
 *
 * Concurrency note: this is a read-then-write. Under concurrent appends there's
 * a small window where two "我的字帖" rows could be created for one user.
 * Mitigated by the fact that all callers are browser-initiated user clicks, not
 * bulk jobs. If observed in production, add UNIQUE(user_id, title) via migration.
 */
import { getPool } from './db';

const MY_WORKSHEET_TITLE = '我的字帖';
const DEFAULT_CELL_STYLE = 'brush-square';
const DEFAULT_PAPER_SIZE = 'A4';
const DEFAULT_FONT_FAMILY = 'song';

export interface AppendResult {
  worksheetId: number;
  title: string;
  /** True if the char was new in the worksheet's content; false if already present. */
  added: boolean;
  /** Number of chars in the worksheet AFTER this call. */
  charCount: number;
  /** True if a new worksheet row was created (only when newTitle had no match). */
  created: boolean;
}

export interface AppendArgs {
  char: string;
  worksheetId?: number;
  newTitle?: string;
}

export class WorksheetAccessError extends Error {
  constructor(public code: 'not_found' | 'not_owner', msg?: string) {
    super(msg ?? code);
  }
}

export async function appendCharToWorksheet(
  userId: number,
  args: AppendArgs
): Promise<AppendResult> {
  if (args.worksheetId) {
    return appendById(userId, args.worksheetId, args.char);
  }
  if (args.newTitle) {
    return appendByTitle(userId, args.newTitle, args.char);
  }
  return appendByTitle(userId, MY_WORKSHEET_TITLE, args.char);
}

async function appendById(userId: number, worksheetId: number, char: string): Promise<AppendResult> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content FROM worksheets WHERE id = ? LIMIT 1`,
    [worksheetId]
  );
  if (rows.length === 0) throw new WorksheetAccessError('not_found');
  const ws = rows[0];
  if (ws.user_id !== userId) throw new WorksheetAccessError('not_owner');
  return applyAppend(ws.id, ws.title, ws.content, char, false);
}

async function appendByTitle(userId: number, title: string, char: string): Promise<AppendResult> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, content FROM worksheets WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, title]
  );
  if (rows.length > 0) {
    return applyAppend(rows[0].id, rows[0].title, rows[0].content, char, false);
  }
  const [ins] = await pool.execute<any>(
    `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family)
     VALUES (?, ?, JSON_ARRAY(?), ?, ?, ?)`,
    [userId, title, char, DEFAULT_CELL_STYLE, DEFAULT_PAPER_SIZE, DEFAULT_FONT_FAMILY]
  );
  return {
    worksheetId: ins.insertId as number,
    title,
    added: true,
    charCount: 1,
    created: true,
  };
}

async function applyAppend(
  worksheetId: number,
  title: string,
  contentRaw: unknown,
  char: string,
  created: boolean
): Promise<AppendResult> {
  const pool = getPool();
  const content: string[] = typeof contentRaw === 'string'
    ? JSON.parse(contentRaw)
    : (contentRaw as string[]);
  if (content.includes(char)) {
    return { worksheetId, title, added: false, charCount: content.length, created };
  }
  await pool.execute<any>(
    `UPDATE worksheets SET content = JSON_ARRAY_APPEND(content, '$', ?) WHERE id = ?`,
    [char, worksheetId]
  );
  return { worksheetId, title, added: true, charCount: content.length + 1, created };
}