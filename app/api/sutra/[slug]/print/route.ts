import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { writeAudit } from '@/lib/audit';

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
    // Verify the sutra exists (chunkId is informational; we don't validate against chunks table)
    const [rows] = await getPool().query<any[]>(`SELECT 1 FROM sutras WHERE slug = ? LIMIT 1`, [slug]);
    if (rows.length === 0) return notFound('not_found', 'sutra not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'sutra', sourceId,
      ip,
    });
    await writeAudit({ userId: auth.user.id, event: 'sutra_saved', metadata: { action: 'print', sutraSlug: slug, chunkId }, ip, userAgent: ua });
    return NextResponse.json({ ok: true, data: { sourceId } });
  });
}
