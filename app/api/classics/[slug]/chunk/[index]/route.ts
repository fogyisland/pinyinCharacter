import { NextRequest, NextResponse } from 'next/server';
import { getClassicChapterPayload } from '@/lib/classics';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { classicSlugParamSchema, chunkIndexParamSchema } from '@/lib/validators';

/**
 * A single chapter: its text lines, its label and the book's chapter count.
 *
 * Classic books run to hundreds of thousands of characters per chapter, so
 * the detail page renders one chapter and fetches the rest on demand (the
 * audio player pulls a chapter's text from here when the user plays it, the
 * worksheet generator pulls the chapter it is about to typeset).
 *
 * The per-character pinyin is deliberately not part of the response: it is
 * the larger half of a chapter's JSON and the reading view renders it
 * server-side.
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

    const chapter = await getClassicChapterPayload(
      parsedSlug.data.slug,
      parsedIndex.data.index,
    );
    if (chapter === null) return notFound('chunk_not_found', 'chunk not found');
    return NextResponse.json({ ok: true, data: chapter });
  });
}
