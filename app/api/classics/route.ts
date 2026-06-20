import { NextRequest, NextResponse } from 'next/server';
import { listClassics } from '@/lib/classics';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { classicsListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = classicsListQuerySchema.safeParse({
      category: sp.get('category') ?? undefined,
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listClassics(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
