import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { deleteAssignment, getClassForUser } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * DELETE /api/classes/[id]/assignments/[assignmentId] — 删一份作业（仅老师）。
 *
 * 存储层的 WHERE 里同时带 id 和 class_id，所以即使猜对了作业 id，也只能
 * 删掉自己这个班的作业。
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id, assignmentId } = await context.params;
    const classId = toId(id);
    const targetId = toId(assignmentId);
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
    if (found.role !== 'teacher') {
      return NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '只有老师能删作业' } },
        { status: 403 },
      );
    }
    const deleted = await deleteAssignment(classId, targetId);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: { code: 'assignment_not_found', message: '作业不存在' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
