import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorized, forbidden } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { hasFeature } from '@/lib/membership';
import { explainChar } from '@/lib/char-ai';
import { getPool } from '@/lib/db';
import { logAiCall } from '@/lib/ai-calls';

const Schema = z.object({ char: z.string().length(1) });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    if (!await hasFeature(user.id, 'ai_calls')) {
      return forbidden('membership_required', '需要 AI 调用会员');
    }
    const [rows] = await getPool().query<any[]>(
      `SELECT pinyin FROM chars WHERE \`char\` = ? LIMIT 1`, [parsed.data.char],
    );
    if (rows.length === 0) return badRequest('char_not_found', 'char not in dictionary');
    const pinyin = String(rows[0].pinyin);

    const start = Date.now();
    try {
      const explanation = await explainChar({ char: parsed.data.char, pinyin });
      await logAiCall({
        userId: user.id, feature: 'char-explain', model: 'unknown', status: 'ok',
        durationMs: Date.now() - start, metadata: { char: parsed.data.char },
      });
      return NextResponse.json({ ok: true, data: { explanation } });
    } catch (err) {
      await logAiCall({
        userId: user.id, feature: 'char-explain', model: 'unknown', status: 'error',
        durationMs: Date.now() - start, error: (err as Error).message,
        metadata: { char: parsed.data.char },
      });
      throw err;
    }
  });
}
