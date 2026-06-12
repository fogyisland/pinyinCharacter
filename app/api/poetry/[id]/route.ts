import { NextRequest, NextResponse } from 'next/server';
import { getPoem } from '@/lib/poetry';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { poemIdParamSchema } from '@/lib/validators';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: idStr } = await ctx.params;
    const parsed = poemIdParamSchema.safeParse({ id: idStr });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const poem = await getPoem(parsed.data.id);
    if (!poem) return notFound();
    return NextResponse.json({ ok: true, data: poem });
  });
}
