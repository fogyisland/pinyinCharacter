import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from '@/lib/sutras';

describe('splitIntoChunks', () => {
  it('returns single chunk for sutra with no 品 markers', () => {
    const paragraphs = ['观自在菩萨,行深般若波罗蜜多时,照见五蕴皆空,度一切苦厄。', '舍利子,色不异空,空不异色,色即是空,空即是色。'];
    const chunks = splitIntoChunks('心经', paragraphs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.label).toBe('心经');
    expect(chunks[0]!.id).toBe(0);
    expect(chunks[0]!.content).toEqual(paragraphs);
  });

  it('splits sutra with 品 markers into multiple chunks', () => {
    const paragraphs = [
      '如是我闻:一时,佛在舍卫国祇树给孤独园。',
      '法会因由分第一:尔时,世尊食时,著衣持钵,入舍卫大城乞食。',
      '善现启请分第二:时,长老须菩提在大众中即从座起,偏袒右肩,右膝着地。',
      '大乘正宗分第三:佛告须菩提:诸菩萨摩诃萨应如是降伏其心。',
    ];
    const chunks = splitIntoChunks('金刚经', paragraphs);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.label).toMatch(/如是我闻/);
    expect(chunks[1]!.label).toMatch(/法会因由分第一/);
    expect(chunks[2]!.label).toMatch(/善现启请分第二/);
    expect(chunks[0]!.id).toBe(0);
    expect(chunks[1]!.id).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(splitIntoChunks('心经', [])).toEqual([]);
  });

  it('truncates chunk label to 32 chars', () => {
    const longLabel = '第' + '一'.repeat(20) + '品:这是一段非常非常长的品名' + '啊'.repeat(30);
    const chunks = splitIntoChunks('测试经', [longLabel]);
    expect(chunks[0]!.label.length).toBeLessThanOrEqual(32);
  });
});
