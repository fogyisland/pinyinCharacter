import { NextRequest, NextResponse } from 'next/server';
import type { Pool } from 'mysql2/promise';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { adminGenerateCharsSchema } from '@/lib/validators';
import {
  generateMeaningZh,
  generateMeaningEn,
  generatePinyinAlt,
  generateVariants,
} from '@/lib/char-ai';
import { generateEtymologyStory } from '@/lib/char-ai';
import { generateRareCharContent } from '@/lib/ai-rare-chars';
import { withAiLogging } from '@/lib/ai-calls';

export const dynamic = 'force-dynamic';

type FieldName =
  | 'pinyin_alt'
  | 'meaning_zh'
  | 'meaning_en'
  | 'variants'
  | 'etymology_story'
  | 'rare_meaning'
  | 'rare_story';

type FieldResult = {
  generated: number;
  skipped: number;
  errors: { char: string; message: string }[];
};

function emptyResult(): FieldResult {
  return { generated: 0, skipped: 0, errors: [] };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const parsed = adminGenerateCharsSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const requested: FieldName[] = (Object.keys(parsed.data.fields) as FieldName[]).filter(
      (k) => parsed.data.fields[k as keyof typeof parsed.data.fields],
    );

    const pool = getPool();
    const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';
    const perField: Record<FieldName, FieldResult> = {
      pinyin_alt: emptyResult(),
      meaning_zh: emptyResult(),
      meaning_en: emptyResult(),
      variants: emptyResult(),
      etymology_story: emptyResult(),
      rare_meaning: emptyResult(),
      rare_story: emptyResult(),
    };

    let llmCalls = 0;
    for (const char of parsed.data.chars) {
      for (const field of requested) {
        if (llmCalls > 0) await sleep(1000);
        llmCalls++;
        try {
          const result = await generateOne(pool, auth.user.id, model, char, field);
          if (result === 'generated') perField[field].generated++;
          else perField[field].skipped++;
        } catch (err) {
          perField[field].errors.push({ char, message: (err as Error).message });
        }
      }
    }

    const totals: FieldResult = emptyResult();
    for (const r of Object.values(perField)) {
      totals.generated += r.generated;
      totals.skipped += r.skipped;
      totals.errors.push(...r.errors);
    }

    return NextResponse.json({
      ok: true,
      data: { perField, totals },
    });
  });
}

type Outcome = 'generated' | 'skipped';

async function generateOne(
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

interface DictCtx { pinyin: string; meaningZh: string | null; }

async function loadDictCtx(pool: Pool, char: string): Promise<DictCtx | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT pinyin, meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (rows.length === 0) return null;
  return { pinyin: rows[0].pinyin ?? '', meaningZh: rows[0].meaning_zh ?? null };
}

async function generateDictField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  column: 'meaning_zh' | 'meaning_en',
  run: (char: string, ctx: DictCtx) => Promise<string>,
): Promise<Outcome> {
  const ctx = await loadDictCtx(pool, char);
  if (!ctx) throw new Error('char not in chars table');
  const [existing] = await pool.query<any[]>(
    `SELECT ${column} FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (existing.length > 0 && existing[0][column] && existing[0][column].length > 0) {
    return 'skipped';
  }
  const value = await run(char, ctx);
  await pool.execute(
    `UPDATE chars SET ${column} = ? WHERE \`char\` = ?`,
    [value, char],
  );
  return 'generated';
}

async function generateDictJsonField(
  pool: Pool,
  userId: number,
  model: string,
  char: string,
  column: 'pinyin_alt' | 'variants',
  feature: string,
  run: (char: string, ctx: DictCtx) => Promise<string[]>,
): Promise<Outcome> {
  const ctx = await loadDictCtx(pool, char);
  if (!ctx) throw new Error('char not in chars table');
  const [existing] = await pool.query<any[]>(
    `SELECT ${column} FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  // Treat null as "not set"; [] is a valid empty answer from LLM, so don't overwrite it.
  if (existing.length > 0 && existing[0][column] !== null) {
    return 'skipped';
  }
  const arr = await withAiLogging(
    { userId, feature, model, metadata: { char } },
    () => run(char, ctx),
  );
  await pool.execute(
    `UPDATE chars SET ${column} = ? WHERE \`char\` = ?`,
    [JSON.stringify(arr), char],
  );
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
  const [existing] = await pool.query<any[]>(
    `SELECT story FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (existing.length > 0 && existing[0].story) return 'skipped';

  const story = await withAiLogging(
    { userId, feature: 'etymology-story', model, metadata: { char } },
    () => generateEtymologyStory({ char, pinyin: ctx.pinyin, meaningZh: ctx.meaningZh }),
  );
  await pool.execute(
    `INSERT INTO char_etymology (\`char\`, story, generated_by, generated_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE story = VALUES(story), generated_by = VALUES(generated_by), generated_at = NOW()`,
    [char, story, model],
  );
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
    `SELECT pinyin, meaning, story FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char],
  );
  if (rows.length === 0) throw new Error('char not in rare_chars table');
  const row = rows[0];
  if (row[column] && row[column].length > 0) return 'skipped';

  const content = await generateRareCharContent(
    { char, pinyin: row.pinyin },
    { fields: [column] },
  );
  await pool.execute(
    `UPDATE rare_chars SET ${column} = ? WHERE \`char\` = ?`,
    [content[column], char],
  );
  return 'generated';
}