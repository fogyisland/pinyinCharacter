import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, validateUsername } from '@/lib/auth';
import { getUserDetail, deleteUserCascade, countOtherAdmins } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

function asIdInt(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = asIdInt(idStr);
  if (!id) return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  return NextResponse.json({ ok: true, data: detail });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = asIdInt(idStr);
  if (!id) return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });

  if (id === auth.user.id) {
    return NextResponse.json({ ok: false, error: { code: 'cannot_delete_self', message: '不能删除自己' } }, { status: 400 });
  }

  let body: { confirmUsername?: string };
  try { body = await req.json(); } catch { body = {}; }
  const confirm = (body.confirmUsername ?? '').trim();
  const uErr = validateUsername(confirm);
  // 用户名格式错误时也算 mismatch（不区分原因以减少信息泄露）
  void uErr;

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  if (confirm !== detail.user.username) {
    return NextResponse.json({ ok: false, error: { code: 'username_mismatch', message: '用户名不匹配' } }, { status: 400 });
  }
  if (detail.user.isAdmin) {
    const others = await countOtherAdmins(id);
    if (others === 0) {
      return NextResponse.json({ ok: false, error: { code: 'last_admin', message: '至少保留一个管理员' } }, { status: 400 });
    }
  }

  await deleteUserCascade(id);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_delete',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });
  return new NextResponse(null, { status: 204 });
}
