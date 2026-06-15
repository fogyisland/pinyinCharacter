import { NextRequest, NextResponse } from 'next/server';
import { getRandomChars } from '@/lib/chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { charsRandomQuerySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = charsRandomQuerySchema.safeParse({
      count: sp.get('count') ?? undefined,
      difficulty: sp.get('difficulty') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const chars = await getRandomChars(parsed.data);
    return NextResponse.json({ ok: true, data: { chars } });
  });
}
