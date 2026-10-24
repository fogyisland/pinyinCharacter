import { NextRequest, NextResponse } from 'next/server';
import { getClassicOutlineBySlug } from '@/lib/classics';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { classicSlugParamSchema } from '@/lib/validators';

/**
 * A book's outline: metadata plus the chapter list.
 *
 * This used to answer with the whole book — every chapter's text and
 * pinyin, up to 8 MB of JSON for the largest classics. The chapter text is
 * served per chapter by /api/classics/[slug]/chunk/[index].
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const { slug } = await ctx.params;
    const parsed = classicSlugParamSchema.safeParse({ slug });
    if (!parsed.success)
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const outline = await getClassicOutlineBySlug(parsed.data.slug);
    if (!outline) return notFound();
    return NextResponse.json({ ok: true, data: outline });
  });
}
