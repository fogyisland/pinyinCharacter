import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { questQuerySchema } from '@/lib/validators';
import { getQuestTier } from '@/lib/game-quest-data';
import { buildLevel } from '@/lib/game-quest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/game/quest?hsk=N&level=M
 *
 * Returns the level's chars with their four option sets:
 *   { ok: true, data: QuestLevelPayload }
 *
 * A level beyond the tier's level count is a 404 (`level_not_found`), not a
 * 400 — the query itself was well formed.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = questQuerySchema.safeParse({
      hsk: sp.get('hsk') ?? undefined,
      level: sp.get('level') ?? undefined,
    });
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const { hsk, level } = parsed.data;
    const tier = await getQuestTier(hsk);
    const payload = buildLevel(tier, level);
    if (!payload) {
      return notFound('level_not_found', `level ${level} is beyond HSK ${hsk}`);
    }
    return NextResponse.json(
      { ok: true, data: payload },
      {
        headers: {
          // 2026-10-25: per feedback-cache-control-route-iterations.md, new
          // routes default to no-store in dev so iteration doesn't get masked
          // by the browser's HTTP cache.
          'Cache-Control': 'no-store',
        },
      },
    );
  });
}
