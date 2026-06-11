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
