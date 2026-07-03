import { NextResponse } from 'next/server';
import { listChars } from '@/lib/rare-chars';
import { getRadical } from '@/lib/radical';
import { toneFromPinyin } from '@/lib/pinyin-tone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TONE_DIACRITIC_RE = /[āēīōūǔǎěǐǒùǜàèìòù]/;

export async function GET() {
  const allChars: Array<{ char: string; pinyin: string; meaning: string; radical: string; tone: 1 | 2 | 3 | 4 }> = [];
  // listChars pageSize is hardcoded 80; loop until exhausted (cap at 100 pages = 8000 chars)
  for (let page = 1; page <= 100; page++) {
    const result = await listChars({ page });
    for (const c of result.chars) {
      if (!c.pinyin || !TONE_DIACRITIC_RE.test(c.pinyin)) continue;
      const tone = toneFromPinyin(c.pinyin);
      if (tone === null) continue;
      allChars.push({
        char: c.char,
        pinyin: c.pinyin,
        meaning: c.meaning ?? '',
        radical: getRadical(c.char) ?? '',
        tone,
      });
    }
    if (result.chars.length < 80) break; // last page
  }
  return NextResponse.json(allChars, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}