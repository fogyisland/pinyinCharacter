import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorizedForLogin } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { createClassSchema } from '@/lib/classes-schema';
import { createClass, listStudentClasses, listTeacherClasses } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/classes — 我的班级。
 *
 * 一个人可能既是老师又是学生（教一个班、在另一个班学），所以两条列表
 * 一起返回。只要一条会让「我加入的班」在「我的班级」页里消失。
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const [teaching, joined] = await Promise.all([
      listTeacherClasses(user.id),
      listStudentClasses(user.id),
    ]);
    return NextResponse.json({ ok: true, data: { teaching, joined } });
  });
}

/**
 * POST /api/classes — 建班。
 *
 * 返回邀请码：老师要把它发到群里、写在黑板上。
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const parsed = createClassSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const created = await createClass({
      teacherId: user.id,
      name: parsed.data.name,
      note: parsed.data.note,
    });
    await logUserAction(req, user.id, 'class_created', {
      classId: created.id,
      name: parsed.data.name,
    });
    return NextResponse.json({ ok: true, data: created });
  });
}
