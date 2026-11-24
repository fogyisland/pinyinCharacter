// @vitest-environment node
import { describe, it, expect } from 'vitest';
import pairs from '@/data/duiyun-pairs.json';
import {
  METER_PRESETS,
  PINGSHUI_RHYMES,
  analyzeCouplet,
  analyzePoemLines,
  buildCharRhymeIndex,
} from '@/app/prosody/prosody-data';
import type { DuiyunPair } from '@/lib/duiyun-rules';

const typedPairs = pairs as readonly DuiyunPair[];
const rhymeIndex = buildCharRhymeIndex(typedPairs);

describe('平水韵三十部谱', () => {
  it('收齐上平十五韵与下平十五韵', () => {
    expect(PINGSHUI_RHYMES).toHaveLength(30);
    expect(PINGSHUI_RHYMES.filter((r) => r.volume === '上平声十五韵')).toHaveLength(15);
    expect(PINGSHUI_RHYMES.filter((r) => r.volume === '下平声十五韵')).toHaveLength(15);
  });

  it('每一韵的 chunkIndex 在对应典籍章节范围内', () => {
    for (const rhyme of PINGSHUI_RHYMES) {
      expect(rhyme.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(rhyme.chunkIndex).toBeLessThanOrEqual(14);
    }
  });

  it('从对句语料建立的字→韵索引不为空', () => {
    expect(rhymeIndex.size).toBeGreaterThan(200);
    expect(rhymeIndex.get('风')?.length).toBeGreaterThan(0);
  });
});

describe('analyzePoemLines — 逐字平仄校验', () => {
  it('按标点拆行，逐字给出拼音与平仄', () => {
    const lines = analyzePoemLines('白日依山尽，\n黄河入海流。', [], rhymeIndex);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.chars).toHaveLength(5);
    expect(lines[0]!.chars[0]!.char).toBe('白');
    expect(lines[0]!.chars[0]!.syllable).toMatch(/^b/);
    expect(['平', '仄']).toContain(lines[0]!.chars[0]!.pingZe);
  });

  it('对合乎定式的字位标 ok，不合的标 mismatch', () => {
    const lines = analyzePoemLines('白日依山尽', ['中仄平平仄'], rhymeIndex);
    const statuses = lines[0]!.chars.map((c) => c.status);
    expect(statuses).toContain('ok');
  });

  it('中字位标为 flexible 而非 mismatch', () => {
    const lines = analyzePoemLines('白日依山尽', ['中中中中中'], rhymeIndex);
    expect(lines[0]!.chars.every((c) => c.status === 'flexible')).toBe(true);
  });

  it('句尾带出韵部与韵母信息', () => {
    const lines = analyzePoemLines('更上一层楼', [], rhymeIndex);
    const tail = lines[0]!.chars.at(-1)!;
    expect(tail.char).toBe('楼');
    expect(tail.final).toBeTruthy();
  });

  it('空输入不抛错', () => {
    expect(analyzePoemLines('', [], rhymeIndex)).toHaveLength(0);
  });
});

describe('analyzeCouplet — 楹联对仗校验', () => {
  it('字数相等且上仄下平时给出肯定结论', () => {
    const result = analyzeCouplet('风高秋月白', '雨霁晚霞红', rhymeIndex);
    expect(result.lengthEqual).toBe(true);
    expect(result.summary).toContain('合乎');
    expect(result.opposedCount).toBeGreaterThan(0);
  });

  it('字数不等时明确提示', () => {
    const result = analyzeCouplet('风高秋月白', '雨霁晚霞红又多', rhymeIndex);
    expect(result.lengthEqual).toBe(false);
    expect(result.summary).toContain('字数不等');
  });

  it('上平下仄时提示尾字不合定则', () => {
    const result = analyzeCouplet('一园春雨杏花红', '两岸晓烟杨柳绿', rhymeIndex);
    expect(result.tailRuleOk).toBe(false);
    expect(result.summary).toContain('上仄下平');
  });

  it('空输入给出引导而不是崩溃', () => {
    expect(analyzeCouplet('', '', rhymeIndex).summary).toContain('请输入');
  });
});

describe('格律定式预设', () => {
  it('每个预设的 pattern 长度与 sample 行数一致', () => {
    for (const preset of METER_PRESETS) {
      const lines = preset.sample.split('\n').filter(Boolean);
      expect(preset.pattern).toHaveLength(lines.length);
    }
  });

  it('七绝仄起首句不入韵的标题与样本一致', () => {
    const preset = METER_PRESETS.find((p) => p.id === 'qijue-zeqi')!;
    expect(preset.title).toContain('不入韵');
    expect(preset.pattern[0]).toBe('中仄中平平仄仄');
  });
});
