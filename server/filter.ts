import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DictEntry } from './dictionary';

let badChars = new Set<string>();
let badWords = new Set<string>();
let loaded = false;

function loadBadWords(): void {
  if (loaded) return;
  const data = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'bad-words.json'), 'utf8'),
  ) as { chars: string[]; words: string[] };
  badChars = new Set(data.chars);
  badWords = new Set(data.words);
  loaded = true;
}

/** Returns the bad-chars set, loading from disk on first call. Exposed for tests. */
export function getBadChars(): ReadonlySet<string> {
  if (!loaded) loadBadWords();
  return badChars;
}

/** Returns the bad-words set, loading from disk on first call. Exposed for tests. */
export function getBadWords(): ReadonlySet<string> {
  if (!loaded) loadBadWords();
  return badWords;
}

/**
 * Filter a list of candidate characters against the bad-chars set when safeMode is on.
 * An optional `badCharsOverride` lets callers (and tests) inject a custom set.
 */
export function filterCandidates(
  candidates: DictEntry[],
  safeMode: boolean,
  badCharsOverride?: ReadonlySet<string>,
): DictEntry[] {
  if (!safeMode) return candidates;
  const set = badCharsOverride ?? getBadChars();
  return candidates.filter(c => !set.has(c.char));
}

/**
 * Returns true if `text` contains a bad word or bad character (and safeMode is on).
 * Used by sentence-level endpoints to refuse unsafe output entirely.
 */
export function isBadText(text: string, safeMode: boolean): boolean {
  if (!safeMode) return false;
  const words = getBadWords();
  for (const w of words) {
    if (text.includes(w)) return true;
  }
  const chars = getBadChars();
  for (const c of text) {
    if (chars.has(c)) return true;
  }
  return false;
}
