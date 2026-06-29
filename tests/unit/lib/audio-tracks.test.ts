/**
 * Unit tests for lib/audio-tracks.ts. Mock the pool so we can assert
 * SQL behavior without needing a live DB. For the unique-to-single-row
 * default invariant we exercise the real path in integration tests.
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
  listTracks,
  getTrack,
  getActiveTrack,
  createTrack,
  updateTrack,
  deleteTrack,
} from '@/lib/audio-tracks';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
});

describe('listTracks', () => {
  it('returns mapped rows in the default order (is_default DESC, id ASC)', async () => {
    queryResults['FROM audio_tracks'] = [[
      { id: 2, title: '心经', filename: '2.mp3', size_bytes: 12345, is_default: 1, uploaded_by: 1, created_at: new Date('2026-06-29T10:00:00Z'), updated_at: new Date('2026-06-29T10:00:00Z') },
      { id: 1, title: '大悲咒', filename: '1.mp3', size_bytes: 67890, is_default: 0, uploaded_by: null, created_at: new Date('2026-06-29T09:00:00Z'), updated_at: new Date('2026-06-29T09:00:00Z') },
    ], []];
    const tracks = await listTracks();
    expect(tracks).toHaveLength(2);
    expect(tracks[0].id).toBe(2);
    expect(tracks[0].isDefault).toBe(true);
    expect(tracks[0].sizeBytes).toBe(12345);
    expect(tracks[0].uploadedBy).toBe(1);
    expect(tracks[1].isDefault).toBe(false);
    expect(tracks[1].uploadedBy).toBeNull();
  });

  it('returns [] when the table is empty', async () => {
    queryResults['FROM audio_tracks'] = [[], []];
    expect(await listTracks()).toEqual([]);
  });

  it('serializes Date columns to ISO strings', async () => {
    const d = new Date('2026-06-29T10:00:00Z');
    queryResults['FROM audio_tracks'] = [[
      { id: 1, title: 't', filename: '1.mp3', size_bytes: 100, is_default: 1, uploaded_by: null, created_at: d, updated_at: d },
    ], []];
    const t = (await listTracks())[0];
    expect(t.createdAt).toBe('2026-06-29T10:00:00.000Z');
  });
});

describe('getTrack', () => {
  it('returns a mapped track when found', async () => {
    queryResults['FROM audio_tracks'] = [[
      { id: 5, title: '大悲咒', filename: '5.mp3', size_bytes: 999, is_default: 0, uploaded_by: null, created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' },
    ], []];
    const t = await getTrack(5);
    expect(t?.id).toBe(5);
    expect(t?.title).toBe('大悲咒');
  });

  it('returns null when not found', async () => {
    queryResults['FROM audio_tracks'] = [[], []];
    expect(await getTrack(404)).toBeNull();
  });
});

describe('getActiveTrack', () => {
  it('returns src as /audio/<filename> for the first row (is_default DESC)', async () => {
    queryResults['FROM audio_tracks'] = [[
      { id: 3, title: '心经', filename: '3.mp3' },
    ], []];
    const a = await getActiveTrack();
    expect(a).toEqual({ src: '/audio/3.mp3', title: '心经' });
  });

  it('returns null when the table is empty', async () => {
    queryResults['FROM audio_tracks'] = [[], []];
    expect(await getActiveTrack()).toBeNull();
  });
});

describe('createTrack', () => {
  it('inserts a non-default row without touching the default flag on others', async () => {
    queryResults['INSERT INTO audio_tracks'] = [{ insertId: 7, affectedRows: 1 }, []];
    const id = await createTrack({
      title: '大悲咒',
      filename: '7.mp3',
      sizeBytes: 12345,
      uploadedBy: 1,
    });
    expect(id).toBe(7);
    // Find the INSERT statement
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO audio_tracks'));
    expect(ins).toBeDefined();
    expect(ins!.params).toEqual(['大悲咒', '7.mp3', 12345, 0, 1]);
    // No default-clear statement should have been issued
    const clear = queryLog.find((q) => q.sql.includes('SET is_default = 0'));
    expect(clear).toBeUndefined();
  });

  it('clears existing default rows when isDefault=true', async () => {
    queryResults['INSERT INTO audio_tracks'] = [{ insertId: 8, affectedRows: 1 }, []];
    const id = await createTrack({
      title: '心经',
      filename: '8.mp3',
      sizeBytes: 999,
      uploadedBy: null,
      isDefault: true,
    });
    expect(id).toBe(8);
    // Should have issued a clear-defaults UPDATE
    const clear = queryLog.find((q) => q.sql.includes('SET is_default = 0'));
    expect(clear).toBeDefined();
    const ins = queryLog.find((q) => q.sql.includes('INSERT INTO audio_tracks'));
    expect(ins!.params[3]).toBe(1); // is_default=1
  });
});

describe('updateTrack', () => {
  it('updates only the title when isDefault is not provided', async () => {
    await updateTrack(1, { title: '新名' });
    const upd = queryLog.find((q) => q.sql === 'UPDATE audio_tracks SET title = ? WHERE id = ?');
    expect(upd).toBeDefined();
    expect(upd!.params).toEqual(['新名', 1]);
  });

  it('clears all other defaults when isDefault=true is set', async () => {
    await updateTrack(1, { isDefault: true });
    const clear = queryLog.find((q) => q.sql.includes('SET is_default = 0 WHERE id <> ?'));
    expect(clear).toBeDefined();
    expect(clear!.params).toEqual([1]);
    // The subsequent UPDATE for THIS row uses is_default=1 + WHERE id=?
    const upd = queryLog.find((q) => /UPDATE audio_tracks SET is_default = \? WHERE id = \?/.test(q.sql));
    expect(upd).toBeDefined();
    expect(upd!.params).toEqual([1, 1]); // is_default=1, id=1
  });

  it('does not clear others when isDefault=false (allows unsetting the default)', async () => {
    await updateTrack(1, { isDefault: false });
    const clear = queryLog.find((q) => q.sql.includes('SET is_default = 0 WHERE id <>'));
    expect(clear).toBeUndefined();
  });

  it('no-ops when both fields are undefined', async () => {
    await updateTrack(1, {});
    const upd = queryLog.find((q) => q.sql.startsWith('UPDATE audio_tracks SET'));
    expect(upd).toBeUndefined();
  });
});

describe('deleteTrack', () => {
  it('returns the filename and deletes the row', async () => {
    queryResults['SELECT filename'] = [[{ filename: '5.mp3' }], []];
    queryResults['DELETE FROM audio_tracks'] = [{ affectedRows: 1 }, []];
    const r = await deleteTrack(5);
    expect(r).toEqual({ filename: '5.mp3' });
    const del = queryLog.find((q) => q.sql.startsWith('DELETE FROM audio_tracks'));
    expect(del!.params).toEqual([5]);
  });

  it('returns null when the track does not exist', async () => {
    queryResults['SELECT filename'] = [[], []];
    const r = await deleteTrack(404);
    expect(r).toBeNull();
  });
});
