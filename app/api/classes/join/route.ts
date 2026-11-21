import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { joinClassSchema } from '@/lib/classes-schema';
import { findClassByJoinCode, joinClass } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/classes/join — 用邀请码进班。
 *
 * 三种结果都要说清楚：
 *   404 邀请码不存在
 *   200 created: true   这次进去了
 *   200 created: false  本来就在这个班里（不是错误，只是不重复添加）
 *
 * 老师也能用这条路进自己的班（加入后出现两次名字的场景由成员表的唯一
 * 索引挡住），所以这里不排除老师。
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const parsed = joinClassSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const found = await findClassByJoinCode(parsed.data.code);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '邀请码不存在或已失效' } },
        { status: 404 },
      );
    }
    const created = await joinClass(found.id, user.id);
    await logUserAction(req, user.id, 'class_joined', {
      classId: found.id,
      created,
    });
    return NextResponse.json({ ok: true, data: { classId: found.id, created } });
  });
}
