import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listUnifiedLogs, type UnifiedLogSource } from '@/lib/admin-logs';

const VALID_SOURCES: UnifiedLogSource[] = ['audit', 'download', 'ai_call'];

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;

    const sourceRaw = sp.get('source');
    let source: UnifiedLogSource | undefined;
    if (sourceRaw) {
      if (!VALID_SOURCES.includes(sourceRaw as UnifiedLogSource)) {
        return badRequest('bad_source', `source must be one of ${VALID_SOURCES.join('|')}`);
      }
      source = sourceRaw as UnifiedLogSource;
    }

    const result = await listUnifiedLogs({
      source,
      type: sp.get('type') ?? undefined,
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      ip: sp.get('ip') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}