import { describe, it, expect } from 'vitest';
import { matchesChainRule, getValidNextChars, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { COMMON_CHARS } from '@/lib/common-chars';

// Helper: build minimal CharInfo fixtures
const ci = (char: string, pinyin: string, opts: Partial<CharInfo> = {}): CharInfo => ({
  char,
  pinyin,
  meaning: opts.meaning ?? '',
  radical: opts.radical ?? '',
  tone: opts.tone ?? 1,
});

describe('matchesChainRule', () => {
  it('matches when prev last letter = next first letter', () => {
    expect(matchesChainRule('ān', 'nà')).toBe(true);  // n → n
    expect(matchesChainRule('wán', 'ne')).toBe(true);  // n → n
  });

  it('rejects mismatched letters', () => {
    expect(matchesChainRule('ān', 'bāo')).toBe(false);  // n → b
    expect(matchesChainRule('hǎo', 'dēng')).toBe(false); // o → d
  });

  // Strict last-letter: 你 (nǐ, last 'i') only chains to chars with first letter 'i'.
  // Brief 2026-07-04 example "你 → 期 (qī)" was a typo: qī first letter is 'q', not 'i'.
  // There is no common pinyin syllable starting with 'i' (yi/yi series start with 'y'),
  // so under strict rule, 你 has effectively 0 validNext chars — that IS the point
  // of the rollback. We assert the negative plus a working positive case.
  it('爱 (ài, last i) does NOT chain to 一 (yī, first y) — i→y wildcard dropped', () => {
    expect(matchesChainRule('ài', 'yī')).toBe(false);
  });

  it('你 (nǐ, last i) does NOT chain to 衣 (yī, first y) — different spelling, same sound', () => {
    expect(matchesChainRule('nǐ', 'yī')).toBe(false);
  });

  it('姑 (gū, last u) does NOT chain to 女 (nǚ, first n) — even though ü is u-glide', () => {
    expect(matchesChainRule('gū', 'nǚ')).toBe(false);
  });

  it('母 (mǔ, last u) does NOT chain to 雨 (yǔ, first y) — u→y wildcard dropped', () => {
    expect(matchesChainRule('mǔ', 'yǔ')).toBe(false);
  });

  it('绿 (lǜ, last u after NFD) does NOT chain to 距 (jù, first j) — ü wildcard dropped', () => {
    expect(matchesChainRule('lǜ', 'jù')).toBe(false);
  });

  // Positive control: strict rule still works for non-wildcard transitions.
  it('爱 (ài, last i) chains to 安 (ān, first a) is rejected — i ≠ a', () => {
    expect(matchesChainRule('ài', 'ān')).toBe(false);
  });

  it('returns false for empty pinyin', () => {
    expect(matchesChainRule('', 'nà')).toBe(false);
  });
});

describe('getValidNextChars', () => {
  const chars: CharInfo[] = [
    ci('安', 'ān'),
    ci('那', 'nà'),
    ci('呢', 'ne'),
    ci('包', 'bāo'),
    ci('爱', 'ài'),
    ci('期', 'qī'),
    ci('一', 'yī'),
    ci('二', 'èr'),
    ci('母', 'mǔ'),
    ci('雨', 'yǔ'),
  ];

  it('returns chars whose pinyin starts with prev last letter', () => {
    const valid = getValidNextChars(chars, '安', new Set());
    expect(valid.map((c) => c.char).sort()).toEqual(['呢', '那']);
  });

  it('excludes chars already in chain', () => {
    const valid = getValidNextChars(chars, '安', new Set(['那']));
    expect(valid.map((c) => c.char)).toEqual(['呢']);
  });

  it('returns [] when prev char not in list', () => {
    expect(getValidNextChars(chars, '非', new Set())).toEqual([]);
  });

  it('returns [] when no chars match (dead letter scenario)', () => {
    // '包' ends in o, none of the chars start with o
    const valid = getValidNextChars(chars, '包', new Set());
    expect(valid).toEqual([]);
  });

  // Strict rule: 爱 (ài, last i) → only chars starting with 'i' qualify.
  // After rollback, no common pinyin starts with 'i' (yi/yi series start with 'y'),
  // so 爱 has 0 validNext. Brief 2026-07-04 originally asserted ['期'] but qī
  // first letter is 'q' — that assertion was logically broken under strict rule.
  it('爱 (ài, last i) has 0 validNext — no i→y wildcard, no char starts with i', () => {
    const valid = getValidNextChars(chars, '爱', new Set());
    expect(valid).toEqual([]);
    expect(valid.map((c) => c.char)).not.toContain('一');
  });
});

describe('pickStarter', () => {
  // Build a larger char list to give pickStarter valid options
  const allChars: CharInfo[] = COMMON_CHARS.map((c, i) =>
    ci(c, ['ān', 'yī', 'shì', 'bù', 'le', 'zài'][i % 6] ?? 'le'),
  );

  it('returns a CharInfo from the allChars list', () => {
    const starter = pickStarter(allChars, 1, 3);
    expect(starter).not.toBeNull();
    expect(allChars.some((c) => c.char === starter!.char)).toBe(true);
  });

  it('returns null when allChars is empty', () => {
    expect(pickStarter([], 1, 3)).toBeNull();
  });

  it('retries when validNext < minValid', () => {
    // Create chars where all end in letters that match few/no others
    // e.g. all end in 'o' → no chars start with o → validNext always 0
    const oo = ['婆', '多', '我', '可', '说'].map((c) => ci(c, 'o'));
    expect(pickStarter(oo, 100, 2)).not.toBeNull();
  });
});