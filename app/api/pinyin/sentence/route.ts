import { NextResponse } from 'next/server';
import { convertSentence } from '@/server/sentence-converter';
import { convertToned, hasTones } from '@/lib/pinyin-tone-decode';
import { getBigrams, getToneTable } from '@/lib/pinyin-tone-data';

export const dynamic = 'force-dynamic';

/** Which decoder answered — useful to the UI and to a future measurement. */
type Engine = 'tone-aware' | 'classic';

/**
 * GET /api/pinyin/sentence — pinyin → hanzi for a whole sentence.
 *
 * Two decoders, chosen by what the input can support:
 *
 *   - **Toned input** (wo3shi4lao3shi1) goes to the tone-aware decoder,
 *     which keeps the tone in the key and ranks by real corpus frequencies:
 *     我是老师 decodes correctly, while the shipped converter returns
 *     卧石老师 for the same input.
 *   - **Plain input** (nihao) keeps the shipped Viterbi converter, unchanged.
 *
 * When the tone-aware decode cannot resolve a syllable it returns '', and
 * the route falls back to the shipped converter: an empty answer would
 * look like a broken tool, while a rougher answer with a visible engine
 * label is honest.
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

  let sentence = '';
  let engine: Engine = 'classic';
  if (hasTones(pinyin)) {
    const toned = convertToned(pinyin, getToneTable(), getBigrams());
    if (toned !== '') {
      sentence = toned;
      engine = 'tone-aware';
    }
  }
  if (sentence === '') {
    sentence = convertSentence(pinyin, safeMode, script);
    engine = 'classic';
  }

  return NextResponse.json({ ok: true, data: { sentence, engine } });
}
