import { NextRequest, NextResponse } from 'next/server';
import { getSutra } from '@/lib/sutras';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { sutraIdParamSchema } from '@/lib/validators';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: idStr } = await ctx.params;
    const parsed = sutraIdParamSchema.safeParse({ id: idStr });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const sutra = await getSutra(parsed.data.id);
    if (!sutra) return notFound();
    return NextResponse.json({ ok: true, data: sutra });
  });
}
