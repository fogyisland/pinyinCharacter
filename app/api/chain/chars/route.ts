import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listChainCharPool } from '@/lib/chars';
import { toneFromPinyin } from '@/lib/pinyin-tone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TONE_DIACRITIC_RE = /[āēīōūǔǎěǐǒùǜàèìòù]/;

// 2026-07-04: added hskLevel param for /game progressive reveal (Task 6).
// When provided, rows are filtered to chars.hsk_level === hskLevel. The
// `hskFallback` flag tells the client whether the response came from the
// strict HSK filter (false) or the relaxed per-source pool (true) — used
// by FallbackBanner in Task 7.
const QuerySchema = z.object({
  source: z.enum(['chars-level-1', 'chars-level-1-2', 'chars-all']).default('chars-all'),
  hskLevel: z.coerce.number().int().min(1).max(6).optional(),
});

/**
 * chars.level membership per source. 'chars-all' = no level filter (hard —
 * rare chars break chains faster).
 */
const SOURCE_LEVELS: Record<'chars-level-1' | 'chars-level-1-2' | 'chars-all', Array<1 | 2 | 3>> = {
  'chars-level-1': [1],
  'chars-level-1-2': [1, 2],
  'chars-all': [],
};

export async function GET(req: NextRequest) {
  // 2026-07-03: per-difficulty char source for 拼音接龙 (pinyin solitaire).
  // Default 'chars-all' preserves legacy behavior. 'chars-level-1' =
  // level 1 only (easy — most chain-able neighbors); 'chars-level-1-2' =
  // level 1 + 2 (medium); 'chars-all' = no filter (hard — rare chars
  // break chains faster). 2026-07-03: switched from `lib/rare-chars` to
  // `lib/chars` because the `chars` table has the `level` column we
  // filter on; rare_chars is L3-only and didn't expose level.
  // 2026-07-04: zod-parsed QuerySchema adds optional hskLevel filter.
  const parsed = QuerySchema.safeParse({
    source: req.nextUrl.searchParams.get('source') ?? 'chars-all',
    hskLevel: req.nextUrl.searchParams.get('hskLevel') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { source, hskLevel } = parsed.data;

  // 2026-07-04 W2 fold-in: a transient DB error must not blow up the whole
  // response. We keep whatever we gathered and flag the failure so the
  // client can show its fallback banner.
  // 2026-10-24 (perf): the pool used to be assembled by paging through
  // listChars() 100 times — ~200 SQL round-trips per request. The filters
  // are pushed into a single SQL query now (see lib/chars.ts).
  let poolFailed = false;
  let rows: Awaited<ReturnType<typeof listChainCharPool>> = [];
  try {
    rows = await listChainCharPool({
      levels: hskLevel != null ? undefined : SOURCE_LEVELS[source],
      hskLevel,
    });
  } catch (err) {
    poolFailed = true;
    console.error('[chain/chars] char pool query failed:', err);
  }

  const allChars: Array<{
    char: string;
    pinyin: string;
    meaning: string;
    radical: string;
    tone: 1 | 2 | 3 | 4;
  }> = [];
  for (const row of rows) {
    if (!row.pinyin || !TONE_DIACRITIC_RE.test(row.pinyin)) continue;
    const tone = toneFromPinyin(row.pinyin);
    if (tone === null) continue;
    allChars.push({
      char: row.char,
      pinyin: row.pinyin,
      meaning: row.meaningZh ?? '',
      radical: row.radical,
      tone,
    });
  }

  // hskFallback: if HSK filter was requested but yielded zero rows
  // (or the query failed), the client should know to show the
  // FallbackBanner instead of "no valid starter".
  const hskFallback = hskLevel != null && (allChars.length === 0 || poolFailed);
  // 2026-07-04: was `public, max-age=3600`. Switched to `no-store`
  // because the prior version of this route returned `[]` for the new
  // `chars-level-1` source (the old route used lib/rare-chars which has
  // no `level` column, so the filter always skipped everything).
  // Browsers dutifully cached that `[]` for 1 hour — users with the
  // stale cache hit "no valid starter" even after the route was fixed.
  // The client-side fetchChainChars() already memoizes by source for
  // 1h in module-level state, so we don't need HTTP caching here.
  return NextResponse.json(
    { chars: allChars, hskFallback },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
