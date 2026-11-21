import { z } from 'zod';
import { MAX_CLASS_NAME, MAX_DICTATION_ITEMS, MAX_ASSIGNMENT_CHARS, isJoinCode } from './classes';

/**
 * 班级与作业的请求校验。
 *
 * 校验放在这里而不是路由里，是为了让「一个字段的边界」只有一处定义：
 * 备注 512 字、班级名 64 字、字帖 500 格 —— 这些数字同时也出现在 SQL 的
 * 列宽里，改一处就要改另一处，所以它们从 lib/classes.ts 导入而不是重写。
 */

/** 备注：超长时截断，不报错（备注写长了不该让建班失败）。 */
const noteSchema = z
  .string()
  .max(512 * 4)
  .transform((value) => value.slice(0, 512))
  .optional()
  .or(z.literal(''))
  .transform((value) => value ?? '');

/** 班级名：归一化后不能为空。 */
const classNameSchema = z
  .string()
  .max(MAX_CLASS_NAME * 4)
  .transform((value) => value.trim())
  .refine((value) => value !== '', { message: '班级名不能为空' });

export const createClassSchema = z.object({
  name: classNameSchema,
  note: noteSchema,
});

export const joinClassSchema = z.object({
  code: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => isJoinCode(value), { message: '邀请码是 6 位大写字母或数字' }),
});

/** YYYY-MM-DD，且必须是真实存在的日历日。 */
const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '截止日期格式应为 YYYY-MM-DD')
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: '截止日期不存在' },
  );

/** 一个字（BMP 汉字），与保存字帖的规则一致。 */
const cjkCharSchema = z.string().regex(/^[㐀-鿿]$/, '只能是单个汉字');

const worksheetAssignmentSchema = z.object({
  title: classNameSchema,
  kind: z.literal('worksheet'),
  worksheetId: z.coerce.number().int().min(0).default(0),
  chars: z.array(cjkCharSchema).min(1).max(MAX_ASSIGNMENT_CHARS),
  dueAt: dueDateSchema.nullish(),
});

const dictationItemSchema = z.object({
  word: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value !== '', { message: '词条不能为空' }),
  pinyin: z.string().default(''),
});

const dictationAssignmentSchema = z.object({
  title: classNameSchema,
  kind: z.literal('dictation'),
  items: z.array(dictationItemSchema).min(1).max(MAX_DICTATION_ITEMS),
  dueAt: dueDateSchema.nullish(),
});

/** 派作业的请求体：两种形状，按 kind 分派。 */
export const createAssignmentSchema = z.discriminatedUnion('kind', [
  worksheetAssignmentSchema,
  dictationAssignmentSchema,
]);
