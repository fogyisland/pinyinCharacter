import { NextRequest, NextResponse } from 'next/server';
import { getAvailableForms } from '@/lib/poetry';
import { withErrorHandling } from '@/lib/api-handler';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const category = req.nextUrl.searchParams.get('category') ?? 'tang';
    const forms = await getAvailableForms(category);
    return NextResponse.json({ ok: true, data: { forms } });
  });
}