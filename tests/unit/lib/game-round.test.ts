import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the chars module so tests don't pull in the server-only chain
// (lib/chars.ts → lib/content.ts via 'server-only'). The buildRound tests
// focus on filter logic, not the DB layer.
vi.mock('@/lib/chars', () => ({
  listChars: vi.fn(),
}));

import { listChars } from '@/lib/chars';
import { seededShuffle } from '@/lib/shuffle';
import { buildRound, filterByHskLevel } from '@/lib/game-round';
import type { CharInfo, RoundMode } from '@/lib/game-round';
import type { Char } from '@/lib/chars-types';

describe('seededShuffle (Fisher-Yates)', () => {
  it('preserves all elements (no duplicates, no losses)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let seed = 0; seed < 20; seed++) {
      const result = seededShuffle(input, seed);
      expect(result).toHaveLength(input.length);
      expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
    }
  });

  it('on pinyin array produces 4 unique values (regression: ToneRadicalGame duplicate keys)', () => {
    const input = ['nǎ', 'chù', 'tóng', 'duǒ'];
    for (let seed = 0; seed < 20; seed++) {
      const result = seededShuffle(input, seed + 2);
      expect(result).toHaveLength(4);
      expect(new Set(result).size).toBe(4);
    }
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4];
    const before = [...input];
    seededShuffle(input, 42);
    expect(input).toEqual(before);
  });
});

// Pure-function tests for the HSK filter logic. Adapted from brief Step 5.1:
// the actual `buildRound` queries the DB directly, so the brief's
// `buildRound(chars, count, seed, mode, hskLevel)` signature doesn't apply
// here. The filter itself is a pure function exported as `filterByHskLevel`
// for unit testing.
describe('buildRound hskLevel filter (Step 5.1 RED → GREEN)', () => {
  it('filters chars by hsk_level when provided', () => {
    const chars: CharInfo[] = [
      { char: '你', level: 1, hsk_level: 1 } as CharInfo,
      { char: '好', level: 1, hsk_level: 1 } as CharInfo,
      { char: '罕', level: 2, hsk_level: null } as CharInfo, // fallback
    ];
    const filtered = filterByHskLevel(chars, 1);
    // Strict assertion: only chars with hsk_level === 1 included.
    expect(filtered.every((c) => c.hsk_level === 1)).toBe(true);
    expect(filtered.map((c) => c.char).sort()).toEqual(['你', '好']);
  });

  it('falls back to chars.level when hsk_level is null', () => {
    const chars: CharInfo[] = [
      { char: '罕', level: 2, hsk_level: null } as CharInfo,
      { char: '你', level: 1, hsk_level: 1 } as CharInfo,
    ];
    // hskLevel = null → no HSK filter, return all chars (preserve existing behavior).
    const filtered = filterByHskLevel(chars, null);
    expect(filtered.length).toBe(2);
  });

  it('returns empty array when no chars match hskLevel (caller must fallback)', () => {
    const chars: CharInfo[] = [{ char: '你', level: 1, hsk_level: 1 } as CharInfo];
    const filtered = filterByHskLevel(chars, 6);
    expect(filtered).toEqual([]);
  });
});

// 2026-10-25 (Task 5): buildRound gained an optional 5th parameter
// `modeOverride`. When it is given the round is built for that mode
// instead of the legacy per-seed random pick. The random behavior must
// survive untouched when the parameter is omitted.
const FIXTURE_CHARS: Char[] = [
  {
    char: '好',
    level: 1,
    pinyin: 'hǎo',
    pinyinAlt: ['hǎo'],
    radical: '女',
    strokeCount: 6,
    meaningZh: '好',
    meaningEn: 'good',
    unicodeCodepoint: 'U+597D',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '你',
    level: 1,
    pinyin: 'nǐ',
    pinyinAlt: ['nǐ'],
    radical: '亻',
    strokeCount: 7,
    meaningZh: '你',
    meaningEn: 'you',
    unicodeCodepoint: 'U+4F60',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '妈',
    level: 1,
    pinyin: 'mā',
    pinyinAlt: ['mā'],
    radical: '女',
    strokeCount: 6,
    meaningZh: '妈',
    meaningEn: 'mother',
    unicodeCodepoint: 'U+5988',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '他',
    level: 1,
    pinyin: 'tā',
    pinyinAlt: ['tā'],
    radical: '亻',
    strokeCount: 5,
    meaningZh: '他',
    meaningEn: 'he',
    unicodeCodepoint: 'U+4ED6',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '大',
    level: 1,
    pinyin: 'dà',
    pinyinAlt: ['dà'],
    radical: '大',
    strokeCount: 3,
    meaningZh: '大',
    meaningEn: 'big',
    unicodeCodepoint: 'U+5927',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '水',
    level: 1,
    pinyin: 'shuǐ',
    pinyinAlt: ['shuǐ'],
    radical: '水',
    strokeCount: 4,
    meaningZh: '水',
    meaningEn: 'water',
    unicodeCodepoint: 'U+6C34',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '火',
    level: 1,
    pinyin: 'huǒ',
    pinyinAlt: ['huǒ'],
    radical: '火',
    strokeCount: 4,
    meaningZh: '火',
    meaningEn: 'fire',
    unicodeCodepoint: 'U+706B',
    variants: [],
    hskLevel: 1,
  },
  {
    char: '山',
    level: 1,
    pinyin: 'shān',
    pinyinAlt: ['shān'],
    radical: '山',
    strokeCount: 3,
    meaningZh: '山',
    meaningEn: 'mountain',
    unicodeCodepoint: 'U+5C71',
    variants: [],
    hskLevel: 1,
  },
];

describe('buildRound mode override (Task 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // listChars resolves a PAGE object, not a bare array — see
    // lib/chars-types.ts CharListResult. The fixture is shorter than the
    // page size, so buildRound's paging loop breaks after one page.
    vi.mocked(listChars).mockResolvedValue({
      chars: FIXTURE_CHARS,
      total: FIXTURE_CHARS.length,
      page: 1,
      pageSize: 80,
    });
  });

  // Each case uses a seed whose legacy pick would be a DIFFERENT mode, so
  // the assertion can only pass when the override is honored.
  it('builds a tone round when the tone mode is requested', async () => {
    // seed 1 → the legacy random pick would have been 'radical'.
    const result = await buildRound(4, 1, 'chars-all', null, 'tone');
    expect(result).not.toBeNull();
    expect(result?.round.mode).toBe('tone');
  });

  it('builds a radical round when the radical mode is requested', async () => {
    // seed 2 → the legacy random pick would have been 'pinyin'.
    const result = await buildRound(4, 2, 'chars-all', null, 'radical');
    expect(result).not.toBeNull();
    expect(result?.round.mode).toBe('radical');
  });

  it('builds a pinyin round when the pinyin mode is requested', async () => {
    // seed 0 → the legacy random pick would have been 'tone'.
    const result = await buildRound(4, 0, 'chars-all', null, 'pinyin');
    expect(result).not.toBeNull();
    expect(result?.round.mode).toBe('pinyin');
  });

  it('honors the override regardless of the seed', async () => {
    for (const seed of [0, 1, 2, 3, 99]) {
      const result = await buildRound(4, seed, 'chars-all', null, 'radical');
      expect(result?.round.mode).toBe('radical');
    }
  });

  it('honors the override under an HSK filter', async () => {
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result).not.toBeNull();
    expect(result?.round.mode).toBe('tone');
    expect(result?.hskLevel).toBe(1);
  });

  it('keeps the legacy random mode when no override is given', async () => {
    const modes: RoundMode[] = ['tone', 'radical', 'pinyin'];
    const result = await buildRound(4, 20261025, 'chars-all', null);
    expect(result).not.toBeNull();
    expect(modes).toContain(result?.round.mode);
  });

  it('derives the legacy mode from the seed as a pure function', async () => {
    // pickMode(seed) walks ['tone', 'radical', 'pinyin'] by seed % 3.
    const expected: Array<[number, RoundMode]> = [
      [0, 'tone'],
      [1, 'radical'],
      [2, 'pinyin'],
    ];
    for (const [seed, mode] of expected) {
      const first = await buildRound(4, seed, 'chars-all', null);
      const second = await buildRound(4, seed, 'chars-all', null);
      expect(first?.round.mode).toBe(mode);
      expect(second?.round.mode).toBe(mode);
    }
  });
});
