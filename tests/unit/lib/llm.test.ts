import { describe, it, expect, vi, beforeEach } from 'vitest';

let configStore: Record<string, string> = {};
let lastFetchBody: any = null;
let lastFetchUrl: string | null = null;
let mockReply: string | null = null;

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(async (key: string) => configStore[key] ?? null),
}));

const fetchMock = vi.fn(async (url: string, init: any) => {
  lastFetchUrl = url;
  lastFetchBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: mockReply ?? 'mock-reply' } }],
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: mockReply ?? 'mock-reply' } }] }),
  };
});
vi.stubGlobal('fetch', fetchMock);

import { llmChat, type LLMMessage, type ContentPart } from '@/lib/llm';

beforeEach(() => {
  configStore = {};
  lastFetchBody = null;
  lastFetchUrl = null;
  mockReply = null;
  fetchMock.mockClear();
});

describe('LLM multimodal content', () => {
  it('text-only content: serializes as string (backward compat)', async () => {
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(lastFetchBody.messages[0].content).toBe('hello');
  });

  it('image_url content: serializes as OpenAI multipart format', async () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,XYZ' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content).toEqual(content);
    expect(lastFetchBody.messages[0].content[0].type).toBe('image_url');
    expect(lastFetchBody.messages[0].content[0].image_url.url).toBe('data:image/jpeg;base64,XYZ');
  });

  it('mixed text + image content: preserves order', async () => {
    const content: ContentPart[] = [
      { type: 'text', text: '识别此图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content[0]).toEqual({ type: 'text', text: '识别此图' });
    expect(lastFetchBody.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } });
  });

  it('detail field passes through to image_url', async () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,X', detail: 'low' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content[0].image_url.detail).toBe('low');
  });

  it('mock_mode short-circuit: returns vision mock char for array content', async () => {
    configStore['ai.mock_mode'] = 'true';
    const result = await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,X' } }] }],
    });
    expect(result.content).toBe('中');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});