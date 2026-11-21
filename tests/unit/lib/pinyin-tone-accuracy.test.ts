import { describe, it, expect } from 'vitest';
import { convertToned } from '@/lib/pinyin-tone-decode';
import { getToneTable, getBigrams } from '@/lib/pinyin-tone-data';

/**
 * The tone-aware decode, measured against a teacher's sentence set.
 *
 * This file records the measured accuracy rather than pretending to it:
 * the shipped converter scored 2/15 on these sentences (it offered 泥 for
 * nǐ), the tone-aware table with bigrams scores 7/15. The cases that still
 * miss are all word-level ambiguities a character model cannot resolve
 * (今→心, 甚→什, 杯→背, 咖→喀), which is exactly what the later word table
 * work is for.
 *
 * The thresholds are written as "at least" so an improvement passes and a
 * regression fails.
 */
describe('the tone-aware decode, measured', () => {
  const table = getToneTable();
  const bigrams = getBigrams();

  /** Sentences a teacher would actually type, and what they should say. */
  const SENTENCES: Array<[string, string]> = [
    ['ni3hao3', '你好'],
    ['wo3ai4ni3', '我爱你'],
    ['jin1tian1tian1qi4hen3hao3', '今天天气很好'],
    ['wo3men5qu4xue2xiao4', '我们去学校'],
    ['xie4xie5ni3', '谢谢你'],
    ['dui4bu4qi3', '对不起'],
    ['ni3jiao4shen2me5ming2zi5', '你叫什么名字'],
    ['wo3shi4lao3shi1', '我是老师'],
    ['zhe4shi4yi4ben3shu1', '这是一本书'],
    ['ta1shi4wo3de5peng2you3', '他是我的朋友'],
    ['wo3xi3huan1xue2xi2han4yu3', '我喜欢学习汉语'],
    ['ni3de5jia1xiang1zai4na3li3', '你的家乡在哪里'],
    ['zhe4ge4han4zi4zen3me5xie3', '这个汉字怎么写'],
    ['qing3wen4xi3shou3jian1zai4na3li3', '请问洗手间在哪里'],
    ['wo3yao4mai3yi4bei1ka1fei1', '我要买一杯咖啡'],
  ];

  it('decodes at least half of a teacher\'s sentence set', () => {
    const results = SENTENCES.map(([pinyin, expected]) => {
      const got = convertToned(pinyin, table, bigrams);
      return { pinyin, expected, got, ok: got === expected };
    });
    const exact = results.filter((r) => r.ok).length;
    // 8/15 measured with the constants in lib/pinyin-tone.ts (bigram weight
    // 2, missing-bigram -1 — chosen by .tmp/sweep-tone.ts, not by taste).
    // The floor is 8 so a future improvement is allowed and a regression
    // of even one case fails.
    expect(exact, JSON.stringify(results.filter((r) => !r.ok), null, 1)).toBeGreaterThanOrEqual(8);
  });

  it('never offers the rare character first for an everyday syllable', () => {
    // The shipped table's worst failure, pinned one syllable at a time:
    // a learner typing these must not be taught a rare character.
    const pairs: Array<[string, string, string]> = [
      ['ni3', '你', '泥'],
      ['shi4', '是', '石'],
      ['de5', '的', '得'],
      ['hao3', '好', '郝'],
      ['ta1', '他', '踏'],
    ];
    for (const [syllable, common, rare] of pairs) {
      const order = (table[syllable] ?? []).map((e) => e.char);
      expect(order[0], `${syllable} should start with ${common}`).toBe(common);
      const rareIndex = order.indexOf(rare);
      if (rareIndex >= 0) {
        expect(rareIndex, `${rare} should rank below ${common} in ${syllable}`).toBeGreaterThan(0);
      }
    }
  });
});
