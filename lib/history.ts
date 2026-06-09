import { getPool } from './db';

export type HistoryKind = 'text2pinyin' | 'pinyin2text';

export interface HistoryRow {
  id: number;
  user_id: number;
  kind: HistoryKind;
  input: string;
  output: string | null;
  is_favorite: 0 | 1;
  char_count: number;
  created_at: Date;
}

export interface CreateHistoryInput {
  userId: number;
  kind: HistoryKind;
  input: string;
  output?: string | null;
  charCount: number;
}

export interface ListHistoryOptions {
  userId: number;
  favoriteOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function createHistory(input: CreateHistoryInput): Promise<number> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `INSERT INTO history (user_id, kind, input, output, char_count)
     VALUES (?, ?, ?, ?, ?)`,
    [input.userId, input.kind, input.input, input.output ?? null, input.charCount]
  );
  return Number(res.insertId);
}

export async function listHistory(opts: ListHistoryOptions): Promise<HistoryRow[]> {
  const pool = getPool();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.favoriteOnly
    ? 'WHERE user_id = ? AND is_favorite = 1'
    : 'WHERE user_id = ?';
  const [rows] = await pool.execute<any[]>(
    `SELECT * FROM history ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [opts.userId, limit, offset]
  );
  return rows as HistoryRow[];
}

export async function setFavorite(
  userId: number, historyId: number, isFavorite: boolean
): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE history SET is_favorite = ? WHERE id = ? AND user_id = ?`,
    [isFavorite ? 1 : 0, historyId, userId]
  );
  return res.affectedRows > 0;
}

export async function deleteHistory(userId: number, historyId: number): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `DELETE FROM history WHERE id = ? AND user_id = ?`,
    [historyId, userId]
  );
  return res.affectedRows > 0;
}

export interface Stats {
  total: number;
  favorites: number;
}

export async function getStats(userId: number): Promise<Stats> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT
       COALESCE(SUM(char_count), 0) AS total,
       COALESCE(SUM(CASE WHEN is_favorite = 1 THEN char_count ELSE 0 END), 0) AS favorites
     FROM history WHERE user_id = ?`,
    [userId]
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    favorites: Number(rows[0]?.favorites ?? 0),
  };
}

/** 用于去重：返回最近 N 秒内同 kind+input 的记录 id（若有） */
export async function findRecentDuplicate(
  userId: number, kind: HistoryKind, input: string, withinSeconds = 60
): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id FROM history
     WHERE user_id = ? AND kind = ? AND input = ?
       AND created_at > (NOW() - INTERVAL ? SECOND)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, kind, input, withinSeconds]
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}
