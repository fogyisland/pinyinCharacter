import { NextRequest, NextResponse } from 'next/server';
import { getAvailableForms } from '@/lib/poetry';
import { withErrorHandling, badRequest } from '@/lib/api-handler';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const category = req.nextUrl.searchParams.get('category') ?? 'tang';
    if (category.length > 32) return badRequest('bad_input', 'category too long');
    const forms = await getAvailableForms(category);
    return NextResponse.json({ ok: true, forms });
  });
}