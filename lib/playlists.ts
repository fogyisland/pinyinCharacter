/**
 * Server-only: ordered playlists of audio_tracks for the sutra page player.
 *
 * Storage:
 *   playlists        — id, title, is_default (single-default site-wide invariant)
 *   playlist_tracks  — junction (playlist_id, track_id, position); position
 *                      is 1..N contiguous per playlist.
 *
 * Invariants:
 *   1. At most one playlist has is_default=1 (transaction-enforced).
 *   2. Positions are dense 1..N per playlist. Reorder/add/remove re-sequences.
 *   3. A track appears at most once per playlist (uq_playlist_track).
 */
import { getPool } from './db';

export interface PlaylistTrackRef {
  id: number;
  title: string;
  src: string;
  position: number;
}

export interface Playlist {
  id: number;
  title: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A playlist with its tracks joined in position order. */
export interface PlaylistWithTracks extends Playlist {
  tracks: PlaylistTrackRef[];
}

/** Lists all playlists (no tracks joined). Used by admin overview. */
export async function listPlaylists(): Promise<Playlist[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, title, is_default, created_at, updated_at
     FROM playlists ORDER BY is_default DESC, id ASC`,
  );
  return rows.map(rowToPlaylist);
}

/** Returns a playlist with its tracks in position order. */
export async function getPlaylist(id: number): Promise<PlaylistWithTracks | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, title, is_default, created_at, updated_at
     FROM playlists WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  const [trackRows] = await getPool().query<any[]>(
    `SELECT pt.track_id AS id, pt.position, at.title, at.filename
     FROM playlist_tracks pt
     JOIN audio_tracks at ON at.id = pt.track_id
     WHERE pt.playlist_id = ?
     ORDER BY pt.position ASC`,
    [id],
  );
  return {
    ...rowToPlaylist(rows[0]),
    tracks: trackRows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      src: `/audio/${r.filename}`,
      position: Number(r.position),
    })),
  };
}

/** Returns the default playlist with its tracks (position-ordered).
 *  Returns null if no playlist exists or no default is set. */
export async function getActivePlaylist(): Promise<PlaylistWithTracks | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id FROM playlists
     WHERE is_default = 1
     ORDER BY id ASC LIMIT 1`,
  );
  if (!rows.length) return null;
  return getPlaylist(Number(rows[0].id));
}

export interface CreatePlaylistInput {
  title: string;
  isDefault?: boolean;
}

export async function createPlaylist(input: CreatePlaylistInput): Promise<number> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (input.isDefault) {
      await conn.query(`UPDATE playlists SET is_default = 0`);
    }
    const [res] = await conn.execute<any>(
      `INSERT INTO playlists (title, is_default) VALUES (?, ?)`,
      [input.title, input.isDefault ? 1 : 0],
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

export interface UpdatePlaylistInput {
  title?: string;
  isDefault?: boolean;
}

export async function updatePlaylist(
  id: number,
  input: UpdatePlaylistInput,
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (input.isDefault === true) {
      await conn.query(`UPDATE playlists SET is_default = 0 WHERE id <> ?`, [id]);
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
        `UPDATE playlists SET ${sets.join(', ')} WHERE id = ?`,
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

export async function deletePlaylist(id: number): Promise<void> {
  // FK ON DELETE CASCADE removes junction rows.
  await getPool().execute(`DELETE FROM playlists WHERE id = ?`, [id]);
}

/** Appends a track to a playlist at the next available position.
 *  Re-sequences to keep positions dense 1..N. Throws if the track is
 *  already in the playlist. */
export async function addTrackToPlaylist(
  playlistId: number,
  trackId: number,
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<any[]>(
      `SELECT track_id FROM playlist_tracks WHERE playlist_id = ?`,
      [playlistId],
    );
    if (existing.some((r: any) => Number(r.track_id) === trackId)) {
      throw new Error(`track ${trackId} already in playlist ${playlistId}`);
    }
    const [maxRow] = await conn.query<any[]>(
      `SELECT COALESCE(MAX(position), 0) AS max_pos FROM playlist_tracks WHERE playlist_id = ?`,
      [playlistId],
    );
    const nextPos = Number(maxRow[0].max_pos) + 1;
    await conn.execute(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
      [playlistId, trackId, nextPos],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Removes a track and re-sequences remaining positions to keep 1..N dense. */
export async function removeTrackFromPlaylist(
  playlistId: number,
  trackId: number,
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(
      `SELECT position FROM playlist_tracks
       WHERE playlist_id = ? AND track_id = ? LIMIT 1`,
      [playlistId, trackId],
    );
    if (!rows.length) {
      await conn.commit();
      return;
    }
    const removedPos = Number(rows[0].position);
    await conn.execute(
      `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`,
      [playlistId, trackId],
    );
    // Re-sequence: shift positions down for rows above the gap.
    await conn.execute(
      `UPDATE playlist_tracks SET position = position - 1
       WHERE playlist_id = ? AND position > ?`,
      [playlistId, removedPos],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Replaces the entire track order with `trackIds` (in the new order).
 *  Validates all IDs belong to the playlist. Re-sequences to 1..N. */
export async function reorderPlaylistTracks(
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(
      `SELECT track_id FROM playlist_tracks WHERE playlist_id = ?`,
      [playlistId],
    );
    const existing = new Set(rows.map((r: any) => Number(r.track_id)));
    const incoming = new Set(trackIds);
    if (existing.size !== incoming.size) {
      throw new Error(`trackIds must cover all ${existing.size} playlist tracks`);
    }
    for (const id of incoming) {
      if (!existing.has(id)) {
        throw new Error(`track ${id} not in playlist ${playlistId}`);
      }
    }
    // Clear and re-insert with positions 1..N.
    await conn.execute(
      `DELETE FROM playlist_tracks WHERE playlist_id = ?`,
      [playlistId],
    );
    for (let i = 0; i < trackIds.length; i++) {
      await conn.execute(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
        [playlistId, trackIds[i], i + 1],
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

function rowToPlaylist(r: any): Playlist {
  return {
    id: Number(r.id),
    title: r.title,
    isDefault: Number(r.is_default) === 1,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}