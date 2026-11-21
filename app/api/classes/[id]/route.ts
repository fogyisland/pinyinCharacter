import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getClassForUser, listAssignments, listClassMembers } from '@/lib/classes-store';
import { sortAssignments } from '@/lib/classes';

export const dynamic = 'force-dynamic';

/** 解析路径里的 id；不是正整数就返回 null。 */
function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * GET /api/classes/[id] — 一个班的详情：成员名单 + 作业列表。
 *
 * 老师看到邀请码（要发出去），学生看不到 —— 学生已经在班里了，再把码
 * 广播给他只会让码扩散。
 *
 * 不是这个班的人得到 404 而不是 403：403 等于告诉对方「这个 id 存在」，
 * 而班级 id 是自增的，枚举一遍就知道全站有多少个班。
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await context.params;
    const classId = toId(id);
    if (classId === null) return badRequest('bad_input', '班级 id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }
    const [members, assignments] = await Promise.all([
      listClassMembers(classId),
      listAssignments(classId),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        id: found.id,
        name: found.name,
        note: found.note,
        role: found.role,
        joinCode: found.role === 'teacher' ? found.joinCode : null,
        teacherId: found.teacherId,
        members,
        assignments: sortAssignments(assignments),
      },
    });
  });
}

/**
 * DELETE /api/classes/[id] — 解散班级（仅老师）。
 *
 * 只是因为「误建的班」需要一个退路。成员与作业由外键级联删除。
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await context.params;
    const classId = toId(id);
    if (classId === null) return badRequest('bad_input', '班级 id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }
    if (found.role !== 'teacher') {
      return NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '只有老师能解散班级' } },
        { status: 403 },
      );
    }
    const { deleteClass } = await import('@/lib/classes-store');
    await deleteClass(classId);
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
