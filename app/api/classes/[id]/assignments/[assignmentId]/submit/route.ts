import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { clearSubmission, getClassForUser, recordSubmission } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

const SubmitSchema = z.object({
  /** 学生可以留一句话（最长 512，超出截断）。 */
  note: z.string().max(512 * 4).optional().or(z.literal('')),
});

function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * POST /api/classes/[id]/assignments/[assignmentId]/submit — 我练完了。
 *
 * 完成的口径是**学生自己勾选**。打印、朗读、听写对了几条都不自动算完成：
 * 打印一张纸不等于练了，而误判的代价（老师/家长/院方看到的报告）比
 * 「学生忘了勾」大得多。
 *
 * 老师也能提交（教自己班的人可能也在别的班学），但这里的班级归属校验
 * 会要求提交人是这个班的成员 —— 老师必须在成员表里，否则不能交。
 */
export async function POST(
  req: NextRequest,
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

    // 不是这个班的人拿 404，而不是 403（班级 id 自增，403 等于确认存在）。
    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }

    const parsed = SubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }

    const recorded = await recordSubmission(targetId, classId, user.id, parsed.data.note ?? '');
    if (!recorded) {
      // 作业不属于这个班，或者提交人不是成员 —— 存储层的 Join 校验拒绝了。
      return NextResponse.json(
        { ok: false, error: { code: 'assignment_not_found', message: '这份作业不属于这个班' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, data: { recorded: true } });
  });
}

/** DELETE — 撤销完成（勾错了，或者想重练）。 */
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

    const cleared = await clearSubmission(targetId, user.id);
    return NextResponse.json({ ok: true, data: { cleared } });
  });
}
