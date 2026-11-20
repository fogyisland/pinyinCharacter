/**
 * The couplet extractor — `scripts/build-duiyun.ts`.
 *
 * The corpus in `data/classics/` is a file per book. The extractor picks the
 * pairs that are genuinely couplets, so the game only ever shows a pair
 * whose two sides really do answer each other.
 *
 * The rule it uses is 平仄 contrast: at every position the upper line is a
 * ping tone (1 or 2) and the lower line is a ze tone (3 or 4), or the other
 * way round. Tone *equality* would be wrong — a couplet does not repeat the
 * same tone, it answers it with the opposite class.
 */
import { describe, it, expect } from 'vitest';
import { buildPairs, extractPairs, normalizeRhyme } from '@/scripts/build-duiyun';

describe('build-duiyun', () => {
  it('keeps only the pairs whose tones oppose at every position', () => {
    // 天(1) 对 地(4) 是平仄相对；雨(3) 对 风(1) 是仄平相对。
    const pairs = extractPairs([
      {
        label: '一东',
        book: '笠翁对韵',
        lines: [
          { text: '天对地，雨对风', pinyin: ['tiān', 'duì', 'dì', '，', 'yǔ', 'duì', 'fēng'] },
        ],
      },
    ]);
    expect(pairs.map((p) => `${p.upper}对${p.lower}`)).toEqual(['天对地', '雨对风']);
    expect(pairs.every((p) => p.rhyme === '一东')).toBe(true);
  });

  it('drops a pair whose tones do not oppose', () => {
    // 江(1) 对 湖(2) —— 两边都是平声，不是对句。
    const pairs = extractPairs([
      {
        label: '一东',
        book: '笠翁对韵',
        lines: [{ text: '江对湖', pinyin: ['jiāng', 'duì', 'hú'] }],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('drops a pair whose two sides have different lengths', () => {
    const pairs = extractPairs([
      {
        label: '一东',
        book: '笠翁对韵',
        lines: [{ text: '月殿对天中', pinyin: ['yuè', 'duì', 'diàn', 'duì', 'tiān', 'zhōng'] }],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('drops a pair that holds a tone-less syllable', () => {
    // 轻声没有平仄，判不了对错。
    const pairs = extractPairs([
      {
        label: '一东',
        book: '笠翁对韵',
        lines: [{ text: '西对东', pinyin: ['xī', 'duì', 'de'] }],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('strips the spaces out of a rhyme label', () => {
    // 声律启蒙的韵部标签写成 '一 东'，笠翁对韵写成 '一东' —— 两者必须归一化。
    expect(normalizeRhyme('一 东')).toBe('一东');
    expect(normalizeRhyme('十 一 真')).toBe('十一真');
  });

  it('reads the corpus and keeps only real couplets', () => {
    const pairs = buildPairs();
    expect(pairs.length).toBeGreaterThan(150);
    for (const pair of pairs) {
      expect(pair.upper.length).toBe(pair.lower.length);
      expect(pair.upperPinyin).toHaveLength(pair.upper.length);
      expect(pair.lowerPinyin).toHaveLength(pair.lower.length);
    }
  });

  it('keeps the couplets whose two sides have more than one character', () => {
    // 这一条钉住「两边字数相同」那个判定。计数用的正则必须带 g —— 不带的话
    // `match` 只返回第一个匹配，两字的对句会被误判成「一边一字、一边两字」
    // 而被丢掉，整份语料只剩单字对句。
    const pairs = buildPairs();
    const longer = pairs.filter((p) => p.upper.length > 1);
    expect(longer.length).toBeGreaterThan(100);
    for (const pair of longer) {
      expect(pair.upper.length).toBe(pair.lower.length);
      expect(pair.upperPinyin).toHaveLength(pair.upper.length);
    }
  });

  it('keeps both the one-character and the two-character couplets', () => {
    const pairs = buildPairs();
    const lengths = new Set(pairs.map((p) => p.upper.length));
    expect(lengths.has(1)).toBe(true);
    expect(lengths.has(2)).toBe(true);
  });
});
