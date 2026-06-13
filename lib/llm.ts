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
  const apiKey = args.apiKey ?? process.env.LLM_API_KEY;
  const baseUrl = args.baseUrl ?? process.env.LLM_BASE_URL;
  const model = args.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) throw new LLMError('LLM_API_KEY is not set');
  if (!baseUrl) throw new LLMError('LLM_BASE_URL is not set');
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
