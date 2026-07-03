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

  it('handles i wildcard (爱 ài → 一 yī)', () => {
    expect(matchesChainRule('ài', 'yī')).toBe(true);  // i → y
    expect(matchesChainRule('ài', 'èr')).toBe(false); // i → e
  });

  it('handles u wildcard (母 mǔ → 雨 yǔ)', () => {
    expect(matchesChainRule('mǔ', 'yǔ')).toBe(true);  // u → y
    expect(matchesChainRule('mǔ', 'jù')).toBe(true);  // u → j (ü pair)
  });

  it('handles v/ü wildcard (绿 lǜ → 距 jù)', () => {
    expect(matchesChainRule('lǜ', 'jù')).toBe(true);  // ü → j
    expect(matchesChainRule('lǜ', 'xū')).toBe(true);  // ü → x
    expect(matchesChainRule('lǜ', 'yǔ')).toBe(true);  // ü → y
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

  it('handles i/u/ü wildcards for next char matching', () => {
    // 爱 ends in i → next can start with i or y → 一 yī
    const valid = getValidNextChars(chars, '爱', new Set());
    expect(valid.map((c) => c.char)).toContain('一');
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