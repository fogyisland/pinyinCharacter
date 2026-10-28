import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { writeAudit } from './audit';
import type {
  PaperSize,
  FontFamily,
  CellStyle,
  SaveWorksheetArgs,
  Worksheet,
  WorksheetListItem,
} from './worksheet-types';

export * from './worksheet-types';

/** A row of `worksheets` as mysql2 returns it. */
interface WorksheetRow extends RowDataPacket {
  id: number;
  user_id: number;
  title: string;
  content: string[] | string;
  cell_style: string;
  paper_size: string;
  font_family: string;
  created_at: Date;
}

/** The columns the worksheet list item query selects. */
interface WorksheetListItemRow extends RowDataPacket {
  id: number;
  title: string;
  cell_style: string;
  paper_size: string;
  font_family: string;
  char_count: number | null;
  created_at: Date;
}

/** The columns the lightweight worksheet list query selects. */
interface WorksheetLightRow extends RowDataPacket {
  id: number;
  title: string;
  char_count: number | null;
  created_at: Date;
}

/** The ownership check query of `renameWorksheet`. */
interface WorksheetOwnerRow extends RowDataPacket {
  id: number;
  user_id: number;
}

/** The duplicate-title check query of `renameWorksheet`. */
interface WorksheetIdRow extends RowDataPacket {
  id: number;
}

export async function saveWorksheet(args: SaveWorksheetArgs): Promise<number> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      args.userId,
      args.title,
      JSON.stringify(args.content),
      args.cellStyle,
      args.paperSize,
      args.fontFamily,
    ],
  );
  const id = result.insertId as number;
  await writeAudit({
    userId: args.userId,
    event: 'worksheet_saved',
    metadata: {
      worksheetId: id,
      charCount: args.content.length,
      cellStyle: args.cellStyle,
      paperSize: args.paperSize,
      fontFamily: args.fontFamily,
    },
    ip: args.ip,
    userAgent: args.userAgent,
  });
  return id;
}

export async function listUserWorksheets(userId: number): Promise<Worksheet[]> {
  const pool = getPool();
  const [rows] = await pool.query<WorksheetRow[]>(
    `SELECT id, user_id, title, content, cell_style, paper_size, font_family, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map(mapRow);
}

/**
 * Rows for the worksheet history list.
 *
 * The list only renders the title, paper size, font, cell style, char count
 * and creation time — it never reads the chars themselves. Selecting the
 * `content` column here shipped up to 200 worksheets' worth of char arrays
 * into the RSC payload for nothing; JSON_LENGTH(content) gives the count
 * without the payload.
 */
export async function listUserWorksheetListItems(userId: number): Promise<WorksheetListItem[]> {
  const pool = getPool();
  const [rows] = await pool.query<WorksheetListItemRow[]>(
    `SELECT id, title, cell_style, paper_size, font_family,
            JSON_LENGTH(content) AS char_count, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    cellStyle: r.cell_style as CellStyle,
    paperSize: r.paper_size as PaperSize,
    fontFamily: r.font_family as FontFamily,
    charCount: Number(r.char_count ?? 0),
    createdAt: r.created_at,
  }));
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
  const [rows] = await pool.query<WorksheetLightRow[]>(
    `SELECT id, title, JSON_LENGTH(content) AS char_count, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId],
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
  const [rows] = await pool.query<WorksheetRow[]>(
    `SELECT id, user_id, title, content, cell_style, paper_size, font_family, created_at
     FROM worksheets WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function deleteWorksheet(id: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM worksheets WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  const affected = (result.affectedRows as number) ?? 0;
  if (affected > 0) {
    await writeAudit({ userId, event: 'worksheet_deleted', metadata: { worksheetId: id } });
  }
  return affected > 0;
}

export type RenameResult =
  { ok: true; title: string } | { ok: false; code: 'not_found' | 'not_owner' | 'duplicate' };

export async function renameWorksheet(
  id: number,
  userId: number,
  newTitle: string,
): Promise<RenameResult> {
  const pool = getPool();
  // Ownership check first (avoids leaking existence via duplicate detection).
  const [own] = await pool.query<WorksheetOwnerRow[]>(
    `SELECT id, user_id FROM worksheets WHERE id = ? LIMIT 1`,
    [id],
  );
  if (own.length === 0) return { ok: false, code: 'not_found' };
  if (own[0].user_id !== userId) return { ok: false, code: 'not_owner' };

  // Reject duplicate title for same user (keep selector results stable).
  const [dup] = await pool.query<WorksheetIdRow[]>(
    `SELECT id FROM worksheets WHERE user_id = ? AND title = ? AND id <> ? LIMIT 1`,
    [userId, newTitle, id],
  );
  if (dup.length > 0) return { ok: false, code: 'duplicate' };

  await pool.query<ResultSetHeader>(`UPDATE worksheets SET title = ? WHERE id = ?`, [
    newTitle,
    id,
  ]);
  return { ok: true, title: newTitle };
}

function mapRow(r: WorksheetRow): Worksheet {
  let content: string[];
  if (typeof r.content === 'string') {
    content = JSON.parse(r.content) as string[];
  } else {
    content = r.content;
  }
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content,
    cellStyle: r.cell_style as CellStyle,
    paperSize: r.paper_size as PaperSize,
    fontFamily: r.font_family as FontFamily,
    createdAt: r.created_at,
  };
}
