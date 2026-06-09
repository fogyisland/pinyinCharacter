import { NextResponse } from 'next/server';
import { convertSentence } from '@/server/sentence-converter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pinyin = url.searchParams.get('pinyin');
  if (!pinyin) {
    return NextResponse.json({ ok: false, error: 'pinyin required', code: 'missing_pinyin' }, { status: 400 });
  }
  const safeMode = url.searchParams.get('safeMode') === 'true';
  const script = (url.searchParams.get('script') ?? 'simplified') as 'simplified' | 'traditional';
  const sentence = convertSentence(pinyin, safeMode, script);
  return NextResponse.json({ ok: true, data: { sentence } });
}
