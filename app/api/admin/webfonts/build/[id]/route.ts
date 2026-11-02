import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getJob } from '@/lib/webfont/jobs';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * The job is live state: its status and its log move while the
 * administrator is looking at it. A cached answer would show a job that
 * has already finished as still running.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * GET /api/admin/webfonts/build/[id] — one job (design §5).
 *
 * The `job` in the answer is the WHOLE job object, log included: the
 * admin page renders the transcript out of it and polls this route while
 * the build runs.
 *
 * This route writes no audit entry — a read is not a change.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const { id } = await params;
    const job = await getJob(id);
    if (!job) {
      return notFound('not_found', '找不到这个构建作业', NO_STORE);
    }

    return NextResponse.json({ ok: true, job }, NO_STORE);
  }, NO_STORE);
}
