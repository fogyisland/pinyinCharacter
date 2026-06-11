import { NextRequest, NextResponse } from 'next/server';
import { getDailyChar } from '@/lib/rare-chars';
import { withErrorHandling } from '@/lib/api-handler';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const dateStr = req.nextUrl.searchParams.get('date') ?? todayLocal();
    const result = await getDailyChar(dateStr);
    if (!result) {
      return NextResponse.json({ ok: false, error: 'no_chars' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, data: result });
  });
}
