import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, serviceUnavailable } from '@/lib/api-handler';
import { gameRoundQuerySchema } from '@/lib/validators';
import { buildRound } from '@/lib/game-round';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = gameRoundQuerySchema.safeParse({
      count: sp.get('count') ?? undefined,
      seed: sp.get('seed') ?? undefined,
      source: sp.get('source') ?? undefined,
    });
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const payload = await buildRound(parsed.data.count, parsed.data.seed, parsed.data.source);
    if (!payload) {
      return serviceUnavailable(
        'no_chars',
        'not enough rare chars with radicals to build a round',
      );
    }
    return NextResponse.json({ ok: true, data: payload });
  });
}