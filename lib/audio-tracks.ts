/**
 * Server-only: audio tracks for the in-page sutra audio player.
 *
 * Storage: each track is an MP3 file at `public/audio/<id>.mp3` plus a
 * row in `audio_tracks` for metadata. The `filename` column is always
 * `<id>.mp3` for v1 (single-format); if we add other formats later the
 * column can be extended and the on-disk layout can be migrated.
 *
 * Default-track invariant: at most one row has is_default=1. All writes
 * that flip the default clear the previous default in the same
 * transaction so the invariant is preserved.
 */
import { getPool } from './db';

export interface AudioTrack {
  id: number;
  title: string;
  filename: string;
  sizeBytes: number;
  isDefault: boolean;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Public-facing shape (no internal fields, only src + title). */
export interface ActiveAudioTrack {
  src: string;
  title: string;
}

export async function listTracks(): Promise<AudioTrack[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, title, filename, size_bytes, is_default, uploaded_by, created_at, updated_at
     FROM audio_tracks ORDER BY is_default DESC, id ASC`,
  );
  return rows.map(rowToTrack);
}

export async function getTrack(id: number): Promise<AudioTrack | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, title, filename, size_bytes, is_default, uploaded_by, created_at, updated_at
     FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length ? rowToTrack(rows[0]) : null;
}

/** Returns the public-facing default track. Falls back to the first row
 *  if no is_default=1 exists (shouldn't happen post-admin, but keeps
 *  the player alive if data drifts). Returns null only if the table is
 *  empty. */
export async function getActiveTrack(): Promise<ActiveAudioTrack | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, title, filename FROM audio_tracks
     ORDER BY is_default DESC, id ASC LIMIT 1`,
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { src: `/audio/${r.filename}`, title: r.title };
}

export interface CreateTrackInput {
  title: string;
  filename: string;
  sizeBytes: number;
  uploadedBy: number | null;
  isDefault?: boolean;
}

/** Inserts a new audio_tracks row. The on-disk file at
 *  `public/audio/<filename>` must already exist; this function only
 *  records the metadata. */
export async function createTrack(input: CreateTrackInput): Promise<number> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (input.isDefault) {
      await conn.query(`UPDATE audio_tracks SET is_default = 0`);
    }
    const [res] = await conn.execute<any>(
      `INSERT INTO audio_tracks (title, filename, size_bytes, is_default, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.title,
        input.filename,
        input.sizeBytes,
        input.isDefault ? 1 : 0,
        input.uploadedBy,
      ],
    );
    const newId = Number(res.insertId);
    await conn.commit();
    return newId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export interface UpdateTrackInput {
  title?: string;
  isDefault?: boolean;
}

/** Updates a track's title and/or default flag. Preserves the
 *  single-default invariant when isDefault=true. */
export async function updateTrack(
  id: number,
  input: UpdateTrackInput,
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (input.isDefault === true) {
      await conn.query(`UPDATE audio_tracks SET is_default = 0 WHERE id <> ?`, [id]);
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (input.title !== undefined) {
      sets.push('title = ?');
      params.push(input.title);
    }
    if (input.isDefault !== undefined) {
      sets.push('is_default = ?');
      params.push(input.isDefault ? 1 : 0);
    }
    if (sets.length > 0) {
      params.push(id);
      await conn.query(
        `UPDATE audio_tracks SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Hard-deletes a row. The caller is responsible for removing the
 *  matching file from `public/audio/`. */
export async function deleteTrack(id: number): Promise<{ filename: string } | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT filename FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  await getPool().execute(`DELETE FROM audio_tracks WHERE id = ?`, [id]);
  return { filename: rows[0].filename };
}

function rowToTrack(r: any): AudioTrack {
  return {
    id: Number(r.id),
    title: r.title,
    filename: r.filename,
    sizeBytes: Number(r.size_bytes),
    isDefault: Number(r.is_default) === 1,
    uploadedBy: r.uploaded_by !== null ? Number(r.uploaded_by) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}
