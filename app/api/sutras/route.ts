import { NextRequest, NextResponse } from 'next/server';
import { listSutras } from '@/lib/sutras';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { sutraListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = sutraListQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listSutras(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
