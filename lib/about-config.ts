/**
 * Cached AI-generated about-page intro.
 *
 * Stored in app_config under 2 keys:
 *   about.intro_text        - the markdown body
 *   about.intro_generated_at - ISO timestamp of last generation
 *
 * Read by /about (server component) and /api/about/intro (public).
 * Written only by /api/admin/about/intro (admin-only regenerate endpoint).
 */
import { getPool } from './db';

const KEY_INTRO = 'about.intro_text';
const KEY_GENERATED_AT = 'about.intro_generated_at';

export interface CachedAboutIntro {
  text: string;
  generatedAt: string | null;
  isAi: boolean;
}

export async function readAboutIntro(): Promise<CachedAboutIntro> {
  const [rows] = await getPool().query<any[]>(
    `SELECT \`key\`, value FROM app_config WHERE \`key\` IN (?, ?)`,
    [KEY_INTRO, KEY_GENERATED_AT],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    text: out[KEY_INTRO] ?? '',
    generatedAt: out[KEY_GENERATED_AT] ?? null,
    isAi: !!(out[KEY_INTRO] && out[KEY_GENERATED_AT]),
  };
}

export async function writeAboutIntro(text: string, byUserId: number | null): Promise<void> {
  const pool = getPool();
  const set = (k: string, v: string) =>
    pool.query(
      `INSERT INTO app_config (\`key\`, value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [k, v, byUserId],
    );
  await set(KEY_INTRO, text);
  await set(KEY_GENERATED_AT, new Date().toISOString());
}

/**
 * Default fallback intro shown when no AI-generated version is cached yet.
 * Hand-written so first-time visitors always see something useful.
 */
export const DEFAULT_INTRO = `字·韵 是一个面向汉字学习者的公益工具站,完全免费开源。

我们把汉字学习过程中最常用的小工具汇总在同一个站点:
- 字↔拼音 互转 (客户端实时,支持整句 Viterbi)
- 8105 通用规范汉字字典 (按拼音 / 部首 / 搜索)
- 罕见字库 (1600+ 生僻字,AI 释义 + 故事)
- 字帖生成器 (田字格 / 米字格,A4 打印)
- 笔画顺序动画 (hanzi-writer,87% 汉字覆盖)
- 识字游戏 (声调 / 部首 / 拼音 拖拽匹配,3 难度)
- 诗词 / 佛经 / 故事 阅读器 (TTS 朗读)
- 字典字源 (5 个时代字形 + AI 故事)

技术栈:Next.js 15 + TypeScript + MySQL + pinyin-pro。
无需登录即可使用所有功能,登录后可保存字帖 / 收藏 / 历史。
欢迎在 GitHub 提 issue 反馈 bug 或建议功能。`;