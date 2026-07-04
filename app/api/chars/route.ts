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
      hskLevel: sp.get('hskLevel') ?? undefined,
      page: sp.get('page') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const { level, hskLevel, ...rest } = parsed.data;
    const result = await listChars({
      ...rest,
      level: level as 1 | 2 | 3 | undefined,
      hskLevel: hskLevel as 1 | 2 | 3 | 4 | 5 | 6 | undefined,
    });
    // 2026-07-04: DragMatchGame pulls from /api/chars and uses hskLevel to
    // tier the char pool. Surface hskFallback so the client can render
    // <FallbackBanner /> when an HSK level has no imported chars yet.
    // After the SQL filter there shouldn't be any null hskLevel rows
    // (filter excludes them); we conservatively report hskFallback=false
    // here and let the client decide whether to show the banner based on
    // empty-result signals. Server-side fallback to chars.level is a
    // future enhancement.
    const hskFallback = false;
    return NextResponse.json(
      { ok: true, data: result, hskFallback },
      {
        headers: {
          // 2026-07-04: per feedback-cache-control-route-iterations.md,
          // default to no-store in dev so iteration doesn't get masked
          // by browser HTTP cache.
          'Cache-Control': 'no-store',
        },
      },
    );
  });
}
