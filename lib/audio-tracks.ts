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
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

interface AudioTrackRow extends RowDataPacket {
  id: number;
  title: string;
  filename: string;
  size_bytes: number;
  is_default: number;
  uploaded_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AudioTrackNameRow extends RowDataPacket {
  filename: string;
}

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

/**
 * The file name of a track, in the one shape the upload route writes:
 * `<id>.mp3`.
 *
 * It is a WHITELIST, not a sanitiser. The caller hands the name to
 * `unlink(join(AUDIO_DIR, name))`, and a name like `../../.env` would
 * resolve outside the audio directory — so the check is "does it look
 * exactly like what we write", not "does it look safe enough".
 */
const TRACK_FILENAME_PATTERN = /^\d+\.mp3$/;

/** True when a stored filename is one this module wrote. */
export function isTrackFilename(filename: string): boolean {
  return TRACK_FILENAME_PATTERN.test(filename);
}

/** Upper bound for the admin track list. The table is hand-curated
 *  (one MP3 per row), so 500 is far above any realistic size — the LIMIT
 *  only keeps a runaway import from pulling an unbounded result set. */
const MAX_TRACKS = 500;

export async function listTracks(): Promise<AudioTrack[]> {
  const [rows] = await getPool().query<AudioTrackRow[]>(
    `SELECT id, title, filename, size_bytes, is_default, uploaded_by, created_at, updated_at
     FROM audio_tracks ORDER BY is_default DESC, id ASC LIMIT ${MAX_TRACKS}`,
  );
  return rows.map(rowToTrack);
}

export async function getTrack(id: number): Promise<AudioTrack | null> {
  const [rows] = await getPool().query<AudioTrackRow[]>(
    `SELECT id, title, filename, size_bytes, is_default, uploaded_by, created_at, updated_at
     FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length ? rowToTrack(rows[0]) : null;
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
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO audio_tracks (title, filename, size_bytes, is_default, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [input.title, input.filename, input.sizeBytes, input.isDefault ? 1 : 0, input.uploadedBy],
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
export async function updateTrack(id: number, input: UpdateTrackInput): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (input.isDefault === true) {
      await conn.query(`UPDATE audio_tracks SET is_default = 0 WHERE id <> ?`, [id]);
    }
    const sets: string[] = [];
    const params: SqlParam[] = [];
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
      await conn.query(`UPDATE audio_tracks SET ${sets.join(', ')} WHERE id = ?`, params);
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
  const [rows] = await getPool().query<AudioTrackNameRow[]>(
    `SELECT filename FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;

  const filename = rows[0].filename;
  // A row whose filename is not one we wrote is bad data. Deleting it
  // would either leave an orphan file (the name does not point at one)
  // or — worse — let a hand-edited row make the server unlink a file
  // outside public/audio. Refuse, and let the caller report it.
  if (!isTrackFilename(filename)) return null;

  await getPool().query(`DELETE FROM audio_tracks WHERE id = ?`, [id]);
  return { filename };
}

function rowToTrack(r: AudioTrackRow): AudioTrack {
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
