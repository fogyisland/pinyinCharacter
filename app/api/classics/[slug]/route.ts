import { NextRequest, NextResponse } from 'next/server';
import { getClassicBySlug } from '@/lib/classics';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { classicSlugParamSchema } from '@/lib/validators';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const { slug } = await ctx.params;
    const parsed = classicSlugParamSchema.safeParse({ slug });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const c = await getClassicBySlug(parsed.data.slug);
    if (!c) return notFound();
    return NextResponse.json({ ok: true, data: c });
  });
}
