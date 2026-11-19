import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listIdioms } from '@/lib/idioms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The query the route accepts.
 *
 * `level` picks the difficulty band of the idioms; `maxLevel` caps it, so
 * a tier can ask for "level 3 or easier" and still reach the literary rows;
 * `limit` caps how many rows come back so the game is not handed the whole
 * table. All are optional — with none, the route returns every idiom.
 */
const QuerySchema = z.object({
  level: z.coerce.number().int().min(1).max(4).optional(),
  maxLevel: z.coerce.number().int().min(1).max(4).optional(),
  category: z.string().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    level: req.nextUrl.searchParams.get('level') ?? undefined,
    maxLevel: req.nextUrl.searchParams.get('maxLevel') ?? undefined,
    category: req.nextUrl.searchParams.get('category') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // A missing table is a state, not a failure of the request: the
  // migration that creates `idioms` may not have run on this database yet.
  // The game reads `failed` and shows an empty-state message, instead of
  // the whole page failing to render.
  let failed = false;
  let idioms: Awaited<ReturnType<typeof listIdioms>> = [];
  try {
    idioms = await listIdioms(parsed.data);
  } catch (err) {
    failed = true;
    console.error('[idioms] query failed:', err);
  }

  return NextResponse.json(
    { idioms, failed },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
