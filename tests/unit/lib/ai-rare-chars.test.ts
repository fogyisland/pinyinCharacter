// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

import { generateRareCharContent } from '@/lib/ai-rare-chars';
import { llmChat } from '@/lib/llm';
import { getConfig } from '@/lib/config';

const mockedLlmChat = llmChat as ReturnType<typeof vi.fn>;
const mockedGetConfig = getConfig as ReturnType<typeof vi.fn>;

describe('generateRareCharContent', () => {
  it('returns both meaning and story by default', async () => {
    mockedGetConfig.mockImplementation(async (k: string) => {
      if (k === 'ai.api_key') return 'k';
      if (k === 'ai.base_url') return 'https://x/v1';
      if (k === 'ai.model') return 'm';
      return null;
    });
    mockedLlmChat.mockResolvedValueOnce({
      content: JSON.stringify([{ char: '龘', meaning: '龙行貌', story: '古字' }]),
    });
    const out = await generateRareCharContent({ char: '龘', pinyin: 'dá' });
    expect(out.meaning).toBe('龙行貌');
    expect(out.story).toBe('古字');
  });

  it('returns only meaning when fields=[meaning]', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'k';
    process.env.LLM_BASE_URL = 'https://x/v1';
    mockedLlmChat.mockResolvedValueOnce({
      content: JSON.stringify([{ char: '龘', meaning: '龙行貌', story: '古字' }]),
    });
    const out = await generateRareCharContent({ char: '龘', pinyin: 'dá' }, { fields: ['meaning'] });
    expect(out.meaning).toBe('龙行貌');
    expect(out.story).toBe('');
  });

  it('returns only story when fields=[story]', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'k';
    process.env.LLM_BASE_URL = 'https://x/v1';
    mockedLlmChat.mockResolvedValueOnce({
      content: JSON.stringify([{ char: '龘', meaning: '龙行貌', story: '古字' }]),
    });
    const out = await generateRareCharContent({ char: '龘', pinyin: 'dá' }, { fields: ['story'] });
    expect(out.meaning).toBe('');
    expect(out.story).toBe('古字');
  });

  it('throws on invalid JSON response', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'k';
    process.env.LLM_BASE_URL = 'https://x/v1';
    mockedLlmChat.mockResolvedValueOnce({ content: 'not json' });
    await expect(generateRareCharContent({ char: '龘', pinyin: 'dá' })).rejects.toThrow(/JSON/i);
  });

  it('falls back to first item when char mismatch', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'k';
    process.env.LLM_BASE_URL = 'https://x/v1';
    mockedLlmChat.mockResolvedValueOnce({
      content: JSON.stringify([{ char: '龘', meaning: '龙行貌', story: '古字' }]),
    });
    const out = await generateRareCharContent({ char: '靐', pinyin: 'bìng' });
    expect(out.meaning).toBe('龙行貌');
  });
});