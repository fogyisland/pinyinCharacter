import { z } from 'zod';

/**
 * Schema for data/content/<char>.json — one file per char, all generated
 * content aggregated from chars / char_etymology / char_story / rare_chars.
 *
 * Two shapes are accepted for backwards compat with the 30 hand-written
 * files in data/content/ (legacy top-level fields) and the new export:
 *
 *   1) Legacy (30 hand-written files):
 *      { char, pinyin, meaning_zh, etymology_story?, hanzi_story? }
 *
 *   2) Full export (covers all 7 LLM-generated fields):
 *      { char, pinyin, level?,
 *        dict?: { meaning_zh, meaning_en, pinyin_alt, variants },
 *        etymology?: { story, generated_by, generated_at },
 *        rare?: { meaning, story, generated_by, generated_at },
 *        hanzi_story?, generated_by?, generated_at? }
 *
 * Both shapes round-trip: legacy files validate, export writes the full
 * shape. After Task 55 (chars-table shrink), the full shape becomes the
 * single source of truth and legacy fields can be removed.
 */
export const CharContentSchema = z.object({
  char: z.string().length(1),
  pinyin: z.string().min(1),
  level: z.number().int().min(1).max(4).optional(),

  // Legacy top-level fields (kept for the 30 hand-written files).
  meaning_zh: z.string().min(1).optional(),
  etymology_story: z.string().min(1).optional(),
  hanzi_story: z.string().min(1).optional(),

  // Full content blocks written by export-content / content-sync.
  dict: z
    .object({
      meaning_zh: z.string().optional(),
      meaning_en: z.string().optional(),
      pinyin_alt: z.array(z.string()).optional(),
      variants: z.array(z.string()).optional(),
    })
    .optional(),
  etymology: z
    .object({
      story: z.string().optional(),
      generated_by: z.string().optional(),
      generated_at: z.string().datetime().optional(),
    })
    .optional(),
  rare: z
    .object({
      meaning: z.string().optional(),
      story: z.string().optional(),
      generated_by: z.string().optional(),
      generated_at: z.string().datetime().optional(),
    })
    .optional(),

  // Provenance at top level for quick inspection.
  generated_by: z.string().optional(),
  generated_at: z.string().datetime().optional(),
});

export type CharContent = z.infer<typeof CharContentSchema>;

export const ContentManifestSchema = z.object({
  version: z.literal(1),
  totalChars: z.literal(8105),
  byField: z.object({
    meaning_zh: z.number().int().min(0).max(8105),
    meaning_en: z.number().int().min(0).max(8105),
    pinyin_alt: z.number().int().min(0).max(8105),
    variants: z.number().int().min(0).max(8105),
    etymology_story: z.number().int().min(0).max(6498),
    hanzi_story: z.number().int().min(0).max(1607),
    rare_meaning: z.number().int().min(0).max(1412),
    rare_story: z.number().int().min(0).max(1412),
  }),
  generatedAt: z.string().datetime(),
});

export type ContentManifest = z.infer<typeof ContentManifestSchema>;
