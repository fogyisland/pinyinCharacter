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
    if (!parsed.success)
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const { level, hskLevel, ...rest } = parsed.data;
    const requestedHsk = hskLevel as 1 | 2 | 3 | 4 | 5 | 6 | undefined;
    let result = await listChars({
      ...rest,
      level: level as 1 | 2 | 3 | undefined,
      hskLevel: requestedHsk,
    });
    // 2026-11-03: the HSK fallback is now real.
    //
    // `chars.hsk_level` is filled by `scripts/import-hsk.ts` — a deployment
    // script, not a migration, so a server that never ran it has a NULL in
    // every row. The SQL filter then returns nothing and the client gets an
    // empty pool with no explanation.
    //
    // The old comment here called the server-side fallback "a future
    // enhancement"; on a server whose HSK grading was never imported it is
    // the difference between a playable game and an empty one. The fallback
    // keeps the `level` filter and drops the HSK one — the tier is the
    // narrower of the two, so widening it means dropping the HSK clause.
    let hskFallback = false;
    let hskTierEmpty = false;
    if (requestedHsk != null && result.chars.length === 0) {
      hskFallback = true;
      hskTierEmpty = true;
      console.error(
        `[chars] HSK ${requestedHsk} returned no rows — the HSK grading was not imported on this server; falling back to the unfiltered pool`,
      );
      result = await listChars({
        ...rest,
        level: level as 1 | 2 | 3 | undefined,
        hskLevel: undefined,
      });
    }
    return NextResponse.json(
      { ok: true, data: result, hskFallback, hskTierEmpty },
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
