import { NextRequest, NextResponse } from 'next/server';
import { getSutraChunkText } from '@/lib/sutras';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { sutraIdParamSchema, chunkIndexParamSchema } from '@/lib/validators';

/**
 * Plain text of a single chapter.
 *
 * Detail pages render one chapter but used to inline every chapter's text
 * into the RSC payload (a sutra with long chapters shipped hundreds of KB
 * that the browser never displayed). The audio player fetches a chapter's
 * text from here on demand.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; index: string }> },
) {
  return withErrorHandling(async () => {
    const { id: idStr, index: indexStr } = await ctx.params;
    const parsedId = sutraIdParamSchema.safeParse({ id: idStr });
    if (!parsedId.success)
      return badRequest('bad_input', parsedId.error.issues[0]?.message ?? 'bad input');
    const parsedIndex = chunkIndexParamSchema.safeParse({ index: indexStr });
    if (!parsedIndex.success)
      return badRequest('bad_input', parsedIndex.error.issues[0]?.message ?? 'bad input');

    const text = await getSutraChunkText(parsedId.data.id, parsedIndex.data.index);
    if (text === null) return notFound('chunk_not_found', 'chunk not found');
    return NextResponse.json({ ok: true, data: { text } });
  });
}
