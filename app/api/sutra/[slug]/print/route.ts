import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';
import { sutraExistsBySlug, readSutraManifest } from '@/lib/sutras-fs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { slug } = await params;
    if (!slug) return badRequest('bad_slug', 'invalid slug');
    const body = await req.json().catch(() => ({}));
    const sourceId = (body?.sourceId as string) ?? '';
    if (!sourceId.startsWith(`${slug}#`)) return badRequest('bad_sourceId', 'sourceId must start with slug#');
    const chunkId = sourceId.slice(slug.length + 1);
    // Verify the sutra exists. Prefer FS (data/sutras/<slug>.json); fall back
    // to DB for legacy installs that haven't run export-sutras yet.
    let exists = sutraExistsBySlug(slug);
    if (!exists) {
      const [rows] = await getPool().query<any[]>(`SELECT 1 FROM sutras WHERE slug = ? LIMIT 1`, [slug]);
      exists = rows.length > 0;
    }
    if (!exists) return notFound('not_found', 'sutra not found');
    const manifest = readSutraManifest();
    const sutraTitle = manifest?.items.find((i) => i.slug === slug)?.title ?? null;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'sutra', sourceId,
      ip,
    });
    await logUserAction(req, auth.user.id, 'sutra_saved', {
      action: 'print',
      slug,
      title: sutraTitle,
      chunkId,
    });
    return NextResponse.json({ ok: true, data: { sourceId } });
  });
}
