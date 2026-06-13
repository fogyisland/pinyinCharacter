import { NextRequest, NextResponse } from 'next/server';
import { listChars } from '@/lib/chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { charsListQuerySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = charsListQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      letter: sp.get('letter') ?? undefined,
      radical: sp.get('radical') ?? undefined,
      level: sp.get('level') ?? undefined,
      page: sp.get('page') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const { level, ...rest } = parsed.data;
    const result = await listChars({ ...rest, level: level as 1 | 2 | 3 | undefined });
    return NextResponse.json({ ok: true, data: result });
  });
}
