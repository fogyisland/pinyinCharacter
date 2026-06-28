import { z } from 'zod';

// 常用汉字 (U+4E00–U+9FFF) + 扩展A 生僻字 (U+3400–U+4DBF, /rare-chars 用)
// + CJK 标点 (U+3000–U+303F) + 全角符号 (U+FF00–U+FFEF)
// 允许标点是关键: 过滤掉中文逗号会让 IME 句子的光标错位, 看起来像"字被覆盖"
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;

// 保存到字帖的字符: 只保留 BMP 汉字, 过滤标点/全角空格/全角符号.
// 与 SINGLE_CJK 的区别: SINGLE_CJK 接受标点 (IME 友好), WORKSHEET_CHAR 用于
// 实际写入 DB content 前的过滤 (一个字一个格子, 标点不应放进格子里).
const WORKSHEET_CHAR = /^[㐀-鿿]$/;

export const searchQuerySchema = z.object({
  q: z
    .string()
    .max(32)
    .transform((s) => s.trim())
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  minMeaning: z.coerce.boolean().optional(),
});

export const worksheetIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const charParamSchema = z.object({
  char: z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
    error: 'must be a single CJK char',
  }),
});

export const appendToWorksheetSchema = z
  .object({
    char: z
      .string()
      .refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
        error: 'must be a single CJK char',
      })
      .optional(),
    chars: z
      .array(z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
        error: 'each entry must be a single CJK char',
      }))
      .min(1)
      .max(500)
      .transform((arr) => arr.filter((c) => WORKSHEET_CHAR.test(c)))
      .refine((arr) => arr.length >= 1, { message: 'at least one CJK char required after filtering punctuation' })
      .optional(),
    worksheetId: z.coerce.number().int().positive().optional(),
    newTitle: z.string().min(1).max(80).optional(),
  })
  .refine((v) => !(v.worksheetId && v.newTitle), {
    error: 'worksheetId and newTitle are mutually exclusive',
    path: ['newTitle'],
  })
  .refine((v) => !!(v.char || v.chars), {
    error: 'either char or chars is required',
    path: ['char'],
  });

export const printBatchSchema = z.object({
  worksheetIds: z.array(z.number().int().positive()).min(1).max(50),
});

export const renameWorksheetSchema = z.object({
  title: z.string().min(1).max(80).transform((s) => s.trim()).refine((s) => s.length >= 1, {
    error: 'title must be 1-80 non-blank chars',
  }),
});

export const saveWorksheetSchema = z.object({
  title: z.string().min(1).max(80),
  content: z
    .array(z.string().regex(SINGLE_CJK))
    .min(1)
    .max(500)
    .transform((arr) => arr.filter((c) => WORKSHEET_CHAR.test(c)))
    .refine((arr) => arr.length >= 1, { message: 'at least one CJK char required after filtering punctuation' }),
  cellStyle: z.enum([
    'brush-square', 'brush-cross',
    'pen-square',   'pen-cross',
    'brush-trace-square', 'brush-trace-cross',
  ]),
  paperSize: z.enum(['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28']).default('A4'),
  fontFamily: z.enum([
    'song', 'kai', 'hei',
    'wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin',
    'ma-shan-zheng', 'long-cang',
  ]).default('song'),
});

export const poemListQuerySchema = z.object({
  dynasty: z.string().min(1).max(32).default('tang'),
  category: z.string().min(1).max(32).optional(),
  forms: z.string().max(256).optional(),
  q: z.string().max(64).transform((s) => s.trim()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const poemIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const sutraListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const sutraIdParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const classicsListQuerySchema = z.object({
  category: z.enum(['four-books', 'five-classics', 'mengxue', 'philosophy', 'history', 'other', 'pianwen']).optional(),
  q: z.string().max(64).transform((s) => s.trim()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const classicSlugParamSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(64),
});

export const gameRoundQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(8).default(4),
  seed: z.coerce.number().int().optional(),
});

export const charsListQuerySchema = z.object({
  q: z.string().max(32).transform((s) => s.trim()).optional(),
  letter: z.string().regex(/^[A-Z]$/).optional(),
  radical: z.string().max(8).optional(),
  level: z.coerce.number().int().min(1).max(3).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const charsRandomQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(20),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

export const etymologyCharParamSchema = charParamSchema;

export const adminGenerateEtymologySchema = z.object({
  chars: z.array(z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s))).min(1).max(100),
});

const adminGenerateFieldsSchema = z.object({
  pinyin_alt: z.boolean().optional(),
  meaning_zh: z.boolean().optional(),
  meaning_en: z.boolean().optional(),
  variants: z.boolean().optional(),
  etymology_story: z.boolean().optional(),
  rare_meaning: z.boolean().optional(),
  rare_story: z.boolean().optional(),
}).refine((o) => Object.values(o).some(Boolean), { message: 'at least one field required' });

export const adminGenerateCharsSchema = z.object({
  chars: z.array(z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s))).min(1).max(100),
  fields: adminGenerateFieldsSchema,
});

export const adminGenerateByLevelSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fields: adminGenerateFieldsSchema,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  concurrency: z.number().int().min(1).max(8).default(4),
});

export const adminCronConfigSchema = z.object({
  enabled: z.boolean(),
  perDay: z.number().int().min(1).max(1000),
});

export const adminSchedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMin: z.number().int().min(1).max(24 * 60).optional(),
  taskContentRefresh: z.boolean().optional(),
  taskDailyChar: z.boolean().optional(),
  taskStatsRefresh: z.boolean().optional(),
});

export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_\-]+$/, '用户名仅支持字母数字下划线短横'),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
