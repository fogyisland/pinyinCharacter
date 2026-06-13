import { callLlm } from './llm';

const SYSTEM_PROMPT = `你是一位汉语言文字学家,擅长汉字字源研究。`;

function buildPrompt(char: string, pinyin: string, meaningZh: string | null): string {
  return `请为汉字「${char}」(拼音: ${pinyin}${meaningZh ? `, 释义: ${meaningZh}` : ''}) 写一段 150-250 字的字源演变故事。

要求:
1. 涵盖该字在甲骨文/金文/小篆/隶书/楷书 5 个时代的字形演变
2. 说明字形演变的动因 (如简化、讹变、规范化等)
3. 简洁生动,适合普通读者
4. 不用 Markdown 格式,纯文本

直接输出故事正文,不要前缀。`;
}

export interface EtymologyStoryInput {
  char: string;
  pinyin: string;
  meaningZh: string | null;
}

/**
 * Generate a 150-250 character etymology story for one Chinese character.
 * Used by the admin manual trigger and the cron job.
 *
 * Throws on LLM errors. Callers should wrap in withAiLogging.
 */
export async function generateEtymologyStory(input: EtymologyStoryInput): Promise<string> {
  const text = await callLlm({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input.char, input.pinyin, input.meaningZh),
    temperature: 0.5,
    maxTokens: 500,
  });
  return text.trim();
}
