import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => queryMock(...a), execute: (...a: unknown[]) => executeMock(...a) }),
}));

import {
  getProgress,
  upsertProgress,
  markComplete,
  deleteProgress,
} from '@/lib/sutra-copy-progress';

beforeEach(() => {
  queryMock.mockReset();
  executeMock.mockReset();
});

describe('getProgress', () => {
  it('returns null when no row', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const r = await getProgress(1, 2, 0);
    expect(r).toBeNull();
  });

  it('parses written_chars JSON into boolean[]', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, false, true]),
      started_at: new Date('2026-06-19T08:00:00Z'),
      updated_at: new Date('2026-06-19T08:30:00Z'),
      completed_at: null,
    }]]);
    const r = await getProgress(1, 2, 0);
    expect(r).toEqual({
      writtenChars: [true, false, true],
      startedAt: new Date('2026-06-19T08:00:00Z'),
      updatedAt: new Date('2026-06-19T08:30:00Z'),
      completedAt: null,
    });
  });
});

describe('upsertProgress', () => {
  it('INSERT ... ON DUPLICATE KEY UPDATE written_chars + completed_at', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await upsertProgress(1, 2, 0, [true, true], { completedAt: null });
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO sutra_copy_progress/);
    expect(String(sql)).toMatch(/ON DUPLICATE KEY UPDATE/);
    // params: userId, sutraId, chunkIdx, JSON(writtenChars), completedAt
    expect(params).toEqual([1, 2, 0, JSON.stringify([true, true]), null]);
  });

  it('treats undefined completedAt as null (no completion side-effect)', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await upsertProgress(1, 2, 0, [true], {});
    const [, params] = executeMock.mock.calls[0]!;
    expect((params as unknown[])[4]).toBeNull();
  });
});

describe('markComplete', () => {
  it('updates completed_at when stored row is all-true', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, true, true]),
    }]]);
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markComplete(1, 2, 0);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/UPDATE sutra_copy_progress\s+SET completed_at = NOW\(\)/);
    expect(params).toEqual([1, 2, 0]);
  });

  it('no-ops when row is missing', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    await markComplete(1, 2, 0);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('no-ops when any char is un-written', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, false, true]),
    }]]);
    await markComplete(1, 2, 0);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('deleteProgress', () => {
  it('DELETEs the row', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await deleteProgress(1, 2, 0);
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/DELETE FROM sutra_copy_progress/);
    expect(params).toEqual([1, 2, 0]);
  });
});
