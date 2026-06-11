import { z } from 'zod';

const SINGLE_CJK = /^[一-鿿]$/;

export const searchQuerySchema = z.object({
  q: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const worksheetIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const charParamSchema = z.object({
  char: z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
    message: 'must be a single CJK char',
  }),
});

export const saveWorksheetSchema = z.object({
  title: z.string().min(1).max(80),
  content: z
    .array(z.string().regex(SINGLE_CJK))
    .min(1)
    .max(500),
  cellStyle: z.enum(['brush', 'square']),
});
