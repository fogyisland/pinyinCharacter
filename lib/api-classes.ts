// 班级与作业的客户端接口。
//
// 与 lib/api-auth.ts 分开：那个文件只处理登录注册，这里是班级与作业。
// 两者的错误形状相同（ApiResult），但不是同一个功能域。

export type ClassApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function call<T>(path: string, init: RequestInit = {}): Promise<ClassApiResult<T>> {
  try {
    const res = await fetch(path, { ...init, credentials: 'same-origin' });
    const body = (await res.json().catch(() => null)) as ClassApiResult<T> | null;
    if (!body) {
      return {
        ok: false,
        error: { code: 'bad_response', message: `服务器返回了无法解析的内容 (HTTP ${res.status})` },
      };
    }
    return body;
  } catch (error) {
    // 网络断掉时 fetch 抛异常：把它变成同一种错误形状，调用方只处理一种。
    return {
      ok: false,
      error: { code: 'network', message: `网络异常：${(error as Error).message}` },
    };
  }
}

/** 老师名下的班级。 */
export interface TeacherClass {
  id: number;
  name: string;
  joinCode: string;
  note: string;
  memberCount: number;
}

/** 学生加入的班级。 */
export interface StudentClass {
  id: number;
  name: string;
  note: string;
  teacherName: string;
  memberCount: number;
}

/** 班级成员。 */
export interface MemberView {
  userId: number;
  username: string;
  joinedAt: string;
}

/** 作业载荷（与 lib/classes.ts 的形状一致，客户端只读）。 */
export type AssignmentView =
  | {
      kind: 'worksheet';
      title: string;
      worksheetId: number;
      chars: string[];
    }
  | {
      kind: 'dictation';
      title: string;
      items: Array<{ word: string; pinyin: string }>;
    };

/** 一份作业。 */
export interface AssignmentViewItem {
  id: number;
  title: string;
  kind: 'worksheet' | 'dictation';
  payload: AssignmentView;
  dueAt: string | null;
  createdAt: string;
}

/** 班级详情。 */
export interface ClassDetail {
  id: number;
  name: string;
  note: string;
  role: 'teacher' | 'student';
  /** 学生看到的是 null。 */
  joinCode: string | null;
  teacherId: number;
  members: MemberView[];
  assignments: AssignmentViewItem[];
}

export async function fetchMyClasses(): Promise<
  ClassApiResult<{ teaching: TeacherClass[]; joined: StudentClass[] }>
> {
  return call('/api/classes');
}

export async function createClassRequest(
  name: string,
  note: string,
): Promise<ClassApiResult<{ id: number; joinCode: string }>> {
  return call('/api/classes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, note }),
  });
}

export async function joinClassRequest(
  code: string,
): Promise<ClassApiResult<{ classId: number; created: boolean }>> {
  return call('/api/classes/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export async function fetchClassDetail(classId: number): Promise<ClassApiResult<ClassDetail>> {
  return call(`/api/classes/${classId}`);
}

export async function dissolveClassRequest(classId: number): Promise<ClassApiResult<{ deleted: boolean }>> {
  return call(`/api/classes/${classId}`, { method: 'DELETE' });
}

export async function removeMemberRequest(
  classId: number,
  userId: number,
): Promise<ClassApiResult<{ removed: boolean }>> {
  return call(`/api/classes/${classId}/members/${userId}`, { method: 'DELETE' });
}

/** 派作业的请求体。 */
export type CreateAssignmentBody =
  | {
      title: string;
      kind: 'worksheet';
      worksheetId: number;
      chars: string[];
      dueAt?: string | null;
    }
  | {
      title: string;
      kind: 'dictation';
      items: Array<{ word: string; pinyin: string }>;
      dueAt?: string | null;
    };

export async function createAssignmentRequest(
  classId: number,
  body: CreateAssignmentBody,
): Promise<ClassApiResult<{ id: number }>> {
  return call(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteAssignmentRequest(
  classId: number,
  assignmentId: number,
): Promise<ClassApiResult<{ deleted: boolean }>> {
  return call(`/api/classes/${classId}/assignments/${assignmentId}`, { method: 'DELETE' });
}
