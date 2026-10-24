import { join } from 'node:path';
import { readJsonAuto } from './json-fs';

/**
 * Stroke count per char, read from the pre-bundled hanzi-writer data in
 * public/strokes/<char>.json.
 *
 * `chars.stroke_count` has been 0 for every row since the 2026-06-17 content
 * migration, so the dictionary's 部首 · N 画 field printed "0 画" for every
 * char — the stroke-order card right below it knew the real count all along
 * (七 shows "2 / 2 画" while the field said "0 画").
 *
 * The stroke data covers 6866 of the 7909 chars (that is the upstream
 * hanzi-writer-data limit, not a local one). For the rest this returns null
 * and the UI omits the count instead of printing a wrong zero.
 */
const STROKES_DIR = join(process.cwd(), 'public', 'strokes');

const strokeCountCache = new Map<string, number | null>();

/**
 * The number of strokes of `char`, or null when the char has no stroke data.
 *
 * The parsed file is deliberately NOT kept in the shared JSON cache: a
 * stroke file holds the full path geometry (1-8 KB), and retaining all 6866
 * of them as JS objects would cost far more memory than the counts do. This
 * module caches the number itself, so each file is read and parsed once.
 */
export function getStrokeCount(char: string): number | null {
  if (!char) return null;
  const cached = strokeCountCache.get(char);
  if (cached !== undefined) return cached;

  let count: number | null = null;
  try {
    const raw = readJsonAuto(join(STROKES_DIR, `${char}.json`));
    if (raw && typeof raw === 'object') {
      const strokes = (raw as { strokes?: unknown }).strokes;
      if (Array.isArray(strokes) && strokes.length > 0) count = strokes.length;
    }
  } catch {
    // A missing or malformed stroke file simply means "no count" — never a
    // reason to fail the page that renders the char.
    count = null;
  }

  strokeCountCache.set(char, count);
  return count;
}
