import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listDuiyunPairs } from '@/lib/duiyun-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The query the route accepts.
 *
 * `limit` caps how many pairs come back — the corpus holds several hundred,
 * and the game draws one at a time.
 */
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // The data file missing is a state, not a failure of the request: a fresh
  // clone that has not run `scripts/build-duiyun.ts` has no couplets at all.
  // The game reads `failed` and shows an empty-state message, instead of the
  // whole page failing to render.
  let failed = false;
  let pairs: ReturnType<typeof listDuiyunPairs> = [];
  try {
    pairs = listDuiyunPairs(parsed.data);
  } catch (err) {
    failed = true;
    console.error('[duiyun] the pairs could not be read:', err);
  }

  return NextResponse.json(
    { pairs, failed },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
