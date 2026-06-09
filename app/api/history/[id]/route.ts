import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setFavorite, deleteHistory } from '@/lib/history';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_id', message: 'id 不合法' } }, { status: 400 });
  }

  let body: { is_favorite?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }
  if (typeof body.is_favorite !== 'boolean') {
    return NextResponse.json({ ok: false, error: { code: 'invalid_is_favorite', message: 'is_favorite 必填且为 boolean' } }, { status: 400 });
  }

  const ok = await setFavorite(user.id, id, body.is_favorite);
  if (!ok) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '记录不存在' } }, { status: 404 });
  return NextResponse.json({ ok: true, data: { id, is_favorite: body.is_favorite } });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_id', message: 'id 不合法' } }, { status: 400 });
  }

  const ok = await deleteHistory(user.id, id);
  if (!ok) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '记录不存在' } }, { status: 404 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'history_delete', metadata: { id }, ip, userAgent: ua });
  return new NextResponse(null, { status: 204 });
}
