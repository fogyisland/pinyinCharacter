import { describe, it, expect } from 'vitest';
import { inferFormFromParagraphs, resolveFormFromSource, mergeForm } from '@/lib/poetry/infer-form';

describe('inferFormFromParagraphs', () => {
  it('classifies 5-char 4-line as 五绝', () => {
    const r = inferFormFromParagraphs(['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡']);
    expect(r.primary).toBe('五绝');
    expect(r.confidence).toBe(1.0);
  });

  it('classifies 7-char 4-line as 七绝', () => {
    const r = inferFormFromParagraphs([
      '两个黄鹂鸣翠柳',
      '一行白鹭上青天',
      '窗含西岭千秋雪',
      '门泊东吴万里船',
    ]);
    expect(r.primary).toBe('七绝');
  });

  it('classifies 5-char 8-line as 五律', () => {
    const r = inferFormFromParagraphs([
      '国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心',
      '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪',
    ]);
    expect(r.primary).toBe('五律');
  });

  it('classifies 7-char 8-line as 七律', () => {
    const r = inferFormFromParagraphs([
      '丞相祠堂何处寻', '锦官城外柏森森', '映阶碧草自春色', '隔叶黄鹂空好音',
      '三顾频烦天下计', '两朝开济老臣心', '出师未捷身先死', '长使英雄泪满襟',
    ]);
    expect(r.primary).toBe('七律');
  });

  it('classifies 5-char 6-line as 五言古风', () => {
    const r = inferFormFromParagraphs(['青青河畔草', '郁郁园中柳', '盈盈楼上女', '皎皎当窗牖', '娥娥红粉妆', '纤纤出素手']);
    expect(r.primary).toBe('五言古风');
  });

  it('classifies 7-char 6-line as 七言古风', () => {
    const r = inferFormFromParagraphs([
      '燕山雪花大如席', '片片吹落轩辕台', '幽州思妇十二月', '停歌罢笑双蛾摧',
      '谁念北风凌马足', '群狐寒夜啸如雷',
    ]);
    expect(r.primary).toBe('七言古风');
  });

  it('classifies mixed 5+7 line as 杂言古风', () => {
    // Mixed 5-char and 7-char lines (varying length per line)
    const r = inferFormFromParagraphs(['唧唧复唧唧', '木兰当户织', '不闻机杼声', '唯闻女叹息问女何所忆']);
    expect(r.primary).toBe('杂言古风');
  });

  it('returns null for empty', () => {
    expect(inferFormFromParagraphs([]).primary).toBeNull();
    expect(inferFormFromParagraphs(['', '  ']).primary).toBeNull();
  });

  it('ignores punctuation when counting characters', () => {
    const r = inferFormFromParagraphs(['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
    expect(r.primary).toBe('五绝');
  });

  it('handles 2-line poem (short)', () => {
    const r = inferFormFromParagraphs(['白日依山尽', '黄河入海流']);
    expect(r.primary).toBe('五言古风'); // 2 lines, not 4 nor 8
  });
});

describe('resolveFormFromSource', () => {
  it('passthrough rhythmic for 词 (category=song)', () => {
    const r = resolveFormFromSource('词', '水调歌头', 'song');
    expect(r.primary).toBe('水调歌头');
    expect(r.source).toBe('passthrough');
  });

  it('returns 套数 for 元曲 套数', () => {
    const r = resolveFormFromSource('套数', null, 'yuan');
    expect(r.primary).toBe('套数');
  });

  it('returns 小令 for 元曲 小令', () => {
    const r = resolveFormFromSource('小令', null, 'yuan');
    expect(r.primary).toBe('小令');
  });

  it('returns 乐府 from chinese-poetry type=乐府', () => {
    const r = resolveFormFromSource('乐府', null, '汉乐府');
    expect(r.primary).toBe('乐府');
  });

  it('returns 五言古诗 from chinese-poetry type=五言古诗', () => {
    const r = resolveFormFromSource('五言古诗', null, 'tang');
    expect(r.primary).toBe('五言古诗');
  });

  it('returns null for empty type', () => {
    expect(resolveFormFromSource(null, null, 'tang').primary).toBeNull();
  });
});

describe('mergeForm', () => {
  it('uses source-tag when present and structural agrees', () => {
    const struct = { primary: '五绝', source: 'inferred' as const, confidence: 1.0 };
    const source = { primary: '五言绝句', source: 'source-tag' as const, confidence: 1.0 };
    const m = mergeForm(struct, source);
    expect(m.primary).toBe('五言绝句');
  });

  it('falls back to structural when source-tag absent', () => {
    const struct = { primary: '七律', source: 'inferred' as const, confidence: 1.0 };
    const source = { primary: null, source: 'source-tag' as const, confidence: 0 };
    const m = mergeForm(struct, source);
    expect(m.primary).toBe('七律');
  });

  it('returns null when both are null', () => {
    const m = mergeForm(
      { primary: null, source: 'inferred' as const, confidence: 0 },
      { primary: null, source: 'source-tag' as const, confidence: 0 }
    );
    expect(m.primary).toBeNull();
  });
});