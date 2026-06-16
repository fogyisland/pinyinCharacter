import { getConfig } from './config';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatArgs {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResponse {
  content: string;
}

export class LLMError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Minimal OpenAI-compatible chat completions client.
 * Sends POST {baseUrl}/chat/completions with the messages, returns the first choice's content.
 */
export async function llmChat(args: LLMChatArgs): Promise<LLMChatResponse> {
  // Mock mode short-circuit: when ai.mock_mode='true' in app_config, return deterministic
  // fixed strings based on the message content. Used by /admin/chars/init to verify the
  // dispatch/DB-write path end-to-end without burning LLM quota or hitting rate limits.
  const mockMode = await getConfig('ai.mock_mode');
  if (mockMode === 'true') {
    const last = args.messages[args.messages.length - 1]?.content ?? '';
    return { content: mockReply(last) };
  }

  // Accept either "https://api.minimaxi.com/v1" or "https://api.minimaxi.com/v1/chat/completions"
  // — many dashboards show the full path; strip it if present so we don't double-append.
  const stripped = args.baseUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions\/?$/, '');
  const url = `${stripped}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.3,
      max_tokens: args.maxTokens ?? 4096,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LLMError(`LLM ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LLMError('LLM returned empty content');
  return { content: stripThinking(content) };
}

/**
 * Strip <think>...</think> / <thinking>...</thinking> blocks from model output.
 * MiniMax-M3 (and similar reasoning models) embed their chain-of-thought in the
 * response body using these tags; downstream code (DB writes, UI display) only
 * wants the final answer. Stripping at the LLM boundary keeps every caller clean.
 */
function stripThinking(content: string): string {
  return content
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

/**
 * Pick a deterministic mock reply based on the prompt content. Covers the 5
 * single-char features (char-ai) and the rare-char single-char path
 * (ai-rare-chars). All non-matching prompts return a generic MOCK string.
 */
function mockReply(prompt: string): string {
  // char-ai features. Note: mock return values must NOT contain the same
  // keywords we match on, because meaning_zh writes to chars.meaning_zh and
  // subsequent calls (e.g. variants) interpolate that into their prompt as
  // "释义: <meaning_zh>" — a keyword inside the stored value would cause
  // the wrong branch to fire.
  if (prompt.includes('字源演变')) {
    return 'MOCK-etym-字源故事。' + 'A'.repeat(80) + '(占位填充)';
  }
  if (prompt.includes('concise English gloss')) {
    return 'MOCK-en-gloss for the char';
  }
  if (prompt.includes('中文释义')) {
    return 'MOCK-zh-meaning 占位';
  }
  if (prompt.includes('所有常见读音')) {
    return '["mock-yī", "mock-yí"]';
  }
  if (prompt.includes('异体')) {
    return '["mock-变体A", "mock-变体B"]';
  }
  if (prompt.includes('形、义、用')) {
    return 'MOCK-explainChar 形义用解释';
  }
  // ai-rare-chars single-char: ask for "meaning only" / "story only" / both.
  if (prompt.includes('meaning only')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: 'MOCK-rare-mn', story: '' }]);
  }
  if (prompt.includes('story only')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: '', story: 'MOCK-rare-st 占位' }]);
  }
  if (prompt.includes('meaning') && prompt.includes('story')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: 'MOCK-rare-mn', story: 'MOCK-rare-st' }]);
  }
  // ai-rare-chars batch path.
  if (prompt.includes('汉字列表')) {
    return '[]';
  }
  return 'MOCK-generic-llm-reply';
}

/**
 * Higher-level wrapper that hides the messages[] shape from callers
 * (callers provide system + prompt instead of building the message array).
 * Returns the trimmed content string of the first choice.
 *
 * Config resolution priority: explicit args > app_config > env vars.
 * app_config is read from `ai.base_url`, `ai.api_key`, `ai.model` keys
 * (managed via /admin/ai config tab).
 */
export interface CallLlmArgs {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export async function callLlm(args: CallLlmArgs): Promise<string> {
  // Mock mode: skip the apiKey/baseUrl guard so the init page works on a fresh DB
  // that has no AI config yet. llmChat() also checks ai.mock_mode independently.
  const mockMode = await getConfig('ai.mock_mode');
  if (mockMode === 'true') {
    const res = await llmChat({
      baseUrl: args.baseUrl ?? 'http://mock',
      apiKey: args.apiKey ?? 'mock',
      model: args.model ?? 'mock-model',
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.prompt },
      ],
      temperature: args.temperature,
      maxTokens: args.maxTokens,
    });
    return res.content;
  }

  const dbBaseUrl = await getConfig('ai.base_url');
  const dbApiKey = await getConfig('ai.api_key');
  const dbModel = await getConfig('ai.model');
  const apiKey = args.apiKey ?? dbApiKey ?? process.env.LLM_API_KEY;
  const baseUrl = args.baseUrl ?? dbBaseUrl ?? process.env.LLM_BASE_URL;
  const model = args.model ?? dbModel ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) throw new LLMError('LLM api key not configured (set ai.api_key in /admin/ai or LLM_API_KEY env)');
  if (!baseUrl) throw new LLMError('LLM base URL not configured (set ai.base_url in /admin/ai or LLM_BASE_URL env)');
  const res = await llmChat({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.prompt },
    ],
    temperature: args.temperature,
    maxTokens: args.maxTokens,
  });
  return res.content;
}
