import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createHistory, listHistory, findRecentDuplicate } from '@/lib/history';
import { writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const favorite = sp.get('favorite') === 'true';
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;

  const rows = await listHistory({ userId: user.id, favoriteOnly: favorite, limit, offset });
  return NextResponse.json({ ok: true, data: { history: rows } });
}

interface PostBody {
  kind?: 'text2pinyin' | 'pinyin2text';
  input?: string;
  output?: string | null;
  char_count?: number;
  dedup?: boolean;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  let body: PostBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const { kind, input, output, char_count: charCount, dedup = true } = body;
  if (!kind || (kind !== 'text2pinyin' && kind !== 'pinyin2text')) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_kind', message: 'kind 必须为 text2pinyin 或 pinyin2text' } }, { status: 400 });
  }
  if (typeof input !== 'string' || !input) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_input', message: 'input 必填' } }, { status: 400 });
  }
  if (typeof charCount !== 'number' || charCount < 0 || charCount > 100000) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_char_count', message: 'char_count 不合法' } }, { status: 400 });
  }

  if (dedup) {
    const dup = await findRecentDuplicate(user.id, kind, input);
    if (dup) return NextResponse.json({ ok: true, data: { id: dup, deduped: true } });
  }

  const id = await createHistory({ userId: user.id, kind, input, output: output ?? null, charCount });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'history_create', metadata: { kind, charCount, id }, ip, userAgent: ua });
  return NextResponse.json({ ok: true, data: { id, deduped: false } });
}
