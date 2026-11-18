import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getClassicMetaBySlug } from '@/lib/classics';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';
import { classicSlugParamSchema } from '@/lib/validators';

/**
 * Records that the reader printed a chapter of a classic.
 *
 * The classic detail page prints the browser's own view of the chapter —
 * there is no server-side PDF here, the same as for the poems and the
 * sutras. What this endpoint does is the part the browser cannot do for
 * itself: write the download row and the audit entry, so the admin can
 * see who printed what, and so the action is attributable.
 *
 * The book's existence is checked through the MANIFEST, not by reading the
 * book file: a classic runs to up to 8 MB of JSON and the manifest answers
 * "does this book exist" in a few KB.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { slug: rawSlug } = await ctx.params;
    const parsed = classicSlugParamSchema.safeParse({ slug: rawSlug });
    if (!parsed.success)
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const slug = parsed.data.slug;

    const meta = await getClassicMetaBySlug(slug);
    if (!meta) return notFound('not_found', 'classic not found');

    // The chapter is only recorded, not validated: the page prints the
    // chapter it is showing, and the chapter label is carried in the
    // metadata for the audit trail. A chapter id that does not exist
    // cannot reach this endpoint, because the page would have 404'd first.
    const body: unknown = await req.json().catch(() => ({}));
    const sourceId =
      typeof body === 'object' && body !== null
        ? String((body as Record<string, unknown>).sourceId ?? `${slug}#${meta.chunkCount}`)
        : `${slug}#${meta.chunkCount}`;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;

    await logDownload({
      userId: auth.user.id,
      format: 'print',
      sourceType: 'classic',
      sourceId,
      ip,
      userAgent,
    });
    await logUserAction(req, auth.user.id, 'classic_saved', {
      action: 'print',
      slug,
      title: meta.title,
    });

    return NextResponse.json({ ok: true, data: { sourceId } });
  });
}
