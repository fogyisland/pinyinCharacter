import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { disableUser, isUserDisabled } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, ctx: Ctx) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      return badRequest('bad_id', 'invalid id');
    }
    if (id === auth.user.id) {
      return badRequest('self_disable', 'cannot disable yourself');
    }

    if (!(await isUserDisabled(id))) {
      await disableUser(id, auth.user.id);
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
      const ua = req.headers.get('user-agent') ?? null;
      await writeAudit({
        userId: auth.user.id, event: 'user_disabled',
        metadata: { targetUserId: id },
        ip, userAgent: ua,
      });
    }
    return NextResponse.json({ ok: true, data: { id, disabled: true } });
  });
}
