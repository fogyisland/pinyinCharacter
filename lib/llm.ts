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
  const url = `${args.baseUrl.replace(/\/$/, '')}/chat/completions`;
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
  return { content };
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
