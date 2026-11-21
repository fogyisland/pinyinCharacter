// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 班级与作业的 HTTP 接口。
 *
 * 这一层的职责是权限：谁能建班、谁能派作业、谁能看到一个班的名单。
 * 存储层把权限写进了 WHERE，但「学生不能派作业」这种判断必须在路由里 ——
 * 因为一个学生完全可能是别的班的老师，而 WHERE 只看 class_id。
 */

const {
  getCurrentUserMock,
  createClassMock,
  findClassByJoinCodeMock,
  joinClassMock,
  leaveClassMock,
  getClassForUserMock,
  listClassMembersMock,
  listTeacherClassesMock,
  listStudentClassesMock,
  removeMemberMock,
  listAssignmentsMock,
  createAssignmentMock,
  deleteAssignmentMock,
  deleteClassMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  createClassMock: vi.fn(),
  findClassByJoinCodeMock: vi.fn(),
  joinClassMock: vi.fn(),
  leaveClassMock: vi.fn(),
  getClassForUserMock: vi.fn(),
  listClassMembersMock: vi.fn(),
  listTeacherClassesMock: vi.fn(),
  listStudentClassesMock: vi.fn(),
  removeMemberMock: vi.fn(),
  listAssignmentsMock: vi.fn(),
  createAssignmentMock: vi.fn(),
  deleteAssignmentMock: vi.fn(),
  deleteClassMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/lib/audit', () => ({ logUserAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/classes-store', () => ({
  createClass: createClassMock,
  findClassByJoinCode: findClassByJoinCodeMock,
  joinClass: joinClassMock,
  leaveClass: leaveClassMock,
  getClassForUser: getClassForUserMock,
  listClassMembers: listClassMembersMock,
  listTeacherClasses: listTeacherClassesMock,
  listStudentClasses: listStudentClassesMock,
  removeMember: removeMemberMock,
  listAssignments: listAssignmentsMock,
  createAssignment: createAssignmentMock,
  deleteAssignment: deleteAssignmentMock,
  deleteClass: deleteClassMock,
}));

import { GET as listClasses, POST as createClassRoute } from '@/app/api/classes/route';
import { POST as joinClassRoute } from '@/app/api/classes/join/route';
import { GET as classDetail, DELETE as classDissolve } from '@/app/api/classes/[id]/route';
import {
  GET as assignmentsList,
  POST as assignmentsCreate,
} from '@/app/api/classes/[id]/assignments/route';
import { DELETE as assignmentDelete } from '@/app/api/classes/[id]/assignments/[assignmentId]/route';
import { DELETE as memberDelete } from '@/app/api/classes/[id]/members/[userId]/route';

const TEACHER = { id: 3, username: '王老师' };

function jsonReq(url: string, body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

beforeEach(() => {
  for (const mock of [
    getCurrentUserMock,
    createClassMock,
    findClassByJoinCodeMock,
    joinClassMock,
    leaveClassMock,
    getClassForUserMock,
    listClassMembersMock,
    listTeacherClassesMock,
    listStudentClassesMock,
    removeMemberMock,
    listAssignmentsMock,
    createAssignmentMock,
    deleteAssignmentMock,
    deleteClassMock,
  ]) {
    mock.mockReset();
  }
  getCurrentUserMock.mockResolvedValue(TEACHER);
  createClassMock.mockResolvedValue({ id: 7, joinCode: 'ABCDEF' });
  findClassByJoinCodeMock.mockResolvedValue({
    id: 7,
    teacherId: 3,
    name: 'HSK1 周三班',
    joinCode: 'ABCDEF',
    note: '',
    role: 'student',
  });
  joinClassMock.mockResolvedValue(true);
  leaveClassMock.mockResolvedValue(true);
  getClassForUserMock.mockResolvedValue({
    id: 7,
    teacherId: 3,
    name: 'HSK1 周三班',
    joinCode: 'ABCDEF',
    note: '',
    role: 'teacher',
  });
  listClassMembersMock.mockResolvedValue([
    { userId: 9, username: '小明', joinedAt: '2026-11-01T00:00:00.000Z' },
  ]);
  listTeacherClassesMock.mockResolvedValue([
    { id: 7, name: 'HSK1 周三班', joinCode: 'ABCDEF', note: '', memberCount: 12 },
  ]);
  listStudentClassesMock.mockResolvedValue([
    { id: 7, name: 'HSK1 周三班', note: '', teacherName: '王老师', memberCount: 12 },
  ]);
  removeMemberMock.mockResolvedValue(true);
  listAssignmentsMock.mockResolvedValue([
    {
      id: 5,
      title: '第 3 课生字',
      kind: 'worksheet',
      payload: { kind: 'worksheet', title: '第 3 课生字', worksheetId: 12, chars: ['学'] },
      dueAt: '2026-11-28',
      createdAt: '2026-11-20T00:00:00.000Z',
    },
  ]);
  createAssignmentMock.mockResolvedValue({ id: 5 });
  deleteAssignmentMock.mockResolvedValue(true);
  deleteClassMock.mockResolvedValue(true);
});

describe('GET /api/classes', () => {
  it('requires a login', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await listClasses(new NextRequest('http://localhost/api/classes'));
    expect(res.status).toBe(401);
  });

  it("returns the classes the user teaches AND the ones they joined", async () => {
    // 一个人可以是 A 班的老师、B 班的学生 —— 两边都要列出来。
    const res = await listClasses(new NextRequest('http://localhost/api/classes'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.teaching).toHaveLength(1);
    expect(body.data.joined).toHaveLength(1);
    expect(listTeacherClassesMock).toHaveBeenCalledWith(TEACHER.id);
    expect(listStudentClassesMock).toHaveBeenCalledWith(TEACHER.id);
  });
});

describe('POST /api/classes', () => {
  it('creates a class and returns the invite code', async () => {
    const res = await createClassRoute(jsonReq('/api/classes', { name: 'HSK1 周三班', note: '' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.id).toBe(7);
    expect(body.data.joinCode).toBe('ABCDEF');
    expect(createClassMock).toHaveBeenCalledWith({ teacherId: 3, name: 'HSK1 周三班', note: '' });
  });

  it('rejects an empty class name', async () => {
    // 空白班级名 = 学生列表里出现一个没有名字的班。
    const res = await createClassRoute(jsonReq('/api/classes', { name: '   ' }));
    expect(res.status).toBe(400);
    expect(createClassMock).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an object', async () => {
    const res = await createClassRoute(jsonReq('/api/classes', 'nope'));
    expect(res.status).toBe(400);
  });

  it('caps the note length instead of failing', async () => {
    // 备注是写给老师自己看的，超长不该让建班失败。
    const res = await createClassRoute(jsonReq('/api/classes', { name: 'x', note: 'y'.repeat(900) }));
    expect(res.status).toBe(200);
    const call = createClassMock.mock.calls[0][0] as { note: string };
    expect(call.note.length).toBeLessThanOrEqual(512);
  });
});

describe('POST /api/classes/join', () => {
  it('joins by invite code and reports a new membership', async () => {
    const res = await joinClassRoute(jsonReq('/api/classes/join', { code: 'abcdef' }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.classId).toBe(7);
    expect(body.data.created).toBe(true);
  });

  it('says so when the user is already a member instead of pretending to add them', async () => {
    joinClassMock.mockResolvedValue(false);
    const res = await joinClassRoute(jsonReq('/api/classes/join', { code: 'ABCDEF' }));
    const body = await res.json();
    expect(body.data.created).toBe(false);
  });

  it('answers 404 for an unknown code', async () => {
    findClassByJoinCodeMock.mockResolvedValue(null);
    const res = await joinClassRoute(jsonReq('/api/classes/join', { code: 'ZZZZZZ' }));
    expect(res.status).toBe(404);
  });

  it('rejects a malformed code before querying', async () => {
    const res = await joinClassRoute(jsonReq('/api/classes/join', { code: 'abc' }));
    expect(res.status).toBe(400);
    expect(findClassByJoinCodeMock).not.toHaveBeenCalled();
  });

  it('requires a login', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await joinClassRoute(jsonReq('/api/classes/join', { code: 'ABCDEF' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/classes/[id]', () => {
  it('shows the roster and the assignments to the teacher', async () => {
    const res = await classDetail(new NextRequest('http://localhost/api/classes/7'), {
      params: Promise.resolve({ id: '7' }),
    });
    const body = await res.json();
    expect(body.data.role).toBe('teacher');
    expect(body.data.members).toHaveLength(1);
    expect(body.data.assignments).toHaveLength(1);
    // 邀请码只有老师看得到：学生看到也无所谓，但没必要广播出去。
    expect(body.data.joinCode).toBe('ABCDEF');
  });

  it('hides the invite code from a student', async () => {
    // 学生已经在这个班里了，再给他邀请码只会让码扩散。
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'HSK1 周三班',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await classDetail(new NextRequest('http://localhost/api/classes/7'), {
      params: Promise.resolve({ id: '7' }),
    });
    const body = await res.json();
    expect(body.data.role).toBe('student');
    expect(body.data.joinCode).toBeNull();
  });

  it('answers 404 for someone outside the class', async () => {
    getClassForUserMock.mockResolvedValue(null);
    const res = await classDetail(new NextRequest('http://localhost/api/classes/7'), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id', async () => {
    const res = await classDetail(new NextRequest('http://localhost/api/classes/abc'), {
      params: Promise.resolve({ id: 'abc' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/classes/[id]/assignments', () => {
  it('lets the teacher create a worksheet assignment', async () => {
    const res = await assignmentsCreate(
      jsonReq('/api/classes/7/assignments', {
        title: '第 3 课生字',
        kind: 'worksheet',
        worksheetId: 12,
        chars: ['学', '生'],
        dueAt: '2026-11-28',
      }),
      { params: Promise.resolve({ id: '7' }) },
    );
    const body = await res.json();
    expect(body.data.id).toBe(5);
    expect(createAssignmentMock).toHaveBeenCalled();
  });

  it('refuses a student who tries to create an assignment', async () => {
    // 权限判定看的是「你是不是这个班的老师」，不是「你是不是登录了」。
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await assignmentsCreate(
      jsonReq('/api/classes/7/assignments', { title: 'x', kind: 'worksheet', chars: ['学'], worksheetId: 1 }),
      { params: Promise.resolve({ id: '7' }) },
    );
    expect(res.status).toBe(403);
    expect(createAssignmentMock).not.toHaveBeenCalled();
  });

  it('rejects a worksheet assignment with no characters', async () => {
    const res = await assignmentsCreate(
      jsonReq('/api/classes/7/assignments', { title: 'x', kind: 'worksheet', worksheetId: 1, chars: [] }),
      { params: Promise.resolve({ id: '7' }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects a malformed due date instead of storing it', async () => {
    // 2026-13-45 这种日期进到 DATE 列会让 MySQL 报错；提前拒绝并说清楚。
    const res = await assignmentsCreate(
      jsonReq('/api/classes/7/assignments', {
        title: 'x',
        kind: 'worksheet',
        worksheetId: 1,
        chars: ['学'],
        dueAt: '2026-13-45',
      }),
      { params: Promise.resolve({ id: '7' }) },
    );
    expect(res.status).toBe(400);
    expect(createAssignmentMock).not.toHaveBeenCalled();
  });

  it('accepts a dictation assignment whose items carry words', async () => {
    const res = await assignmentsCreate(
      jsonReq('/api/classes/7/assignments', {
        title: '听写',
        kind: 'dictation',
        items: [{ word: '学生', pinyin: 'xué shēng' }],
      }),
      { params: Promise.resolve({ id: '7' }) },
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/classes/[id]/assignments', () => {
  it('lists assignments for a member', async () => {
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await assignmentsList(new NextRequest('http://localhost/api/classes/7/assignments'), {
      params: Promise.resolve({ id: '7' }),
    });
    const body = await res.json();
    expect(body.data.assignments).toHaveLength(1);
  });

  it('refuses an outsider', async () => {
    getClassForUserMock.mockResolvedValue(null);
    const res = await assignmentsList(new NextRequest('http://localhost/api/classes/7/assignments'), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/classes/[id]/assignments/[assignmentId]', () => {
  it('lets the teacher delete an assignment', async () => {
    const res = await assignmentDelete(
      new NextRequest('http://localhost/api/classes/7/assignments/5', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', assignmentId: '5' }) },
    );
    expect(res.status).toBe(200);
    expect(deleteAssignmentMock).toHaveBeenCalledWith(7, 5);
  });

  it('refuses a student', async () => {
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await assignmentDelete(
      new NextRequest('http://localhost/api/classes/7/assignments/5', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', assignmentId: '5' }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/classes/[id] — dissolve', () => {
  it('lets the teacher dissolve a class', async () => {
    const res = await classDissolve(new NextRequest('http://localhost/api/classes/7', { method: 'DELETE' }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(res.status).toBe(200);
    expect(deleteClassMock).toHaveBeenCalledWith(7);
  });

  it('refuses a student', async () => {
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await classDissolve(new NextRequest('http://localhost/api/classes/7', { method: 'DELETE' }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(res.status).toBe(403);
    expect(deleteClassMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an outsider instead of revealing the class exists', async () => {
    // 班级 id 是自增的：403 等于告诉对方「这个 id 存在」，枚举一遍就知道
    // 全站有多少个班。
    getClassForUserMock.mockResolvedValue(null);
    const res = await classDissolve(new NextRequest('http://localhost/api/classes/7', { method: 'DELETE' }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/classes/[id]/members/[userId]', () => {
  it('lets the teacher remove a member', async () => {
    const res = await memberDelete(
      new NextRequest('http://localhost/api/classes/7/members/9', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', userId: '9' }) },
    );
    expect(res.status).toBe(200);
    expect(removeMemberMock).toHaveBeenCalledWith(7, 9);
  });

  it('lets a student remove THEMSELVES (leave)', async () => {
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await memberDelete(
      new NextRequest('http://localhost/api/classes/7/members/3', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', userId: '3' }) },
    );
    expect(res.status).toBe(200);
    expect(leaveClassMock).toHaveBeenCalledWith(7, 3);
  });

  it('refuses a student who tries to remove someone else', async () => {
    getClassForUserMock.mockResolvedValue({
      id: 7,
      teacherId: 3,
      name: 'x',
      joinCode: 'ABCDEF',
      note: '',
      role: 'student',
    });
    const res = await memberDelete(
      new NextRequest('http://localhost/api/classes/7/members/10', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', userId: '10' }) },
    );
    expect(res.status).toBe(403);
    expect(leaveClassMock).not.toHaveBeenCalled();
  });

  it('does not let the teacher remove themselves through this route', async () => {
    // 老师退出自己的班等于解散，那需要另一条明确的路径（连同学生一起
    // 移出），而不是一次误点的 DELETE。
    const res = await memberDelete(
      new NextRequest('http://localhost/api/classes/7/members/3', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '7', userId: '3' }) },
    );
    expect(res.status).toBe(403);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });
});
