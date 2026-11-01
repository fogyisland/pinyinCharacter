import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { probeCapability } from '@/lib/webfont/capability';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * The report is the state of the machine, and it changes: a package is
 * installed, a disk fills up, the upstream goes away. A browser that
 * cached the answer would keep showing a verdict that is no longer true.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

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
 * This endpoint writes no audit entry. It does touch the filesystem —
 * the disk probe puts a throw-away probe file into the gitignored
 * staging directory and deletes it again — but a one-off file in a
 * staging tree that is not part of the application is not a change to
 * the application's data, and the project audits the endpoints that
 * change data (the build, the apply, the release).
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const report = await probeCapability();

    return NextResponse.json(report, NO_STORE);
  }, NO_STORE);
}
