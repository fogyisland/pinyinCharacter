import { getPool } from './db';
import { llmChat } from './llm';
import { getConfig } from './config';
import { withAiLogging } from './ai-calls';

export interface BatchInput {
  char: string;
  pinyin: string;
}

export interface BatchOutput {
  char: string;
  meaning: string;
  story: string;
}

export interface GenerateOptions {
  provider: string;
  model: string;
  batchSize?: number;
  sleepMs?: number;
  maxAttempts?: number;
  onError?: (err: unknown, batch: BatchInput[]) => void;
}

const SYSTEM_PROMPT = `你是一位小学语文老师。请为每个汉字写:
1) 简短释义(10-30字)
2) 一个适合 6-12 岁孩子的故事或例句(50-200字)。

只返回严格 JSON 数组,不要 markdown 代码块,不要任何额外文字。
格式: [{"char":"龘","pinyin":"dá","meaning":"...","story":"..."}, ...]`;

/**
 * Batch-generate meaning + story for an array of chars using an OpenAI-compatible LLM.
 * Writes back to rare_chars and returns the number of rows successfully updated.
 *
 * Skips rows whose meaning is already non-empty (idempotent re-runs).
 */
export async function batchGenerateStories(
  inputs: BatchInput[],
  options: GenerateOptions
): Promise<number> {
  // Read connection config from app_config (managed via /admin/ai) with env-var fallback.
  const dbBaseUrl = await getConfig('ai.base_url');
  const dbApiKey = await getConfig('ai.api_key');
  const model = (await getConfig('ai.model')) ?? options.model ?? 'gpt-4o-mini';

  return withAiLogging(
    {
      userId: null,
      feature: 'rare-char-story-batch',
      model,
      metadata: { batchSize: inputs.length, provider: options.provider },
    },
    async () => {
      const apiKey = dbApiKey ?? process.env.LLM_API_KEY;
      const baseUrl = dbBaseUrl ?? process.env.LLM_BASE_URL;
      if (!apiKey) throw new Error('LLM api key not configured (set ai.api_key in /admin/ai or LLM_API_KEY env)');
      if (!baseUrl) throw new Error('LLM base URL not configured (set ai.base_url in /admin/ai or LLM_BASE_URL env)');

      const batchSize = options.batchSize ?? 50;
      const sleepMs = options.sleepMs ?? 2000;
      const maxAttempts = options.maxAttempts ?? 2;
      const generatedBy = `${options.provider}:${model}`;
      const pool = getPool();

      let updated = 0;
      for (let i = 0; i < inputs.length; i += batchSize) {
        const batch = inputs.slice(i, i + batchSize);
        const userPrompt = `汉字列表:\n${batch.map((b) => b.char).join('\n')}`;
        let attempt = 0;
        let success = false;
        while (attempt < maxAttempts && !success) {
          attempt++;
          try {
            const res = await llmChat({
              baseUrl,
              apiKey,
              model,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
              ],
            });
            const parsed = parseJsonArray(res.content);
            const conn = await pool.getConnection();
            try {
              for (const item of parsed) {
                const match = batch.find((b) => b.char === item.char);
                if (!match) continue;
                await conn.execute(
                  `UPDATE rare_chars
                   SET meaning = ?, story = ?, generated_by = ?, generated_at = NOW(), needs_review = 1
                   WHERE \`char\` = ?`,
                  [item.meaning, item.story, generatedBy, item.char]
                );
                updated++;
              }
            } finally {
              conn.release();
            }
            success = true;
          } catch (err) {
            if (attempt >= maxAttempts) {
              options.onError?.(err, batch);
            } else {
              await sleep(1000);
            }
          }
        }
        if (i + batchSize < inputs.length) await sleep(sleepMs);
      }
      return updated;
    },
  );
}

function parseJsonArray(content: string): BatchOutput[] {
  // Strip markdown code fences if present
  const stripped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const data = JSON.parse(stripped);
  if (!Array.isArray(data)) throw new Error('expected JSON array');
  return data as BatchOutput[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RareCharContentInput { char: string; pinyin: string; }
export interface RareCharContent { meaning: string; story: string; }

/**
 * Single-char generator for the admin UI. Uses the same SYSTEM_PROMPT as the
 * batch flow but returns the parsed JSON object instead of writing to DB.
 *
 * `fields` defaults to both; pass a single-field array to get a tighter LLM
 * response (e.g. only meaning) — the prompt asks the model for that field.
 */
export async function generateRareCharContent(
  input: RareCharContentInput,
  options?: { fields?: Array<'meaning' | 'story'> },
): Promise<RareCharContent> {
  const fields = options?.fields ?? ['meaning', 'story'];
  const wantMeaning = fields.includes('meaning');
  const wantStory = fields.includes('story');
  const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';
  const apiKey = (await getConfig('ai.api_key')) ?? process.env.LLM_API_KEY;
  const baseUrl = (await getConfig('ai.base_url')) ?? process.env.LLM_BASE_URL;
  if (!apiKey) throw new Error('LLM api key not configured');
  if (!baseUrl) throw new Error('LLM base URL not configured');

  const singleLine = wantMeaning && wantStory
    ? 'meaning (10-30 字) and story (50-200 字)'
    : wantMeaning
      ? 'meaning only (10-30 字)'
      : 'story only (50-200 字)';

  const userPrompt = `汉字:「${input.char}」(拼音: ${input.pinyin})\n请只返回 ${singleLine}。`;

  return withAiLogging(
    { userId: null, feature: 'rare-char-content', model, metadata: { char: input.char, fields } },
    async () => {
      const res = await llmChat({
        baseUrl,
        apiKey,
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        maxTokens: 600,
      });
      const arr = parseJsonArray(res.content);
      const item = arr.find(x => x.char === input.char) ?? arr[0];
      if (!item) throw new Error('LLM returned empty content');
      return {
        meaning: wantMeaning ? String(item.meaning ?? '') : '',
        story: wantStory ? String(item.story ?? '') : '',
      };
    },
  );
}
