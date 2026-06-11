import { getPool } from './db';
import { writeAudit } from './audit';

export type CellStyle = 'brush' | 'square';

export interface Cell {
  char: string;
  style: CellStyle;
  index: number;
}

export interface Worksheet {
  id: number;
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  createdAt: Date;
}

export interface SaveWorksheetArgs {
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  ip?: string | null;
  userAgent?: string | null;
}

export type ValidationResult =
  | { ok: true; data: { title: string; content: string[]; cellStyle: CellStyle } }
  | { ok: false; error: string };

const SINGLE_CJK = /^[一-鿿]$/;

export function generateLayout(content: string[], style: CellStyle): Cell[] {
  return content.map((char, index) => ({ char, style, index }));
}

export function validateWorksheetInput(input: {
  title: unknown;
  content: unknown;
  cellStyle: unknown;
}): ValidationResult {
  if (typeof input.title !== 'string' || input.title.length < 1 || input.title.length > 80) {
    return { ok: false, error: 'title must be 1-80 chars' };
  }
  if (!Array.isArray(input.content) || input.content.length < 1 || input.content.length > 500) {
    return { ok: false, error: 'content must be 1-500 chars' };
  }
  if (!input.content.every((c) => typeof c === 'string' && SINGLE_CJK.test(c))) {
    return { ok: false, error: 'content must be CJK chars' };
  }
  if (input.cellStyle !== 'brush' && input.cellStyle !== 'square') {
    return { ok: false, error: 'cellStyle must be brush or square' };
  }
  return {
    ok: true,
    data: { title: input.title, content: input.content as string[], cellStyle: input.cellStyle },
  };
}

export async function saveWorksheet(args: SaveWorksheetArgs): Promise<number> {
  const pool = getPool();
  const [result] = await pool.execute<any>(
    `INSERT INTO worksheets (user_id, title, content, cell_style) VALUES (?, ?, ?, ?)`,
    [args.userId, args.title, JSON.stringify(args.content), args.cellStyle]
  );
  const id = result.insertId as number;
  await writeAudit({
    userId: args.userId,
    event: 'worksheet_saved',
    metadata: { worksheetId: id, charCount: args.content.length, cellStyle: args.cellStyle },
    ip: args.ip,
    userAgent: args.userAgent,
  });
  return id;
}

export async function listUserWorksheets(userId: number): Promise<Worksheet[]> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map(mapRow);
}

export async function getWorksheet(id: number): Promise<Worksheet | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, created_at
     FROM worksheets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function deleteWorksheet(id: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.execute<any>(
    `DELETE FROM worksheets WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  const affected = (result.affectedRows as number) ?? 0;
  if (affected > 0) {
    await writeAudit({ userId, event: 'worksheet_deleted', metadata: { worksheetId: id } });
  }
  return affected > 0;
}

function mapRow(r: any): Worksheet {
  let content: string[];
  if (typeof r.content === 'string') {
    content = JSON.parse(r.content);
  } else {
    content = r.content;
  }
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content,
    cellStyle: r.cell_style,
    createdAt: r.created_at,
  };
}
