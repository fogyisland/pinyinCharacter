import { NextRequest, NextResponse } from 'next/server';
import { getClassicChunkTextBySlug } from '@/lib/classics';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { classicSlugParamSchema, chunkIndexParamSchema } from '@/lib/validators';

/**
 * Plain text of a single chapter.
 *
 * Classic books run to hundreds of thousands of characters per chapter, so
 * the detail page renders one chapter and fetches the rest on demand (the
 * audio player pulls a chapter's text from here when the user plays it).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string; index: string }> },
) {
  return withErrorHandling(async () => {
    const { slug, index: indexStr } = await ctx.params;
    const parsedSlug = classicSlugParamSchema.safeParse({ slug });
    if (!parsedSlug.success)
      return badRequest('bad_input', parsedSlug.error.issues[0]?.message ?? 'bad input');
    const parsedIndex = chunkIndexParamSchema.safeParse({ index: indexStr });
    if (!parsedIndex.success)
      return badRequest('bad_input', parsedIndex.error.issues[0]?.message ?? 'bad input');

    const text = await getClassicChunkTextBySlug(parsedSlug.data.slug, parsedIndex.data.index);
    if (text === null) return notFound('chunk_not_found', 'chunk not found');
    return NextResponse.json({ ok: true, data: { text } });
  });
}
