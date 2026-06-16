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

export interface CharExplainInput { char: string; pinyin: string; }
export async function explainChar(input: CharExplainInput): Promise<string> {
  const text = await callLlm({
    system: '你是一位汉语言文字学家,擅长简洁解释汉字。',
    prompt: `请用 60-100 字简洁解释汉字「${input.char}」的形、义、用。\n\n直接输出解释,不要前缀。`,
    temperature: 0.5,
    maxTokens: 200,
  });
  return text.trim();
}

export interface MeaningZhInput { char: string; pinyin: string; }
export async function generateMeaningZh(input: MeaningZhInput): Promise<string> {
  const text = await callLlm({
    system: '你是一位汉语言文字学家,擅长简洁释义。',
    prompt: `请为汉字「${input.char}」(拼音: ${input.pinyin}) 写一条 10-30 字的中文释义,适合普通读者。\n\n只输出释义本身,不要前缀、不要标点包装。`,
    temperature: 0.3,
    maxTokens: 100,
  });
  return text.trim();
}

export interface MeaningEnInput { char: string; pinyin: string; meaningZh?: string | null; }
export async function generateMeaningEn(input: MeaningEnInput): Promise<string> {
  const text = await callLlm({
    system: 'You are a lexicographer specializing in concise English glosses for Chinese characters.',
    prompt: `Provide a concise English gloss (5-15 words) for the Chinese character "${input.char}" (pinyin: ${input.pinyin}${input.meaningZh ? `, Chinese meaning: ${input.meaningZh}` : ''}).\n\nOutput ONLY the gloss, no explanation, no quotes.`,
    temperature: 0.3,
    maxTokens: 60,
  });
  return text.trim();
}

export interface PinyinAltInput { char: string; pinyin: string; }
export async function generatePinyinAlt(input: PinyinAltInput): Promise<string[]> {
  const text = await callLlm({
    system: '你是一位汉语言文字学家。',
    prompt: `汉字「${input.char}」的常用拼音是 ${input.pinyin}。请列出它所有常见读音(包括主读音)。\n\n只返回 JSON 数组,格式: ["yī", "yí"]。如果没有其他读音,返回 ["${input.pinyin}"]。不要任何其他文字、不要 markdown 代码块。`,
    temperature: 0.2,
    maxTokens: 80,
  });
  return parseJsonStringArray(text);
}

export interface VariantsInput { char: string; pinyin: string; meaningZh?: string | null; }
export async function generateVariants(input: VariantsInput): Promise<string[]> {
  const text = await callLlm({
    system: '你是一位汉语言文字学家。',
    prompt: `汉字「${input.char}」(拼音: ${input.pinyin}${input.meaningZh ? `, 释义: ${input.meaningZh}` : ''}) 有哪些异体字?\n\n只返回 JSON 数组,格式: ["字1", "字2"]。如果确实没有异体,返回 []。不要任何其他文字、不要 markdown 代码块。`,
    temperature: 0.2,
    maxTokens: 80,
  });
  const arr = parseJsonStringArray(text);
  return Array.from(new Set(arr.filter(v => v !== input.char)));
}

function parseJsonStringArray(content: string): string[] {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const data = JSON.parse(stripped);
  if (!Array.isArray(data)) throw new Error('expected JSON array');
  return data.map(v => String(v));
}
