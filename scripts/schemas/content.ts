import { z } from 'zod';

export const CharContentSchema = z.object({
  char: z.string().length(1),
  pinyin: z.string().min(1),
  meaning_zh: z.string().min(1).optional(),
  etymology_story: z.string().min(140).max(220).optional(),
  hanzi_story: z.string().min(15).max(80).optional(),
});

export type CharContent = z.infer<typeof CharContentSchema>;

export const ContentManifestSchema = z.object({
  version: z.literal(1),
  totalChars: z.literal(8105),
  byField: z.object({
    meaning_zh: z.number().int().min(0).max(8105),
    etymology_story: z.number().int().min(0).max(6498),
    hanzi_story: z.number().int().min(0).max(1607),
  }),
  generatedAt: z.string().datetime(),
});

export type ContentManifest = z.infer<typeof ContentManifestSchema>;