import { NextRequest, NextResponse } from 'next/server';
import { listChars } from '@/lib/rare-chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { searchQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = searchQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listChars(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
