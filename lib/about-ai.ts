/**
 * AI prompt + call for generating the /about page intro.
 *
 * The prompt carries just enough project context for the LLM to write
 * something on-brand, without dumping the entire codebase into the prompt.
 */
import { BRAND } from './design';
import { callLlm } from './llm';
import { logAiCall } from './ai-calls';

const FEATURES = [
  '字↔拼音 互转 (pinyin-pro,客户端实时)',
  '8105 通用规范汉字字典 (按拼音 / 部首 / 搜索)',
  '罕见字库 (1600+ 生僻字,AI 释义 + 故事)',
  '字帖生成器 (田字格 / 米字格,A4 打印)',
  '笔画顺序动画 (hanzi-writer,87% 汉字覆盖)',
  '识字游戏 (声调 / 部首 / 拼音 拖拽匹配,3 难度)',
  '诗词 / 佛经 / 故事 阅读器 (TTS 朗读)',
  '字典字源页 (5 个时代字形 + AI 故事)',
] as const;

const TECH_STACK = [
  'Next.js 15 + TypeScript',
  'MySQL 5.7',
  'pinyin-pro (客户端字→拼音)',
  'hanzi-writer (笔画动画)',
  'Tailwind CSS',
] as const;

const SYSTEM_PROMPT = `你是「${BRAND.name}」项目的介绍写手。基于用户提供的项目事实,写一段 200-300 字的中文项目介绍。

要求:
- 用第二人称「你」称呼读者,亲切自然
- 突出公益 / 免费 / 开源定位
- 列出 3-5 个最核心的功能 (从提供的功能列表里挑)
- 末尾加一句邀请反馈 / 提 issue 的话
- 不要使用表情符号
- 不要重复项目名超过 2 次
- 不要 Markdown 标题 (#);纯段落即可,可在段间用空行`;

function buildPrompt(): string {
  return `项目名称: ${BRAND.name}
项目定位: ${BRAND.shortDesc}
品牌口号: ${BRAND.tagline}
开源协议: MIT

核心功能:
${FEATURES.map((f) => `- ${f}`).join('\n')}

技术栈:
${TECH_STACK.map((t) => `- ${t}`).join('\n')}

请基于以上事实写一段 200-300 字的中文项目介绍,直接输出正文,不要写「以下是介绍」之类的引导语。`;
}

export interface GenerateIntroResult {
  text: string;
  durationMs: number;
  model: string;
}

export async function generateAboutIntro(userId: number | null): Promise<GenerateIntroResult> {
  const start = Date.now();
  let text = '';
  let status: 'ok' | 'error' = 'ok';
  let model = 'unknown';
  try {
    text = await callLlm({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(),
      temperature: 0.7,
      maxTokens: 800,
    });
    // Soft-trim: collapse 3+ blank lines to 2, and strip leading/trailing whitespace.
    text = text
      .replace(/\r/g, '')
      .trim()
      .replace(/\n{3,}/g, '\n\n');
    const { getConfig } = await import('./config');
    model = (await getConfig('ai.model')) ?? 'unknown';
  } catch (e) {
    status = 'error';
    text = (e as Error).message;
    throw e;
  } finally {
    await logAiCall({
      userId,
      feature: 'about-intro',
      model,
      status,
      durationMs: Date.now() - start,
      ...(status === 'error' ? { error: text } : { metadata: { charCount: text.length } }),
    });
  }
  return { text, durationMs: Date.now() - start, model };
}