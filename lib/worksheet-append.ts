/**
 * Server-only: append a CJK char to one of the user's worksheets.
 *
 * Three modes (mutually exclusive in body):
 *   1. worksheetId  — append to an existing worksheet the user owns
 *   2. newTitle     — find-or-create a worksheet by title for this user
 *   3. neither      — find-or-create "默认字帖" — the user's default
 *                      worksheet. Auto-created on first add. Subsequent
 *                      single-char adds go to the same one. Rename freely.
 *
 * Concurrency note: this is a read-then-write. Under concurrent appends there's
 * a small window where two "默认字帖" rows could be created for one user.
 * Mitigated by the fact that all callers are browser-initiated user clicks, not
 * bulk jobs. If observed in production, add UNIQUE(user_id, title) via migration.
 */
import { getPool } from './db';

const DEFAULT_WORKSHEET_TITLE = '默认字帖';
const DEFAULT_CELL_STYLE = 'brush-square';
const DEFAULT_PAPER_SIZE = 'A4';
const DEFAULT_FONT_FAMILY = 'song';

export interface AppendResult {
  worksheetId: number;
  title: string;
  /** True if any char was newly added; false if all were already present. */
  added: boolean;
  /** Number of chars newly appended in this call. */
  addedCount: number;
  /** Number of chars skipped (already in worksheet). */
  skipped: number;
  /** Number of chars in the worksheet AFTER this call. */
  charCount: number;
  /** True if a new worksheet row was created (only when newTitle had no match). */
  created: boolean;
}

export interface AppendArgs {
  /** Single char (right-click "add this char"). Use either char OR chars, not both. */
  char?: string;
  /** Multiple chars (generator "append to existing" flow). */
  chars?: string[];
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
  const chars = normalizeChars(args);
  if (args.worksheetId) {
    return appendById(userId, args.worksheetId, chars);
  }
  if (args.newTitle) {
    return appendByTitle(userId, args.newTitle, chars);
  }
  return appendByTitle(userId, DEFAULT_WORKSHEET_TITLE, chars);
}

function normalizeChars(args: AppendArgs): string[] {
  if (args.chars && args.chars.length > 0) return args.chars;
  if (args.char) return [args.char];
  throw new Error('appendCharToWorksheet: char or chars required');
}

async function appendById(userId: number, worksheetId: number, chars: string[]): Promise<AppendResult> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content FROM worksheets WHERE id = ? LIMIT 1`,
    [worksheetId]
  );
  if (rows.length === 0) throw new WorksheetAccessError('not_found');
  const ws = rows[0];
  if (ws.user_id !== userId) throw new WorksheetAccessError('not_owner');
  return applyAppend(ws.id, ws.title, ws.content, chars, false);
}

async function appendByTitle(userId: number, title: string, chars: string[]): Promise<AppendResult> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, content FROM worksheets WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, title]
  );
  if (rows.length > 0) {
    return applyAppend(rows[0].id, rows[0].title, rows[0].content, chars, false);
  }
  // Brand new worksheet: store all chars at once via JSON_ARRAY of N elements.
  const [ins] = await pool.execute<any>(
    `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family)
     VALUES (?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [userId, title, JSON.stringify(chars), DEFAULT_CELL_STYLE, DEFAULT_PAPER_SIZE, DEFAULT_FONT_FAMILY]
  );
  return {
    worksheetId: ins.insertId as number,
    title,
    added: true,
    addedCount: chars.length,
    skipped: 0,
    charCount: chars.length,
    created: true,
  };
}

async function applyAppend(
  worksheetId: number,
  title: string,
  contentRaw: unknown,
  chars: string[],
  created: boolean
): Promise<AppendResult> {
  const pool = getPool();
  const content: string[] = typeof contentRaw === 'string'
    ? JSON.parse(contentRaw)
    : (contentRaw as string[]);
  const existing = new Set(content);
  const toAdd = chars.filter((c) => !existing.has(c));
  if (toAdd.length === 0) {
    return {
      worksheetId, title, added: false, addedCount: 0, skipped: chars.length,
      charCount: content.length, created,
    };
  }
  if (toAdd.length === 1) {
    await pool.execute<any>(
      `UPDATE worksheets SET content = JSON_ARRAY_APPEND(content, '$', ?) WHERE id = ?`,
      [toAdd[0], worksheetId]
    );
  } else {
    // Bulk path: rebuild content as existing + toAdd, write as JSON.
    const merged = [...content, ...toAdd];
    await pool.execute<any>(
      `UPDATE worksheets SET content = CAST(? AS JSON) WHERE id = ?`,
      [JSON.stringify(merged), worksheetId]
    );
  }
  return {
    worksheetId, title, added: true, addedCount: toAdd.length,
    skipped: chars.length - toAdd.length,
    charCount: content.length + toAdd.length, created,
  };
}