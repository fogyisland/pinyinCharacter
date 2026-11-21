// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 班级与作业的存储层 —— 用假的 mysql 池驱动。
 *
 * 这个文件不连数据库：真实 MySQL 在测试里不可用，而这一层的职责恰恰是
 * 「把 SQL 写对、把权限判对」。假池记录每条 SQL 与参数，断言就能钉住
 * 「谁被允许做什么」以及「哪些查询带上了 class_id」。
 *
 * 权限是这一层唯一真正复杂的地方：
 *   - 老师：建班、派作业、移出成员、改截止日期
 *   - 学生：加入、退出、看作业
 *   - 外人：什么都看不到 —— 甚至不能通过「猜 class id」读到一个班
 */

type Row = Record<string, unknown>;

const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPool: getPoolMock,
}));

import {
  createClass,
  findClassByJoinCode,
  joinClass,
  leaveClass,
  listClassMembers,
  listTeacherClasses,
  listStudentClasses,
  removeMember,
  getClassForUser,
  listAssignments,
  createAssignment,
  deleteAssignment,
} from '@/lib/classes-store';

/** The pool's `query` records each call and answers from a script. */
function scripted(rows: Row[]): void {
  queryMock.mockResolvedValue([rows, []]);
}

beforeEach(() => {
  queryMock.mockReset();
  getPoolMock.mockReset();
  getPoolMock.mockReturnValue({ query: queryMock });
  scripted([]);
});

/** The last SQL statement and its parameters. */
function lastCall(): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls[queryMock.mock.calls.length - 1];
  return { sql: String(call[0]).replace(/\s+/g, ' ').trim(), params: call[1] ?? [] };
}

describe('class membership — who may read a class', () => {
  it('returns the class for its teacher', async () => {
    scripted([
      { id: 7, teacher_id: 3, name: 'HSK1 周三班', join_code: 'ABCDEF', note: '', role: 'teacher' },
    ]);
    const result = await getClassForUser(7, 3);
    expect(result?.role).toBe('teacher');
    // The query must decide membership in SQL, not in JavaScript: a
    // "SELECT * then filter in JS" would ship every class row to the app.
    expect(lastCall().sql).toContain('teacher_id = ?');
    expect(lastCall().sql).toContain('class_members');
  });

  it('returns the class for a member with the student role', async () => {
    scripted([
      { id: 7, teacher_id: 3, name: 'HSK1 周三班', join_code: 'ABCDEF', note: '', role: 'student' },
    ]);
    const result = await getClassForUser(7, 9);
    expect(result?.role).toBe('student');
  });

  it('returns null for someone who is neither the teacher nor a member', async () => {
    scripted([]);
    expect(await getClassForUser(7, 11)).toBeNull();
  });
});

describe('creating a class', () => {
  it('inserts the row and returns the id and the invite code', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 42 }, []]);
    const created = await createClass({ teacherId: 3, name: '  HSK1 周三班  ', note: '周五交作业' });
    expect(created.id).toBe(42);
    expect(created.joinCode).toHaveLength(6);
    const call = lastCall();
    expect(call.sql).toContain('INSERT INTO classes');
    expect(call.params[1]).toBe('HSK1 周三班');
  });

  it('retries the invite code when the insert hits a duplicate', async () => {
    // A duplicate join_code is an ER_DUP_ENTRY; the store must try again
    // rather than surfacing a 500 to the teacher.
    const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    queryMock
      .mockRejectedValueOnce(duplicate)
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce([{ insertId: 43 }, []]);
    const created = await createClass({ teacherId: 3, name: 'x', note: '' });
    expect(created.id).toBe(43);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the declared number of tries', async () => {
    const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    queryMock.mockRejectedValue(duplicate);
    await expect(createClass({ teacherId: 3, name: 'x', note: '' })).rejects.toThrow();
    expect(queryMock).toHaveBeenCalledTimes(6);
  });

  it('does not retry a failure that is not a duplicate', async () => {
    // A connection error must not be retried six times: that hides the real
    // problem and multiplies the load on an already sick database.
    const boom = Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
    queryMock.mockRejectedValue(boom);
    await expect(createClass({ teacherId: 3, name: 'x', note: '' })).rejects.toThrow('connection lost');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('joining a class', () => {
  it('finds a class by its invite code, case-insensitively', async () => {
    scripted([{ id: 7, teacher_id: 3, name: 'x', join_code: 'ABCDEF', note: '' }]);
    const found = await findClassByJoinCode('abcdef');
    expect(found?.id).toBe(7);
    // The code is stored uppercase; the query must uppercase the input.
    expect(lastCall().params[0]).toBe('ABCDEF');
  });

  it('returns null for a malformed code without querying', async () => {
    expect(await findClassByJoinCode('abc')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('adds the member and reports whether it was new', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const joined = await joinClass(7, 9);
    expect(joined).toBe(true);
    const call = lastCall();
    // INSERT IGNORE: joining twice is not an error, it is simply not new.
    expect(call.sql).toContain('INSERT IGNORE INTO class_members');
    expect(call.params).toEqual([7, 9]);
  });

  it('reports false when the member was already there', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect(await joinClass(7, 9)).toBe(false);
  });

  it('refuses to let a teacher remove themselves by joining', async () => {
    // The teacher is a member row too (so the class has one roster). Joining
    // is fine; the point of this test is that the row carries no role —
    // authority comes from classes.teacher_id, never from membership.
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await joinClass(7, 3);
    expect(lastCall().sql).not.toContain('role');
  });
});

describe('the roster', () => {
  it('lists members with their join date, oldest first', async () => {
    scripted([
      { user_id: 9, username: '小明', joined_at: new Date('2026-11-01') },
      { user_id: 10, username: '小红', joined_at: new Date('2026-11-05') },
    ]);
    const members = await listClassMembers(7);
    expect(members).toHaveLength(2);
    // 列名带表别名：老成员的 id 必须靠 joined_at 排，而不是靠插入顺序。
    expect(lastCall().sql).toContain('ORDER BY m.joined_at ASC');
  });

  it('removes a member by user id', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await removeMember(7, 9)).toBe(true);
    expect(lastCall().params).toEqual([7, 9]);
  });

  it('reports false when there was nothing to remove', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect(await removeMember(7, 9)).toBe(false);
  });

  it('leaves a class as a student', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await leaveClass(7, 9)).toBe(true);
  });
});

describe('the lists', () => {
  it('lists the classes a teacher owns', async () => {
    scripted([{ id: 7, name: 'x', join_code: 'ABCDEF', note: '', member_count: 12 }]);
    const classes = await listTeacherClasses(3);
    expect(classes[0].memberCount).toBe(12);
    expect(lastCall().sql).toContain('COUNT');
  });

  it('lists the classes a student joined', async () => {
    scripted([{ id: 7, name: 'x', teacher_name: '王老师', member_count: 12 }]);
    const classes = await listStudentClasses(9);
    expect(classes[0].teacherName).toBe('王老师');
  });
});

describe('assignments', () => {
  it('stores the payload as JSON and the due date as YYYY-MM-DD', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 5 }, []]);
    const created = await createAssignment({
      classId: 7,
      title: '第 3 课生字',
      kind: 'worksheet',
      payload: { kind: 'worksheet', title: '第 3 课生字', worksheetId: 12, chars: ['学', '生'] },
      dueAt: '2026-11-28',
    });
    expect(created.id).toBe(5);
    const call = lastCall();
    expect(call.sql).toContain('INSERT INTO class_assignments');
    // The payload is a string in the params: mysql2 serialises the JSON
    // type from a string, and passing an object is driver-dependent.
    expect(typeof call.params[3]).toBe('string');
    expect(JSON.parse(call.params[3] as string).kind).toBe('worksheet');
  });

  it('accepts an assignment with no due date', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 6 }, []]);
    await createAssignment({
      classId: 7,
      title: 'x',
      kind: 'dictation',
      payload: { kind: 'dictation', title: 'x', items: [{ word: '学生', pinyin: 'xué shēng' }] },
      dueAt: null,
    });
    expect(lastCall().params[4]).toBeNull();
  });

  it('rejects a payload whose kind disagrees with the column', async () => {
    // The column is an ENUM; a mismatch would be rejected by MySQL with a
    // cryptic error. Refuse it here with a message that names the problem.
    await expect(
      createAssignment({
        classId: 7,
        title: 'x',
        kind: 'worksheet',
        payload: { kind: 'dictation', title: 'x', items: [{ word: '学生', pinyin: '' }] },
        dueAt: null,
      }),
    ).rejects.toThrow(/kind/i);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('lists assignments parsed, and skips a row whose payload is corrupt', async () => {
    scripted([
      {
        id: 5,
        title: 'ok',
        kind: 'worksheet',
        payload: JSON.stringify({ kind: 'worksheet', title: 'ok', worksheetId: 1, chars: ['学'] }),
        due_at: '2026-11-28',
        created_at: new Date('2026-11-20'),
      },
      {
        id: 6,
        title: 'broken',
        kind: 'worksheet',
        payload: '{not json',
        due_at: null,
        created_at: new Date('2026-11-21'),
      },
    ]);
    const assignments = await listAssignments(7);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].id).toBe(5);
  });

  it('reads the due date as a plain YYYY-MM-DD string', async () => {
    // mysql2 returns a DATE column as a Date at local midnight, which
    // JSON-serialises into a UTC timestamp — one day off for half the world.
    // The store must format it back to the calendar date.
    scripted([
      {
        id: 5,
        title: 'x',
        kind: 'worksheet',
        payload: JSON.stringify({ kind: 'worksheet', title: 'x', worksheetId: 1, chars: ['学'] }),
        due_at: new Date(2026, 10, 28),
        created_at: new Date(2026, 10, 20),
      },
    ]);
    const assignments = await listAssignments(7);
    expect(assignments[0].dueAt).toBe('2026-11-28');
  });

  it('deletes an assignment', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await deleteAssignment(7, 5)).toBe(true);
    // The class id is part of the WHERE: deleting another class's
    // assignment must be impossible even with a guessed id.
    expect(lastCall().params).toEqual([5, 7]);
  });
});
