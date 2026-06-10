import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { getUserDetail, generateTempPassword, setUserPasswordHash } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });
  }
  if (id === auth.user.id) {
    return NextResponse.json({ ok: false, error: { code: 'cannot_reset_self', message: '请使用「忘记密码」重置自己的密码' } }, { status: 400 });
  }

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  await setUserPasswordHash(id, hash);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_password_reset',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });

  return NextResponse.json({ ok: true, data: { tempPassword } });
}
