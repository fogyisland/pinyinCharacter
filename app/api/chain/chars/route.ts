import { NextRequest, NextResponse } from 'next/server';
import { listChars as listCharsFromTable } from '@/lib/chars';
import { toneFromPinyin } from '@/lib/pinyin-tone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TONE_DIACRITIC_RE = /[āēīōūǔǎěǐǒùǜàèìòù]/;

export async function GET(req: NextRequest) {
  // 2026-07-03: per-difficulty char source for 拼音接龙 (pinyin solitaire).
  // Default 'chars-all' preserves legacy behavior. 'chars-level-1' =
  // level 1 only (easy — most chain-able neighbors); 'chars-level-1-2' =
  // level 1 + 2 (medium); 'chars-all' = no filter (hard — rare chars
  // break chains faster). 2026-07-03: switched from `lib/rare-chars` to
  // `lib/chars` because the `chars` table has the `level` column we
  // filter on; rare_chars is L3-only and didn't expose level.
  const source = (req.nextUrl.searchParams.get('source') ?? 'chars-all') as
    | 'chars-level-1' | 'chars-level-1-2' | 'chars-all';
  const allChars: Array<{ char: string; pinyin: string; meaning: string; radical: string; tone: 1 | 2 | 3 | 4 }> = [];
  // listChars pageSize is hardcoded 80; loop until exhausted (cap at 100 pages = 8000 chars)
  for (let page = 1; page <= 100; page++) {
    const result = await listCharsFromTable({ page });
    for (const c of result.chars) {
      if (source === 'chars-level-1' && c.level !== 1) continue;
      if (source === 'chars-level-1-2' && c.level !== 1 && c.level !== 2) continue;
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
  }
  // 2026-07-04: was `public, max-age=3600`. Switched to `no-store`
  // because the prior version of this route returned `[]` for the new
  // `chars-level-1` source (the old route used lib/rare-chars which has
  // no `level` column, so the filter always skipped everything).
  // Browsers dutifully cached that `[]` for 1 hour — users with the
  // stale cache hit "no valid starter" even after the route was fixed.
  // The client-side fetchChainChars() already memoizes by source for
  // 1h in module-level state, so we don't need HTTP caching here.
  return NextResponse.json(allChars, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
