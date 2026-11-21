import { NextResponse } from 'next/server';
import { getCandidates } from '@/server/dictionary';
import { splitTonedSyllables } from '@/lib/pinyin-tone-decode';
import { getToneTable } from '@/lib/pinyin-tone-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pinyin/candidates — the characters a syllable can be.
 *
 * Tow paths, deliberately:
 *
 *   1. **Toned input** (ni3, shi4) is answered from the tone-aware table,
 *      which keeps the tone in the key and ranks by real corpus frequencies.
 *      The shipped dictionary cannot do this: it strips the tone, so
 *      "shi4" and "shi2" both become "shi" and 石 outranks 是. A learner
 *      typing nǐ was offered 泥.
 *
 *   2. **Plain input** keeps the shipped dictionary, unchanged. It has no
 *      tone to promise, so nothing is lost by answering from the old table
 *      — and every existing call keeps working.
 *
 * A toned syllable the table does not know falls back to the shipped
 * dictionary rather than returning nothing: an unknown syllable still has
 * characters, just not ranked ones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pinyin = url.searchParams.get('pinyin');
  if (!pinyin) {
    return NextResponse.json(
      { ok: false, error: 'pinyin required', code: 'missing_pinyin' },
      { status: 400 },
    );
  }
  const safeMode = url.searchParams.get('safeMode') === 'true';
  const script = (url.searchParams.get('script') ?? 'simplified') as 'simplified' | 'traditional';

  const syllables = splitTonedSyllables(pinyin);
  if (syllables.length === 1) {
    const table = getToneTable();
    const bucket = table[syllables[0]];
    if (bucket && bucket.length > 0) {
      // safeMode is not applied here: the tone table is built from a
      // frequency corpus of ordinary words, and a character that is common
      // enough to rank in a syllable is not a word to filter. The shipped
      // dictionary's filter still guards the untuned path.
      return NextResponse.json({ ok: true, data: { candidates: bucket } });
    }
  }

  const candidates = getCandidates(pinyin, safeMode, script);
  return NextResponse.json({ ok: true, data: { candidates } });
}
