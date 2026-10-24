import type { CharInfo } from './chain-types';
import { getLastLetter, expandLastLetter } from './pinyin-syllable';

function firstLetter(pinyin: string): string {
  const ascii = pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return ascii[0] ?? '';
}

export function matchesChainRule(prevPinyin: string, nextPinyin: string): boolean {
  const last = getLastLetter(prevPinyin);
  if (!last) return false;
  const expanded = expandLastLetter(last);
  return expanded.includes(firstLetter(nextPinyin));
}

/**
 * Pre-built lookup tables over a char pool.
 *
 * The pool holds thousands of chars (HSK 2-6 = 2632) and the chain rules
 * used to rescan the whole pool on every pick. The index turns "which
 * chars may follow X" into a bucket lookup instead of a full scan.
 *
 * `byChar` keeps the FIRST occurrence of a char, matching the semantics
 * of `Array.prototype.find` that the unindexed implementation relied on.
 */
export interface ChainCharIndex {
  byChar: Map<string, CharInfo>;
  byFirstLetter: Map<string, CharInfo[]>;
}

export function buildChainCharIndex(chars: readonly CharInfo[]): ChainCharIndex {
  const byChar = new Map<string, CharInfo>();
  const byFirstLetter = new Map<string, CharInfo[]>();
  for (const c of chars) {
    if (!byChar.has(c.char)) byChar.set(c.char, c);
    const first = firstLetter(c.pinyin);
    if (!first) continue;
    const bucket = byFirstLetter.get(first);
    if (bucket) {
      bucket.push(c);
    } else {
      byFirstLetter.set(first, [c]);
    }
  }
  return { byChar, byFirstLetter };
}

/**
 * The valid next chars for `prevChar`, minus the ones already used.
 *
 * `expandLastLetter` currently returns a single letter, so the buckets
 * are visited in one pass and the result keeps the pool's original order.
 */
export function getValidNextCharsFromIndex(
  index: ChainCharIndex,
  prevChar: string,
  excludeChars: ReadonlySet<string>,
): CharInfo[] {
  const prevInfo = index.byChar.get(prevChar);
  if (!prevInfo) return [];
  const last = getLastLetter(prevInfo.pinyin);
  if (!last) return [];
  const expanded = expandLastLetter(last);
  const result: CharInfo[] = [];
  for (const letter of expanded) {
    const bucket = index.byFirstLetter.get(letter);
    if (!bucket) continue;
    for (const c of bucket) {
      if (!excludeChars.has(c.char)) result.push(c);
    }
  }
  return result;
}

/** One-shot variant: builds the index, then resolves the valid next chars. */
export function getValidNextChars(
  chars: readonly CharInfo[],
  prevChar: string,
  excludeChars: ReadonlySet<string>,
): CharInfo[] {
  return getValidNextCharsFromIndex(buildChainCharIndex(chars), prevChar, excludeChars);
}

export function pickStarter(
  allChars: readonly CharInfo[],
  minValid = 3,
  maxTries = 5,
): CharInfo | null {
  if (allChars.length === 0) return null;
  // One index for the whole loop — the old code rebuilt the lookup on
  // every attempt (up to 5 full scans of the pool).
  const index = buildChainCharIndex(allChars);
  for (let i = 0; i < maxTries; i++) {
    const candidate = allChars[Math.floor(Math.random() * allChars.length)]!;
    const valid = getValidNextCharsFromIndex(index, candidate.char, new Set());
    if (valid.length >= minValid) return candidate;
  }
  // Fallback: return any char
  return allChars[Math.floor(Math.random() * allChars.length)]!;
}
