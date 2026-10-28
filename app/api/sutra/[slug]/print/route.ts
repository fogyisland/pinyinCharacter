import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';
import { sutraExistsBySlug, readSutraManifest } from '@/lib/sutras-fs';

/** `SELECT 1` — the column name MySQL gives the literal is `1`. */
interface ExistsRow extends RowDataPacket {
  '1': number;
}

/** Read a single field off an untrusted (JSON) request body. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { slug } = await params;
    if (!slug) return badRequest('bad_slug', 'invalid slug');
    const body: unknown = await req.json().catch(() => ({}));
    // `sourceId` is cast, not validated: the original code took whatever the
    // client sent and only rejected it via `startsWith`. Keep that behaviour.
    const sourceId = (readField(body, 'sourceId') as string | undefined) ?? '';
    if (!sourceId.startsWith(`${slug}#`))
      return badRequest('bad_sourceId', 'sourceId must start with slug#');
    const chunkId = sourceId.slice(slug.length + 1);
    // Verify the sutra exists. Prefer FS (data/sutras/<slug>.json); fall back
    // to DB for legacy installs that haven't run export-sutras yet.
    let exists = sutraExistsBySlug(slug);
    if (!exists) {
      const [rows] = await getPool().query<ExistsRow[]>(
        `SELECT 1 FROM sutras WHERE slug = ? LIMIT 1`,
        [slug],
      );
      exists = rows.length > 0;
    }
    if (!exists) return notFound('not_found', 'sutra not found');
    const manifest = readSutraManifest();
    const sutraTitle = manifest?.items.find((i) => i.slug === slug)?.title ?? null;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id,
      format: 'print',
      sourceType: 'sutra',
      sourceId,
      ip,
      userAgent,
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
