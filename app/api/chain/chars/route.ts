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
  return NextResponse.json(allChars, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
