import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorizedForLogin } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { getClassForUser, leaveClass, removeMember } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * DELETE /api/classes/[id]/members/[userId] — 移出一个成员。
 *
 * 两条不同的路，写在一个路由里是因为对存储层来说是同一件事：
 *
 *   老师移出别人 —— 班级管理。
 *   学生移出自己 —— 退出班级。
 *
 * 学生不能移出别人；老师也不能通过这条路由移出自己 —— 那等于解散班级，
 * 需要一次明确的、会把所有学生一起移出的操作（DELETE /api/classes/[id]），
 * 而不是一次误点的成员删除。
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const { id, userId } = await context.params;
    const classId = toId(id);
    const targetId = toId(userId);
    if (classId === null || targetId === null) {
      return badRequest('bad_input', 'id 不合法');
    }

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }

    const isSelf = targetId === user.id;
    const isTeacher = found.role === 'teacher';

    if (isSelf && isTeacher) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'forbidden',
            message: '老师不能把自己移出班级；要关闭这个班请用「解散班级」',
          },
        },
        { status: 403 },
      );
    }
    if (!isTeacher && !isSelf) {
      return NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '只有老师能移出其他成员' } },
        { status: 403 },
      );
    }

    const changed = isSelf
      ? await leaveClass(classId, user.id)
      : await removeMember(classId, targetId);

    if (!changed) {
      return NextResponse.json(
        { ok: false, error: { code: 'member_not_found', message: '这个人不在班级里' } },
        { status: 404 },
      );
    }

    await logUserAction(req, user.id, 'class_member_removed', {
      classId,
      targetUserId: targetId,
      by: isSelf ? 'self' : 'teacher',
    });

    return NextResponse.json({ ok: true, data: { removed: true } });
  });
}
