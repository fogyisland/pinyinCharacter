// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/llm', () => ({
  callLlm: vi.fn(),
}));

import { generateEtymologyStory } from '@/lib/char-ai';
import { callLlm } from '@/lib/llm';

describe('generateEtymologyStory', () => {
  it('returns LLM story text', async () => {
    (callLlm as ReturnType<typeof vi.fn>).mockResolvedValueOnce('一 字演变故事正文...');
    const story = await generateEtymologyStory({ char: '一', pinyin: 'yī', meaningZh: '数目字' });
    expect(story).toBe('一 字演变故事正文...');
  });

  it('uses the etymology prompt template', async () => {
    (callLlm as ReturnType<typeof vi.fn>).mockResolvedValueOnce('story');
    await generateEtymologyStory({ char: '丁', pinyin: 'dīng', meaningZh: null });
    expect(callLlm).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('字源'),
      prompt: expect.stringContaining('丁'),
    }));
  });
});
