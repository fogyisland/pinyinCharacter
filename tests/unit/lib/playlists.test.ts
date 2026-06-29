/**
 * Unit tests for lib/playlists.ts. Mock the pool so we can assert
 * SQL behavior without needing a live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type QueryResult = any[];

let queryResults: Record<string, QueryResult> = {};
let queryLog: Array<{ sql: string; params: any[] }> = [];

function makeConn() {
  return {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [[], []];
    }),
    execute: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [{ insertId: 1, affectedRows: 1 }, []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
}

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [[], []];
    }),
    execute: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key]!;
      }
      return [{ insertId: 1, affectedRows: 1 }, []];
    }),
    getConnection: vi.fn(async () => makeConn()),
  }),
}));

import {
  listPlaylists,
  getPlaylist,
  getActivePlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
} from '@/lib/playlists';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
});

describe('listPlaylists', () => {
  it('returns mapped rows in default order', async () => {
    queryResults['FROM playlists'] = [[
      { id: 2, title: '晚课', is_default: 1, created_at: new Date('2026-06-29T10:00:00Z'), updated_at: new Date('2026-06-29T10:00:00Z') },
      { id: 1, title: '早课', is_default: 0, created_at: new Date('2026-06-29T09:00:00Z'), updated_at: new Date('2026-06-29T09:00:00Z') },
    ], []];
    const lists = await listPlaylists();
    expect(lists).toHaveLength(2);
    expect(lists[0].id).toBe(2);
    expect(lists[0].isDefault).toBe(true);
    expect(lists[1].isDefault).toBe(false);
  });

  it('returns [] when empty', async () => {
    queryResults['FROM playlists'] = [[], []];
    expect(await listPlaylists()).toEqual([]);
  });
});

describe('getPlaylist', () => {
  it('returns playlist with tracks in position order', async () => {
    queryResults['FROM playlists'] = [[
      { id: 1, title: 'P', is_default: 0, created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' },
    ], []];
    queryResults['FROM playlist_tracks'] = [[
      { id: 10, position: 1, title: 'T1', filename: '10.mp3' },
      { id: 11, position: 2, title: 'T2', filename: '11.mp3' },
    ], []];
    const p = await getPlaylist(1);
    expect(p?.title).toBe('P');
    expect(p?.tracks).toHaveLength(2);
    expect(p?.tracks[0]).toEqual({ id: 10, position: 1, title: 'T1', src: '/audio/10.mp3' });
    expect(p?.tracks[1].id).toBe(11);
  });

  it('returns null when playlist not found', async () => {
    queryResults['FROM playlists'] = [[], []];
    expect(await getPlaylist(404)).toBeNull();
  });
});

describe('getActivePlaylist', () => {
  it('returns the default playlist with tracks', async () => {
    queryResults['WHERE is_default = 1'] = [[{ id: 5 }], []];
    queryResults['FROM playlists'] = [[
      { id: 5, title: 'Default', is_default: 1, created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' },
    ], []];
    queryResults['FROM playlist_tracks'] = [[
      { id: 1, position: 1, title: 'A', filename: '1.mp3' },
    ], []];
    const p = await getActivePlaylist();
    expect(p?.id).toBe(5);
    expect(p?.title).toBe('Default');
    expect(p?.tracks).toHaveLength(1);
  });

  it('returns null when no default exists', async () => {
    queryResults['WHERE is_default = 1'] = [[], []];
    expect(await getActivePlaylist()).toBeNull();
  });
});

describe('createPlaylist', () => {
  it('inserts without touching defaults when isDefault is not set', async () => {
    queryResults['INSERT INTO playlists'] = [{ insertId: 9, affectedRows: 1 }, []];
    const id = await createPlaylist({ title: 'P' });
    expect(id).toBe(9);
    const clear = queryLog.find((q) => q.sql.includes('UPDATE playlists SET is_default = 0'));
    expect(clear).toBeUndefined();
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO playlists'));
    expect(ins!.params).toEqual(['P', 0]);
  });

  it('clears existing defaults when isDefault=true', async () => {
    queryResults['INSERT INTO playlists'] = [{ insertId: 10, affectedRows: 1 }, []];
    const id = await createPlaylist({ title: 'P', isDefault: true });
    expect(id).toBe(10);
    const clear = queryLog.find((q) => q.sql.includes('UPDATE playlists SET is_default = 0'));
    expect(clear).toBeDefined();
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO playlists'));
    expect(ins!.params[1]).toBe(1);
  });
});

describe('updatePlaylist', () => {
  it('updates title only when isDefault is not set', async () => {
    await updatePlaylist(1, { title: 'New' });
    const upd = queryLog.find((q) => q.sql === 'UPDATE playlists SET title = ? WHERE id = ?');
    expect(upd).toBeDefined();
    expect(upd!.params).toEqual(['New', 1]);
  });

  it('clears other defaults when setting isDefault=true', async () => {
    await updatePlaylist(1, { isDefault: true });
    const clear = queryLog.find((q) => q.sql.includes('SET is_default = 0 WHERE id <> ?'));
    expect(clear).toBeDefined();
    expect(clear!.params).toEqual([1]);
  });

  it('no-ops when both fields are undefined', async () => {
    await updatePlaylist(1, {});
    const upd = queryLog.find((q) => q.sql.startsWith('UPDATE playlists SET'));
    expect(upd).toBeUndefined();
  });
});

describe('deletePlaylist', () => {
  it('issues DELETE on the playlist', async () => {
    await deletePlaylist(7);
    const del = queryLog.find((q) => q.sql.startsWith('DELETE FROM playlists'));
    expect(del).toBeDefined();
    expect(del!.params).toEqual([7]);
  });
});

describe('addTrackToPlaylist', () => {
  it('inserts at MAX(position)+1 when playlist has no tracks', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[], []];
    queryResults['SELECT COALESCE(MAX(position)'] = [[{ max_pos: 0 }], []];
    await addTrackToPlaylist(1, 42);
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO playlist_tracks'));
    expect(ins!.params).toEqual([1, 42, 1]);
  });

  it('inserts at MAX(position)+1 when playlist has tracks', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[
      { track_id: 10 }, { track_id: 11 },
    ], []];
    queryResults['SELECT COALESCE(MAX(position)'] = [[{ max_pos: 2 }], []];
    await addTrackToPlaylist(1, 42);
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO playlist_tracks'));
    expect(ins!.params).toEqual([1, 42, 3]);
  });

  it('throws when track is already in the playlist', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[
      { track_id: 42 },
    ], []];
    await expect(addTrackToPlaylist(1, 42)).rejects.toThrow(/already in playlist/);
  });
});

describe('removeTrackFromPlaylist', () => {
  it('deletes and re-sequences when position is in the middle', async () => {
    queryResults['SELECT position FROM playlist_tracks'] = [[{ position: 2 }], []];
    await removeTrackFromPlaylist(1, 42);
    const del = queryLog.find((q) => q.sql.includes('DELETE FROM playlist_tracks'));
    expect(del!.params).toEqual([1, 42]);
    const reseq = queryLog.find((q) => q.sql.includes('SET position = position - 1'));
    expect(reseq).toBeDefined();
    expect(reseq!.params).toEqual([1, 2]);
  });

  it('no-ops when the track is not in the playlist', async () => {
    queryResults['SELECT position FROM playlist_tracks'] = [[], []];
    await removeTrackFromPlaylist(1, 999);
    const del = queryLog.find((q) => q.sql.startsWith('DELETE FROM playlist_tracks'));
    expect(del).toBeUndefined();
    const reseq = queryLog.find((q) => q.sql.includes('SET position = position - 1'));
    expect(reseq).toBeUndefined();
  });
});

describe('reorderPlaylistTracks', () => {
  it('re-sequences positions 1..N when valid order given', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[
      { track_id: 10 }, { track_id: 11 }, { track_id: 12 },
    ], []];
    await reorderPlaylistTracks(1, [12, 10, 11]);
    const del = queryLog.find((q) => q.sql.startsWith('DELETE FROM playlist_tracks'));
    expect(del!.params).toEqual([1]);
    const inserts = queryLog.filter((q) => q.sql.includes('INSERT INTO playlist_tracks'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].params).toEqual([1, 12, 1]);
    expect(inserts[1].params).toEqual([1, 10, 2]);
    expect(inserts[2].params).toEqual([1, 11, 3]);
  });

  it('throws when incoming count differs from existing', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[
      { track_id: 10 }, { track_id: 11 }, { track_id: 12 },
    ], []];
    await expect(reorderPlaylistTracks(1, [10, 11])).rejects.toThrow(/cover all/);
  });

  it('throws when an incoming track is not in the playlist', async () => {
    queryResults['SELECT track_id FROM playlist_tracks'] = [[
      { track_id: 10 }, { track_id: 11 },
    ], []];
    await expect(reorderPlaylistTracks(1, [10, 999])).rejects.toThrow(/not in playlist/);
  });
});