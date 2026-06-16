import type { Pool } from 'mysql2/promise';
import {
  generateMeaningZh,
  generateMeaningEn,
  generatePinyinAlt,
  generateVariants,
  generateEtymologyStory,
} from './char-ai';
import { generateRareCharContent } from './ai-rare-chars';
import { withAiLogging } from './ai-calls';
import { readContentFromFs, writeContent } from './content';
import type { CharContent } from '@/scripts/schemas/content';

export type FieldName =
  | 'pinyin_alt'
  | 'meaning_zh'
  | 'meaning_en'
  | 'variants'
  | 'etymology_story'
  | 'rare_meaning'
  | 'rare_story';

export type FieldResult = {
  generated: number;
  skipped: number;
  errors: { char: string; message: string }[];
};

export const ALL_FIELDS: readonly FieldName[] = [
  'pinyin_alt',
  'meaning_zh',
  'meaning_en',
  'variants',
  'etymology_story',
  'rare_meaning',
  'rare_story',
] as const;

export type Outcome = 'generated' | 'skipped';

export function emptyPerField(): Record<FieldName, FieldResult> {
  return {
    pinyin_alt: { generated: 0, skipped: 0, errors: [] },
    meaning_zh: { generated: 0, skipped: 0, errors: [] },
    meaning_en: { generated: 0, skipped: 0, errors: [] },
    variants: { generated: 0, skipped: 0, errors: [] },
    etymology_story: { generated: 0, skipped: 0, errors: [] },
    rare_meaning: { generated: 0, skipped: 0, errors: [] },
    rare_story: { generated: 0, skipped: 0, errors: [] },
  };
}

interface DictCtx { pinyin: string; meaningZh: string | null; }

async function loadDictCtx(pool: Pool, char: string): Promise<DictCtx | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT pinyin FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (rows.length === 0) return null;
  // meaningZh may live in either the chars row (legacy DB) or the JSON file.
  // Prefer JSON since it's the source of truth post-migration.
  const content = readContentFromFs(char);
  const meaningZh =
    content?.dict?.meaning_zh ??
    content?.meaning_zh ??
    (await loadDbMeaningZh(pool, char));
  return { pinyin: rows[0].pinyin ?? '', meaningZh };
}

async function loadDbMeaningZh(pool: Pool, char: string): Promise<string | null> {
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
      [char],
    );
    return rows[0]?.meaning_zh ?? null;
  } catch {
    // column may have been dropped — fall through
    return null;
  }
}

function hasDictField(content: CharContent | null, field: 'meaning_zh' | 'meaning_en' | 'pinyin_alt' | 'variants'): boolean {
  if (!content) return false;
  if (field === 'meaning_zh') {
    return !!(content.dict?.meaning_zh ?? content.meaning_zh);
  }
  if (field === 'meaning_en') return !!content.dict?.meaning_en;
  if (field === 'pinyin_alt') return !!content.dict?.pinyin_alt;
  if (field === 'variants') return !!content.dict?.variants;
  return false;
}

export async function processOneField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  field: FieldName,
): Promise<Outcome> {
  switch (field) {
    case 'meaning_zh':
      return generateDictField(pool, userId, model, char, 'meaning_zh', async (char, ctx) => {
        const text = await withAiLogging(
          { userId, feature: 'char-meaning-zh', model, metadata: { char } },
          () => generateMeaningZh({ char, pinyin: ctx.pinyin }),
        );
        return text;
      });
    case 'meaning_en':
      return generateDictField(pool, userId, model, char, 'meaning_en', async (char, ctx) => {
        const text = await withAiLogging(
          { userId, feature: 'char-meaning-en', model, metadata: { char } },
          () => generateMeaningEn({ char, pinyin: ctx.pinyin, meaningZh: ctx.meaningZh }),
        );
        return text;
      });
    case 'pinyin_alt':
      return generateDictJsonField(
        pool, userId, model, char, 'pinyin_alt', 'char-pinyin-alt',
        async (char, ctx) => generatePinyinAlt({ char, pinyin: ctx.pinyin }),
      );
    case 'variants':
      return generateDictJsonField(
        pool, userId, model, char, 'variants', 'char-variants',
        async (char, ctx) => generateVariants({ char, pinyin: ctx.pinyin, meaningZh: ctx.meaningZh }),
      );
    case 'etymology_story':
      return generateEtymologyField(pool, userId, model, char);
    case 'rare_meaning':
      return generateRareField(pool, userId, model, char, 'meaning');
    case 'rare_story':
      return generateRareField(pool, userId, model, char, 'story');
  }
}

async function generateDictField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  field: 'meaning_zh' | 'meaning_en',
  run: (char: string, ctx: DictCtx) => Promise<string>,
): Promise<Outcome> {
  const ctx = await loadDictCtx(pool, char);
  if (!ctx) throw new Error('char not in chars table');
  const existing = readContentFromFs(char);
  if (hasDictField(existing, field)) return 'skipped';
  const value = await run(char, ctx);
  // Build the new content shape — preserve everything else from the existing
  // file (pinyin/level/other dict fields/etymology/rare/hanzi_story).
  const dict = { ...(existing?.dict ?? {}) };
  if (field === 'meaning_zh') dict.meaning_zh = value;
  if (field === 'meaning_en') dict.meaning_en = value;
  writeContent(char, {
    char,
    pinyin: existing?.pinyin ?? ctx.pinyin,
    level: existing?.level,
    dict,
    etymology: existing?.etymology,
    rare: existing?.rare,
    hanzi_story: existing?.hanzi_story,
  }, { merge: true });
  return 'generated';
}

async function generateDictJsonField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  field: 'pinyin_alt' | 'variants',
  feature: string,
  run: (char: string, ctx: DictCtx) => Promise<string[]>,
): Promise<Outcome> {
  const ctx = await loadDictCtx(pool, char);
  if (!ctx) throw new Error('char not in chars table');
  const existing = readContentFromFs(char);
  // Treat absence as "not set"; [] is a valid LLM answer (no variants), so once
  // the field is written we don't overwrite it on re-run.
  if (hasDictField(existing, field)) return 'skipped';
  const arr = await withAiLogging(
    { userId, feature, model, metadata: { char } },
    () => run(char, ctx),
  );
  const dict = { ...(existing?.dict ?? {}) };
  if (field === 'pinyin_alt') dict.pinyin_alt = arr;
  if (field === 'variants') dict.variants = arr;
  writeContent(char, {
    char,
    pinyin: existing?.pinyin ?? ctx.pinyin,
    level: existing?.level,
    dict,
    etymology: existing?.etymology,
    rare: existing?.rare,
    hanzi_story: existing?.hanzi_story,
  }, { merge: true });
  return 'generated';
}

async function generateEtymologyField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
): Promise<Outcome> {
  const ctx = await loadDictCtx(pool, char);
  if (!ctx) throw new Error('char not in chars table');
  const existing = readContentFromFs(char);
  if (existing?.etymology?.story) return 'skipped';

  const story = await withAiLogging(
    { userId, feature: 'etymology-story', model, metadata: { char } },
    () => generateEtymologyStory({ char, pinyin: ctx.pinyin, meaningZh: ctx.meaningZh }),
  );
  writeContent(char, {
    char,
    pinyin: existing?.pinyin ?? ctx.pinyin,
    level: existing?.level,
    dict: existing?.dict,
    etymology: {
      story,
      generated_by: model,
      generated_at: new Date().toISOString(),
      ...(existing?.etymology ?? {}),
    },
    rare: existing?.rare,
    hanzi_story: existing?.hanzi_story,
  }, { merge: true });
  return 'generated';
}

async function generateRareField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  column: 'meaning' | 'story',
): Promise<Outcome> {
  const [rows] = await pool.query<any[]>(
    `SELECT pinyin FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (rows.length === 0) throw new Error('char not in rare_chars table');
  const pinyin = rows[0].pinyin;
  const existing = readContentFromFs(char);
  if (column === 'meaning' && existing?.rare?.meaning) return 'skipped';
  if (column === 'story' && existing?.rare?.story) return 'skipped';

  const content = await generateRareCharContent(
    { char, pinyin },
    { fields: [column] },
  );
  const rare = { ...(existing?.rare ?? {}), generated_by: model, generated_at: new Date().toISOString() };
  if (column === 'meaning') rare.meaning = content.meaning;
  if (column === 'story') rare.story = content.story;
  writeContent(char, {
    char,
    pinyin: existing?.pinyin ?? pinyin,
    level: existing?.level,
    dict: existing?.dict,
    etymology: existing?.etymology,
    rare,
    hanzi_story: existing?.hanzi_story,
  }, { merge: true });
  return 'generated';
}