import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, serviceUnavailable } from '@/lib/api-handler';
import { gameRoundQuerySchema } from '@/lib/validators';
import { buildRound } from '@/lib/game-round';
import { getRevealConfig, type GameMode } from '@/lib/reveal';
import type { HskLevel } from '@/lib/difficulty';

export const dynamic = 'force-dynamic';

// 2026-07-04: Map the per-round mode (tone/radical/pinyin) to the
// GameMode that reveal config uses. tone-radical covers tone + radical;
// drag-match covers pinyin (DragMatchGame uses /api/chars directly — see
// app/api/chars/route.ts). Chain is a separate endpoint.
const gameModeKeyForMode: Record<'tone' | 'radical' | 'pinyin', GameMode> = {
  tone: 'tone-radical',
  radical: 'tone-radical',
  pinyin: 'drag-match',
};

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = gameRoundQuerySchema.safeParse({
      count: sp.get('count') ?? undefined,
      seed: sp.get('seed') ?? undefined,
      source: sp.get('source') ?? undefined,
      mode: sp.get('mode') ?? undefined,
      hskLevel: sp.get('hskLevel') ?? undefined,
    });
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const { count, seed, source, mode: modeOverride, hskLevel } = parsed.data;
    const result = await buildRound(count, seed, source, (hskLevel ?? null) as HskLevel | null);
    if (!result) {
      return serviceUnavailable(
        'no_chars',
        'not enough rare chars with radicals to build a round',
      );
    }
    const { round, hskFallback, hskLevel: appliedHskLevel } = result;
    // 2026-07-04: embed revealConfig so progressive-reveal clients can
    // render hints per HSK level. Use modeOverride when present (Tasks
    // 8/9/10 always pass `mode`); otherwise fall back to the mode that
    // buildRound randomly picked (legacy behavior — still embed config
    // so the client can show hints per HSK level).
    const modeForReveal = modeOverride ?? round.mode;
    const levelForReveal = (appliedHskLevel ?? hskLevel ?? 1) as HskLevel;
    const revealConfig = getRevealConfig(gameModeKeyForMode[modeForReveal], levelForReveal);
    return NextResponse.json(
      { ok: true, data: round, revealConfig, hskFallback, hskLevel: appliedHskLevel },
      {
        headers: {
          // 2026-07-04: per feedback-cache-control-route-iterations.md,
          // new routes default to no-store in dev so iteration doesn't
          // get masked by browser HTTP cache.
          'Cache-Control': 'no-store',
        },
      },
    );
  });
}