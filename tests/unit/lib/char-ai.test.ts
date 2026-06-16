// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/llm', () => ({
  callLlm: vi.fn(),
}));

import {
  generateEtymologyStory,
  generateMeaningZh,
  generateMeaningEn,
  generatePinyinAlt,
  generateVariants,
} from '@/lib/char-ai';
import { callLlm } from '@/lib/llm';

const mockedCallLlm = callLlm as ReturnType<typeof vi.fn>;

describe('generateEtymologyStory', () => {
  it('returns LLM story text', async () => {
    mockedCallLlm.mockResolvedValueOnce('一 字演变故事正文...');
    const story = await generateEtymologyStory({ char: '一', pinyin: 'yī', meaningZh: '数目字' });
    expect(story).toBe('一 字演变故事正文...');
  });

  it('uses the etymology prompt template', async () => {
    mockedCallLlm.mockResolvedValueOnce('story');
    await generateEtymologyStory({ char: '丁', pinyin: 'dīng', meaningZh: null });
    expect(mockedCallLlm).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('字源'),
      prompt: expect.stringContaining('丁'),
    }));
  });
});

describe('generateMeaningZh', () => {
  it('returns trimmed Chinese meaning', async () => {
    mockedCallLlm.mockResolvedValueOnce('  数目字,最小的正整数  ');
    const text = await generateMeaningZh({ char: '一', pinyin: 'yī' });
    expect(text).toBe('数目字,最小的正整数');
  });

  it('passes char + pinyin in prompt', async () => {
    mockedCallLlm.mockResolvedValueOnce('男');
    await generateMeaningZh({ char: '男', pinyin: 'nán' });
    expect(mockedCallLlm).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringMatching(/男.*nán/s),
    }));
  });
});

describe('generateMeaningEn', () => {
  it('returns trimmed English gloss', async () => {
    mockedCallLlm.mockResolvedValueOnce('  one; single  ');
    const text = await generateMeaningEn({ char: '一', pinyin: 'yī', meaningZh: '数目字' });
    expect(text).toBe('one; single');
  });
});

describe('generatePinyinAlt', () => {
  it('parses strict JSON array', async () => {
    mockedCallLlm.mockResolvedValueOnce('["yī", "yí", "yì"]');
    const arr = await generatePinyinAlt({ char: '一', pinyin: 'yī' });
    expect(arr).toEqual(['yī', 'yí', 'yì']);
  });

  it('strips markdown fences before parsing', async () => {
    mockedCallLlm.mockResolvedValueOnce('```json\n["yī"]\n```');
    const arr = await generatePinyinAlt({ char: '一', pinyin: 'yī' });
    expect(arr).toEqual(['yī']);
  });

  it('throws on non-JSON response', async () => {
    mockedCallLlm.mockResolvedValueOnce('not json');
    await expect(generatePinyinAlt({ char: '一', pinyin: 'yī' })).rejects.toThrow(/JSON/i);
  });
});

describe('generateVariants', () => {
  it('parses strict JSON array', async () => {
    mockedCallLlm.mockResolvedValueOnce('["龜", "亀"]');
    const arr = await generateVariants({ char: '龟', pinyin: 'guī' });
    expect(arr).toEqual(['龜', '亀']);
  });

  it('filters out the source char from result', async () => {
    mockedCallLlm.mockResolvedValueOnce('["回", "囘"]');
    const arr = await generateVariants({ char: '回', pinyin: 'huí' });
    expect(arr).toEqual(['囘']);
  });

  it('dedupes repeated variants', async () => {
    mockedCallLlm.mockResolvedValueOnce('["龜", "龜", "亀"]');
    const arr = await generateVariants({ char: '龟', pinyin: 'guī' });
    expect(arr).toEqual(['龜', '亀']);
  });

  it('returns empty array when LLM says none', async () => {
    mockedCallLlm.mockResolvedValueOnce('[]');
    const arr = await generateVariants({ char: '一', pinyin: 'yī' });
    expect(arr).toEqual([]);
  });
});
