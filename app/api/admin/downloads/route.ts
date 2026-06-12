import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listDownloads } from '@/lib/admin-downloads';
import type { DownloadSourceType } from '@/lib/downloads';

const VALID_SOURCE_TYPES: DownloadSourceType[] = ['worksheet', 'poem', 'sutra', 'rare-char-card'];

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;

    const sourceTypeRaw = sp.get('sourceType');
    let sourceType: DownloadSourceType | undefined;
    if (sourceTypeRaw) {
      if (!VALID_SOURCE_TYPES.includes(sourceTypeRaw as DownloadSourceType)) {
        return badRequest('bad_source_type', `sourceType must be one of ${VALID_SOURCE_TYPES.join('|')}`);
      }
      sourceType = sourceTypeRaw as DownloadSourceType;
    }

    const result = await listDownloads({
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      sourceType,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}