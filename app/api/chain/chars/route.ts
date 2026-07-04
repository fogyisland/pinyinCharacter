import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listChars as listCharsFromTable } from '@/lib/chars';
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
  source: z
    .enum(['chars-level-1', 'chars-level-1-2', 'chars-all'])
    .default('chars-all'),
  hskLevel: z.coerce.number().int().min(1).max(6).optional(),
});

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

  const allChars: Array<{
    char: string;
    pinyin: string;
    meaning: string;
    radical: string;
    tone: 1 | 2 | 3 | 4;
  }> = [];
  // 2026-07-04 W2 fold-in: wrap each page in try/catch so a transient
  // DB error on one page doesn't blow up the entire response. Continue
  // with whatever we've gathered so far.
  let pagesFetched = 0;
  let pagesFailed = 0;
  // listChars pageSize is hardcoded 80; loop until exhausted (cap at 100 pages = 8000 chars)
  for (let page = 1; page <= 100; page++) {
    try {
      const result = await listCharsFromTable({ page });
      pagesFetched++;
      for (const c of result.chars) {
        // HSK filter takes precedence over source filter (both are
        // "narrow by char membership" — and HSK is the stricter axis).
        if (hskLevel != null) {
          if (c.hskLevel !== hskLevel) continue;
        } else {
          if (source === 'chars-level-1' && c.level !== 1) continue;
          if (source === 'chars-level-1-2' && c.level !== 1 && c.level !== 2) continue;
        }
        if (!c.pinyin || !TONE_DIACRITIC_RE.test(c.pinyin)) continue;
        const tone = toneFromPinyin(c.pinyin);
        if (tone === null) continue;
        allChars.push({
          char: c.char,
          pinyin: c.pinyin,
          meaning: c.meaningZh ?? '',
          radical: c.radical || '',
          tone,
        });
      }
      if (result.chars.length < 80) break; // last page
    } catch (err) {
      pagesFailed++;
      console.error(`[chain/chars] page ${page} failed:`, err);
      // Continue with whatever we've gathered so far. Don't fail the whole route.
    }
  }
  // hskFallback: if HSK filter was requested but yielded zero rows
  // (or pages all failed), the client should know to show the
  // FallbackBanner instead of "no valid starter".
  const hskFallback =
    hskLevel != null && (allChars.length === 0 || pagesFailed > 0);
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