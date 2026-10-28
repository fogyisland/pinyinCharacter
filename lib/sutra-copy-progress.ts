import 'server-only';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export interface CopyProgress {
  writtenChars: boolean[];
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/**
 * A `sutra_copy_progress` row as mysql2 returns it. `written_chars` is a JSON
 * column, so mysql2 hands back the parsed array; the string branch keeps the
 * helper total for pools that return raw JSON text.
 */
interface SutraCopyProgressRow extends RowDataPacket {
  written_chars: string | boolean[];
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** The columns `markComplete` selects. */
interface SutraCopyCharsRow extends RowDataPacket {
  written_chars: string | boolean[];
}

function parseWrittenChars(raw: string | boolean[]): boolean[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number,
): Promise<CopyProgress | null> {
  const [rows] = await getPool().query<SutraCopyProgressRow[]>(
    `SELECT written_chars, started_at, updated_at, completed_at
       FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?
       LIMIT 1`,
    [userId, sutraId, chunkIdx],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    writtenChars: parseWrittenChars(r.written_chars),
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

export async function upsertProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number,
  writtenChars: boolean[],
  opts: { completedAt?: Date | null } = {},
): Promise<void> {
  const completedAt = opts.completedAt === undefined ? null : opts.completedAt;
  await getPool().query(
    `INSERT INTO sutra_copy_progress
       (user_id, sutra_id, chunk_idx, written_chars, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       written_chars = VALUES(written_chars),
       completed_at  = VALUES(completed_at)`,
    [userId, sutraId, chunkIdx, JSON.stringify(writtenChars), completedAt],
  );
}

export async function markComplete(
  userId: number,
  sutraId: number,
  chunkIdx: number,
): Promise<void> {
  const [rows] = await getPool().query<SutraCopyCharsRow[]>(
    `SELECT written_chars FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ? LIMIT 1`,
    [userId, sutraId, chunkIdx],
  );
  if (rows.length === 0) return;
  const written = parseWrittenChars(rows[0].written_chars);
  if (written.length === 0 || !written.every(Boolean)) return;
  await getPool().query(
    `UPDATE sutra_copy_progress
       SET completed_at = NOW()
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?`,
    [userId, sutraId, chunkIdx],
  );
}

export async function deleteProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number,
): Promise<void> {
  await getPool().query(
    `DELETE FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?`,
    [userId, sutraId, chunkIdx],
  );
}
