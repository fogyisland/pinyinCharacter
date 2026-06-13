import { getPool } from './db';
import { llmChat, LLMError } from './llm';
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
  // Read the model from app_config so it flows into logAiCall.model.
  // options.model is a fallback for tests / callers that don't want to read DB config.
  const model = (await getConfig('ai.model')) ?? options.model ?? 'gpt-4o-mini';

  return withAiLogging(
    {
      userId: null,
      feature: 'rare-char-story-batch',
      model,
      metadata: { batchSize: inputs.length, provider: options.provider },
    },
    async () => {
      const apiKey = process.env.LLM_API_KEY;
      const baseUrl = process.env.LLM_BASE_URL;
      if (!apiKey) throw new Error('LLM_API_KEY is not set');
      if (!baseUrl) throw new Error('LLM_BASE_URL is not set');

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
