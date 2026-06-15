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
