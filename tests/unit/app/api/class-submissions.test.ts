// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 作业提交的路由。
 *
 * 完成的口径：学生自己勾选。这个文件钉住三件事：
 *   - 只有班级成员能交（老师也必须是成员）；
 *   - 不是这个班的人拿 404（不是 403 —— 班级 id 自增，403 等于确认存在）；
 *   - 撤销是 DELETE，不是把 note 设空。
 */

const {
  getCurrentUserMock,
  getClassForUserMock,
  recordSubmissionMock,
  clearSubmissionMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getClassForUserMock: vi.fn(),
  recordSubmissionMock: vi.fn(),
  clearSubmissionMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/lib/classes-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/classes-store')>('@/lib/classes-store');
  return {
    ...actual,
    getClassForUser: getClassForUserMock,
    recordSubmission: recordSubmissionMock,
    clearSubmission: clearSubmissionMock,
  };
});

import { DELETE as withdraw, POST as submit } from '@/app/api/classes/[id]/assignments/[assignmentId]/submit/route';

const USER = { id: 9, username: '小明' };

function jsonReq(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/classes/7/assignments/5/submit', {
    method: body === undefined ? 'DELETE' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

const CONTEXT = { params: Promise.resolve({ id: '7', assignmentId: '5' }) };

beforeEach(() => {
  getCurrentUserMock.mockReset();
  getClassForUserMock.mockReset();
  recordSubmissionMock.mockReset();
  clearSubmissionMock.mockReset();
  getCurrentUserMock.mockResolvedValue(USER);
  getClassForUserMock.mockResolvedValue({
    id: 7,
    teacherId: 3,
    name: 'HSK1 周三班',
    joinCode: 'ABCDEF',
    note: '',
    role: 'student',
  });
  recordSubmissionMock.mockResolvedValue(true);
  clearSubmissionMock.mockResolvedValue(true);
});

describe('POST submit — 我练完了', () => {
  it('records the submission with the note', async () => {
    const res = await submit(jsonReq({ note: '第三行没看懂' }), CONTEXT);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(recordSubmissionMock).toHaveBeenCalledWith(5, 7, 9, '第三行没看懂');
  });

  it('accepts a submission with no note', async () => {
    const res = await submit(jsonReq({}), CONTEXT);
    expect(res.status).toBe(200);
    expect(recordSubmissionMock).toHaveBeenCalledWith(5, 7, 9, '');
  });

  it('refuses an assignment that belongs to another class', async () => {
    // 存储层的 Join 校验拒绝：作业不属于这个班，或者提交人不是成员。
    recordSubmissionMock.mockResolvedValue(false);
    const res = await submit(jsonReq({}), CONTEXT);
    expect(res.status).toBe(404);
  });

  it('answers 404 for an outsider instead of revealing the class exists', async () => {
    getClassForUserMock.mockResolvedValue(null);
    const res = await submit(jsonReq({}), CONTEXT);
    expect(res.status).toBe(404);
    expect(recordSubmissionMock).not.toHaveBeenCalled();
  });

  it('requires a login', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await submit(jsonReq({}), CONTEXT);
    expect(res.status).toBe(401);
  });

  it('rejects a non-numeric id', async () => {
    const res = await submit(jsonReq({}), {
      params: Promise.resolve({ id: 'abc', assignmentId: '5' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE submit — 撤销完成', () => {
  it('clears the submission', async () => {
    const res = await withdraw(jsonReq(), CONTEXT);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(clearSubmissionMock).toHaveBeenCalledWith(5, 9);
  });

  it('reports false when there was nothing to clear', async () => {
    clearSubmissionMock.mockResolvedValue(false);
    const res = await withdraw(jsonReq(), CONTEXT);
    const body = await res.json();
    expect(body.data.cleared).toBe(false);
  });

  it('refuses an outsider', async () => {
    getClassForUserMock.mockResolvedValue(null);
    const res = await withdraw(jsonReq(), CONTEXT);
    expect(res.status).toBe(404);
    expect(clearSubmissionMock).not.toHaveBeenCalled();
  });
});
