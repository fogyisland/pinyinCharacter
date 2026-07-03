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

export function getValidNextChars(
  chars: readonly CharInfo[],
  prevChar: string,
  excludeChars: ReadonlySet<string>,
): CharInfo[] {
  const prevInfo = chars.find((c) => c.char === prevChar);
  if (!prevInfo) return [];
  const last = getLastLetter(prevInfo.pinyin);
  if (!last) return [];
  const expanded = expandLastLetter(last);
  return chars.filter((c) => {
    if (excludeChars.has(c.char)) return false;
    return expanded.includes(firstLetter(c.pinyin));
  });
}

export function pickStarter(
  allChars: readonly CharInfo[],
  minValid = 3,
  maxTries = 5,
): CharInfo | null {
  if (allChars.length === 0) return null;
  for (let i = 0; i < maxTries; i++) {
    const candidate = allChars[Math.floor(Math.random() * allChars.length)]!;
    const valid = getValidNextChars(allChars, candidate.char, new Set());
    if (valid.length >= minValid) return candidate;
  }
  // Fallback: return any char
  return allChars[Math.floor(Math.random() * allChars.length)]!;
}
