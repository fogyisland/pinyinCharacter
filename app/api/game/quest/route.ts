import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { questQuerySchema } from '@/lib/validators';
import { getQuestTier } from '@/lib/game-quest-data';
import { buildLevel } from '@/lib/game-quest';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * A 404 here is not permanent: `level_not_found` means "level N is beyond the
 * tier's current level count". The tier is built once per server process, so
 * the eligible pool grows when the content files are regenerated **and the
 * server restarts** — a level that 404s today can be a valid level after
 * that. A browser that cached the 404 would keep serving it after the tier
 * grew.
 */
const NO_STORE: ResponseInit = {
  headers: {
    // 2026-10-25: per feedback-cache-control-route-iterations.md, new
    // routes default to no-store in dev so iteration doesn't get masked
    // by the browser's HTTP cache.
    'Cache-Control': 'no-store',
  },
};

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
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input', NO_STORE);
    }
    const { hsk, level } = parsed.data;
    const tier = await getQuestTier(hsk);
    const payload = buildLevel(tier, level);
    if (!payload) {
      return notFound('level_not_found', `level ${level} is beyond HSK ${hsk}`, NO_STORE);
    }
    return NextResponse.json({ ok: true, data: payload }, NO_STORE);
  }, NO_STORE);
}
