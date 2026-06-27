import { getPool } from './db';
import { writeAudit } from './audit';
import type { PaperSize, FontFamily, SaveWorksheetArgs, Worksheet } from './worksheet-types';

export * from './worksheet-types';

export async function saveWorksheet(args: SaveWorksheetArgs): Promise<number> {
  const pool = getPool();
  const [result] = await pool.execute<any>(
    `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family) VALUES (?, ?, ?, ?, ?, ?)`,
    [args.userId, args.title, JSON.stringify(args.content), args.cellStyle, args.paperSize, args.fontFamily]
  );
  const id = result.insertId as number;
  await writeAudit({
    userId: args.userId,
    event: 'worksheet_saved',
    metadata: { worksheetId: id, charCount: args.content.length, cellStyle: args.cellStyle, paperSize: args.paperSize, fontFamily: args.fontFamily },
    ip: args.ip,
    userAgent: args.userAgent,
  });
  return id;
}

export async function listUserWorksheets(userId: number): Promise<Worksheet[]> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, paper_size, font_family, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map(mapRow);
}

export interface WorksheetSummary {
  id: number;
  title: string;
  /** Char count from JSON_LENGTH(content) — no row data shipped. */
  charCount: number;
  createdAt: Date;
}

/**
 * Lightweight list for selectors/dialogs: id, title, charCount, createdAt only.
 * Skips content/paperSize/fontFamily to keep payload small when the user
 * has many worksheets with 500-char content each.
 */
export async function listUserWorksheetsLightweight(userId: number): Promise<WorksheetSummary[]> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, JSON_LENGTH(content) AS char_count, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    charCount: Number(r.char_count ?? 0),
    createdAt: r.created_at,
  }));
}

export async function getWorksheet(id: number): Promise<Worksheet | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, paper_size, font_family, created_at
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

export type RenameResult =
  | { ok: true; title: string }
  | { ok: false; code: 'not_found' | 'not_owner' | 'duplicate' };

export async function renameWorksheet(
  id: number,
  userId: number,
  newTitle: string
): Promise<RenameResult> {
  const pool = getPool();
  // Ownership check first (avoids leaking existence via duplicate detection).
  const [own] = await pool.execute<any[]>(
    `SELECT id, user_id FROM worksheets WHERE id = ? LIMIT 1`,
    [id]
  );
  if (own.length === 0) return { ok: false, code: 'not_found' };
  if (own[0].user_id !== userId) return { ok: false, code: 'not_owner' };

  // Reject duplicate title for same user (keep selector results stable).
  const [dup] = await pool.execute<any[]>(
    `SELECT id FROM worksheets WHERE user_id = ? AND title = ? AND id <> ? LIMIT 1`,
    [userId, newTitle, id]
  );
  if (dup.length > 0) return { ok: false, code: 'duplicate' };

  await pool.execute<any>(
    `UPDATE worksheets SET title = ? WHERE id = ?`,
    [newTitle, id]
  );
  return { ok: true, title: newTitle };
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
    paperSize: r.paper_size as PaperSize,
    fontFamily: r.font_family as FontFamily,
    createdAt: r.created_at,
  };
}
