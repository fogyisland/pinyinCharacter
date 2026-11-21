// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  splitTonedSyllables,
  hasTones,
  syllableKeyOf,
  convertToned,
  type ToneTable,
} from '@/lib/pinyin-tone-decode';

/**
 * Tone-aware pinyin handling — the pure layer.
 *
 * ## The bug these functions exist to fix
 *
 * `data/pinyin-hanzi.json` drops the tone: "shi4" and "shi2" both become
 * "shi", and its frequencies come from a phrase list where a rare character
 * inside many obscure words outranks a common one. The candidate list for
 * `ni` therefore starts 泥 逆 溺 尼 你 — a learner typing nǐ is offered 泥.
 *
 * The user's input already carries the tone (ni3hao3), so it needs no
 * guessing: the tone-aware table has one bucket per TONED syllable, ranked
 * by real corpus frequency. ni3 starts 你 拟 孴 儗 旎; shi4 starts 是.
 */

/** A tiny table, shaped like data/pinyin-tone.json. */
const TABLE: ToneTable = {
  ni3: [
    { char: '你', freq: 234587 },
    { char: '拟', freq: 1919 },
  ],
  hao3: [
    { char: '好', freq: 92543 },
    { char: '郝', freq: 294 },
  ],
  shi4: [
    { char: '是', freq: 796991 },
    { char: '事', freq: 44769 },
  ],
  wo3: [{ char: '我', freq: 423765 }],
  ai4: [{ char: '爱', freq: 5923 }],
};

describe('syllableKeyOf', () => {
  it('turns a written syllable into a toned key', () => {
    expect(syllableKeyOf('nǐ')).toBe('ni3');
    expect(syllableKeyOf('hǎo')).toBe('hao3');
    expect(syllableKeyOf('shì')).toBe('shi4');
  });

  it('gives a neutral syllable tone 5, the number the input already uses', () => {
    expect(syllableKeyOf('de')).toBe('de5');
    expect(syllableKeyOf('zi')).toBe('zi5');
  });

  it('writes ü as v, the way the rest of the codebase does', () => {
    expect(syllableKeyOf('lǜ')).toBe('lv4');
    expect(syllableKeyOf('nǚ')).toBe('nv3');
  });

  it('returns an empty key for a syllable with no letters', () => {
    expect(syllableKeyOf('')).toBe('');
  });
});

describe('splitTonedSyllables', () => {
  it('splits tone-numbered pinyin into syllables', () => {
    expect(splitTonedSyllables('ni3hao3')).toEqual(['ni3', 'hao3']);
    expect(splitTonedSyllables('wo3jiao4xu2peng2')).toEqual(['wo3', 'jiao4', 'xu2', 'peng2']);
  });

  it('ignores spaces and apostrophes', () => {
    expect(splitTonedSyllables('ni3 hao3')).toEqual(['ni3', 'hao3']);
    expect(splitTonedSyllables("xi1'an1")).toEqual(['xi1', 'an1']);
  });

  it('returns an empty list for input with no pinyin', () => {
    expect(splitTonedSyllables('')).toEqual([]);
    expect(splitTonedSyllables('  ,, ')).toEqual([]);
  });
});

describe('hasTones', () => {
  it('is true for tone-numbered input', () => {
    expect(hasTones('ni3hao3')).toBe(true);
    expect(hasTones('ni3')).toBe(true);
  });

  it('is false for plain input', () => {
    // Plain input goes to the shipped converter: it cannot use the tone
    // table, and pretending otherwise would drop the digits on the floor.
    expect(hasTones('nihao')).toBe(false);
    expect(hasTones('')).toBe(false);
  });
});

describe('convertToned', () => {
  it('decodes a sentence whose syllables are all in the table', () => {
    expect(convertToned('ni3hao3', TABLE)).toBe('你好');
    expect(convertToned('wo3ai4ni3', TABLE)).toBe('我爱你');
  });

  it('returns an empty string when a syllable is unknown', () => {
    // No table entry means no honest answer: better empty than a guess
    // the learner would copy into their homework.
    expect(convertToned('ni3hao3xyz', TABLE)).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(convertToned('', TABLE)).toBe('');
  });

  it('prefers a character that follows the previous one in real text', () => {
    // A realistic near-tie: 郝 is slightly more frequent than 好 on its own,
    // but after 你 the corpus says 好 — and the bigram should tip it.
    const table: ToneTable = {
      ni3: [{ char: '你', freq: 100 }],
      hao3: [
        { char: '郝', freq: 5 },
        { char: '好', freq: 3 },
      ],
    };
    const bigrams = { 你: { 好: 5 } };
    expect(convertToned('ni3hao3', table, bigrams)).toBe('你好');
  });

  it('uses the frequency order when no bigram helps', () => {
    const table: ToneTable = {
      ni3: [{ char: '你', freq: 100 }],
      hao3: [
        { char: '郝', freq: 200 },
        { char: '好', freq: 1 },
      ],
    };
    expect(convertToned('ni3hao3', table)).toBe('你郝');
  });
});

describe('the real tone-aware table (data/pinyin-tone.json)', () => {
  const table = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'pinyin-tone.json'), 'utf-8'),
  ) as ToneTable;
  const bigrams = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'bigrams.json'), 'utf-8'),
  ) as Record<string, Record<string, number>>;

  it('ranks the common character first in every everyday syllable', () => {
    // These are the syllables a beginner types first. The shipped table
    // ranked 泥 over 你, 石 over 是, 得 over 的 — this pins the fix.
    const expected: Array<[string, string]> = [
      ['ni3', '你'],
      ['shi4', '是'],
      ['de5', '的'],
      ['ta1', '他'],
      ['wo3', '我'],
      ['hao3', '好'],
      ['xue2', '学'],
      ['hen3', '很'],
    ];
    for (const [syllable, char] of expected) {
      expect(table[syllable]?.[0]?.char, `${syllable} should start with ${char}`).toBe(char);
    }
  });

  it('keeps the table compact enough to read at boot', () => {
    const syllables = Object.keys(table).length;
    expect(syllables).toBeGreaterThan(1000);
    expect(syllables).toBeLessThan(3000);
  });

  it('decodes the sentences a teacher would type', () => {
    // Not every sentence: a character model cannot know 今 vs 心, 甚 vs 什.
    // The cases pinned here are the ones the model DOES resolve, so a
    // future regression in the table shows up as a failure here.
    expect(convertToned('ni3hao3', table, bigrams)).toBe('你好');
    expect(convertToned('wo3ai4ni3', table)).toBe('我爱你');
    expect(convertToned('wo3shi4lao3shi1', table, bigrams)).toBe('我是老师');
    expect(convertToned('zhe4shi4yi4ben3shu1', table, bigrams)).toBe('这是一本书');
  });
});
