import { NextResponse } from 'next/server';
import { getCandidates } from '@/server/dictionary';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pinyin = url.searchParams.get('pinyin');
  if (!pinyin) {
    return NextResponse.json({ ok: false, error: 'pinyin required', code: 'missing_pinyin' }, { status: 400 });
  }
  const safeMode = url.searchParams.get('safeMode') === 'true';
  const script = (url.searchParams.get('script') ?? 'simplified') as 'simplified' | 'traditional';
  const candidates = getCandidates(pinyin, safeMode, script);
  return NextResponse.json({ ok: true, data: { candidates } });
}
