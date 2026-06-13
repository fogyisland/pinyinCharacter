import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { adminGenerateEtymologySchema } from '@/lib/validators';
import { generateEtymologyStory } from '@/lib/char-ai';
import { withAiLogging } from '@/lib/ai-calls';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const parsed = adminGenerateEtymologySchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const pool = getPool();
    let generated = 0;
    let skipped = 0;
    const errors: { char: string; message: string }[] = [];
    const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

    for (const char of parsed.data.chars) {
      // check if already has story
      const [existing] = await pool.query<any[]>(
        `SELECT story FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
        [char]
      );
      if (existing.length > 0 && existing[0].story) {
        skipped++;
        continue;
      }

      // fetch char metadata for the LLM prompt
      const [charRows] = await pool.query<any[]>(
        `SELECT pinyin, meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
        [char]
      );
      if (charRows.length === 0) {
        errors.push({ char, message: 'char not in chars table' });
        continue;
      }

      try {
        const story = await withAiLogging(
          {
            userId: auth.user.id,
            feature: 'etymology-story',
            model,
            metadata: { char },
          },
          () => generateEtymologyStory({
            char,
            pinyin: charRows[0].pinyin ?? '',
            meaningZh: charRows[0].meaning_zh,
          })
        );

        // upsert
        await pool.execute(
          `INSERT INTO char_etymology (\`char\`, story, generated_by, generated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE story = VALUES(story), generated_by = VALUES(generated_by), generated_at = NOW()`,
          [char, story, model]
        );
        generated++;
      } catch (err) {
        errors.push({ char, message: (err as Error).message });
      }
    }

    return NextResponse.json({ ok: true, data: { generated, skipped, errors } });
  });
}
