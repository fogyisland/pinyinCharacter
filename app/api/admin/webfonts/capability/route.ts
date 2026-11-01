import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { probeCapability } from '@/lib/webfont/capability';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/webfonts/capability — the capability probe (design §3.4).
 *
 * The answer is the report itself, and the report sits at the TOP LEVEL
 * of the body: `{ ok, node, python, fonttools, network, disk, toolchain,
 * sources, missing }`. There is no envelope — the spec's route table names
 * the fields at the top level, and the other routes of this feature
 * answer flat as well.
 *
 * ⚠️ **`ok` is the CAPABILITY verdict, not a transport verdict.**
 * A machine that cannot build fonts yet answers `200` with `ok: false`
 * and the list of what is missing — a missing capability is not a server
 * error, and the remedy text has to reach the administrator either way.
 * ⇒ A consumer of this endpoint must branch on `data.ok` and NOT on
 * `res.ok`, and must render the report even when `ok` is false.
 *
 * This endpoint reads only: it mutates nothing, so it writes no audit
 * entry (the project audits mutating endpoints).
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const report = await probeCapability();

    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
