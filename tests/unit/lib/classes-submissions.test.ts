// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 作业的完成状态 —— 存储层。
 *
 * 第二期补上「谁做完了」。口径已经定了：学生**手动勾选**才算完成，
 * 打印不作为完成条件。这个文件钉住三件事：
 *   1. 跨班交作业是不可能的（归属校验在存储层，不只靠路由）；
 *   2. 重复勾选是更新，不是新增；
 *   3. 一个班所有作业的进度是一次查询，不是 N 次。
 */

type Row = Record<string, unknown>;

const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getPool: getPoolMock }));

import {
  clearSubmission,
  listClassProgress,
  listSubmissions,
  recordSubmission,
} from '@/lib/classes-store';

function scripted(rows: Row[]): void {
  queryMock.mockResolvedValue([rows, []]);
}

beforeEach(() => {
  queryMock.mockReset();
  getPoolMock.mockReset();
  getPoolMock.mockReturnValue({ query: queryMock });
  scripted([]);
});

function lastCall(): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls[queryMock.mock.calls.length - 1];
  return { sql: String(call[0]).replace(/\s+/g, ' ').trim(), params: call[1] ?? [] };
}

describe('recordSubmission', () => {
  it('writes the submission when the assignment belongs to the class and the user is a member', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 5 }], []]) // guard passes
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const ok = await recordSubmission(5, 7, 9, '第三行没看懂');
    expect(ok).toBe(true);
    const call = lastCall();
    expect(call.sql).toContain('INSERT INTO class_submissions');
    // A second click updates the note and the timestamp instead of inserting
    // a second row: the unique key is (assignment_id, user_id).
    expect(call.sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(call.params).toEqual([5, 9, '第三行没看懂']);
  });

  it('checks the assignment belongs to the class AND the user is a member', async () => {
    await recordSubmission(5, 7, 9, '');
    const guard = queryMock.mock.calls[0];
    const sql = String(guard[0]).replace(/\s+/g, ' ');
    // 两个条件都要在：作业属于这个班、提交人是这个班的成员。
    expect(sql).toContain('a.class_id = ?');
    expect(sql).toContain('class_members');
  });

  it('refuses a submission for an assignment from another class', async () => {
    scripted([]); // guard finds nothing
    expect(await recordSubmission(5, 7, 9, '')).toBe(false);
    // 没有第二条语句：guard 失败就不写。
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('truncates a long note instead of failing the write', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await recordSubmission(5, 7, 9, 'x'.repeat(900));
    const call = lastCall();
    expect((call.params[2] as string).length).toBe(512);
  });
});

describe('clearSubmission', () => {
  it('removes the submission so a student can redo the assignment', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await clearSubmission(5, 9)).toBe(true);
    expect(lastCall().params).toEqual([5, 9]);
  });

  it('reports false when there was nothing to clear', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect(await clearSubmission(5, 9)).toBe(false);
  });
});

describe('listSubmissions', () => {
  it('returns every completion with its note, oldest first', async () => {
    scripted([
      { user_id: 9, username: '小明', note: '第三行没看懂', completed_at: new Date('2026-11-22T01:00:00Z') },
      { user_id: 10, username: '小红', note: '', completed_at: new Date('2026-11-22T02:00:00Z') },
    ]);
    const submissions = await listSubmissions(5);
    expect(submissions).toHaveLength(2);
    expect(submissions[0].note).toBe('第三行没看懂');
    expect(lastCall().sql).toContain('ORDER BY s.completed_at ASC');
  });
});

describe('listClassProgress', () => {
  it('collects every assignment of a class in ONE query', async () => {
    // 老师的班级页要 N 份作业 × 12 人的进度；逐份查是 N 次往返。
    scripted([
      { assignment_id: 5, user_id: 9 },
      { assignment_id: 5, user_id: 10 },
      { assignment_id: 6, user_id: 9 },
    ]);
    const progress = await listClassProgress(7);
    expect(progress[5]).toEqual([9, 10]);
    expect(progress[6]).toEqual([9]);
    // 一条语句：JOIN 到 class_assignments 并按 class_id 过滤。
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(lastCall().sql).toContain('a.class_id = ?');
    expect(lastCall().params).toEqual([7]);
  });

  it('returns an empty record for a class with no submissions', async () => {
    scripted([]);
    expect(await listClassProgress(7)).toEqual({});
  });
});
