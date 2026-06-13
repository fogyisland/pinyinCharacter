import { z } from 'zod';

// 常用汉字 (U+4E00–U+9FFF) + 扩展A 生僻字 (U+3400–U+4DBF, /rare-chars 用)
// + CJK 标点 (U+3000–U+303F) + 全角符号 (U+FF00–U+FFEF)
// 允许标点是关键: 过滤掉中文逗号会让 IME 句子的光标错位, 看起来像"字被覆盖"
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;

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

export const saveWorksheetSchema = z.object({
  title: z.string().min(1).max(80),
  content: z
    .array(z.string().regex(SINGLE_CJK))
    .min(1)
    .max(500),
  cellStyle: z.enum(['brush', 'square', 'pen']),
});

export const poemListQuerySchema = z.object({
  dynasty: z.enum(['tang', 'song']).default('tang'),
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
