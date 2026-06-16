// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

import { callLlm, llmChat, LLMError } from '@/lib/llm';
import { getConfig } from '@/lib/config';

const mockedGetConfig = getConfig as ReturnType<typeof vi.fn>;

describe('callLlm config resolution', () => {
  const originalEnv = { ...process.env };
  const fetchSpy = vi.fn();

  beforeEach(() => {
    mockedGetConfig.mockReset();
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('reads baseUrl / apiKey / model from app_config first', async () => {
    mockedGetConfig.mockImplementation(async (k: string) => {
      if (k === 'ai.base_url') return 'https://db.example.com/v1';
      if (k === 'ai.api_key') return 'db-key';
      if (k === 'ai.model') return 'db-model';
      return null;
    });
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_MODEL = 'env-model';

    const text = await callLlm({ system: 's', prompt: 'p' });
    expect(text).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://db.example.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('db-model');
    expect(init.headers.Authorization).toBe('Bearer db-key');
  });

  it('falls back to env vars when app_config is null', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_MODEL = 'env-model';

    await callLlm({ system: 's', prompt: 'p' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://env.example.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('env-model');
    expect(init.headers.Authorization).toBe('Bearer env-key');
  });

  it('falls back to default model when neither app_config nor env var is set', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';

    await callLlm({ system: 's', prompt: 'p' });
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe('gpt-4o-mini');
  });

  it('explicit args override app_config and env vars', async () => {
    mockedGetConfig.mockImplementation(async (k: string) => {
      if (k === 'ai.api_key') return 'db-key';
      return null;
    });
    process.env.LLM_API_KEY = 'env-key';

    await callLlm({
      system: 's',
      prompt: 'p',
      baseUrl: 'https://explicit.example.com/v1',
      apiKey: 'explicit-key',
      model: 'explicit-model',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://explicit.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer explicit-key');
    expect(JSON.parse(init.body).model).toBe('explicit-model');
  });

  it('throws LLMError when api key is not configured anywhere', async () => {
    mockedGetConfig.mockResolvedValue(null);
    await expect(callLlm({ system: 's', prompt: 'p' })).rejects.toThrow(LLMError);
    await expect(callLlm({ system: 's', prompt: 'p' })).rejects.toThrow(/api key/i);
  });

  it('throws LLMError when base URL is not configured anywhere', async () => {
    mockedGetConfig.mockImplementation(async (k: string) =>
      k === 'ai.api_key' ? 'db-key' : null,
    );
    await expect(callLlm({ system: 's', prompt: 'p' })).rejects.toThrow(LLMError);
    await expect(callLlm({ system: 's', prompt: 'p' })).rejects.toThrow(/base url/i);
  });

  it('trims trailing slash from baseUrl before composing url', async () => {
    mockedGetConfig.mockResolvedValue(null);
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1/';
    await callLlm({ system: 's', prompt: 'p' });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://env.example.com/v1/chat/completions');
  });
});

describe('llmChat', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to {baseUrl}/chat/completions and returns first choice content', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      text: async () => '',
    });
    const res = await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('hello');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('throws LLMError with status on non-ok response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });
    await expect(llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ name: 'LLMError', status: 429 });
  });

  it('throws when response has no choices', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    });
    await expect(llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/empty/i);
  });
});
