import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import {
  readReleases,
  planCleanup,
  releaseBytesOnDisk,
  RETENTION_DAYS,
  KEEP_RECENT,
} from '@/lib/webfont/releases';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * The ledger is the state of the machine, and it changes: a release is
 * published, a release is cleaned. A browser that cached the answer would
 * keep showing a release that is no longer on disk.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * GET /api/admin/webfonts/releases — the release ledger (design §4.1).
 *
 * The answer is the report itself, and it sits at the TOP LEVEL of the
 * body: `{ ok, releases, bytes, keep }`. There is no envelope — the spec's
 * route table names the fields at the top level, and the other routes of
 * this feature answer flat as well.
 *
 * ⚠️ **`ok` is the TRANSPORT verdict, not a capability verdict.**
 * It says "the request succeeded" — NOT "the machine can build fonts".
 * The capability probe (`/api/admin/webfonts/capability`) is the route
 * whose `ok` means "the machine is able". The two must not be confused.
 *
 * ⚠️ **`canClean` is DERIVED, and never stored.**
 * The ledger on disk keeps exactly the shape design §4.1 pins — there is
 * no `canClean` field in `releases.json`. A release that is not cleanable
 * today becomes cleanable in 31 days, so writing the verdict to disk would
 * freeze a stale answer. The route computes the cleanup plan ONCE and uses
 * it both for the verdict and for the listing, so the 「可否清理」 column
 * and the cleanup button can never disagree.
 *
 * This endpoint writes no audit entry: it changes nothing.
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const now = new Date();
    const releases = readReleases();
    const plan = planCleanup(now);
    const cleanable = new Set(plan.map((release) => release.dir));

    return NextResponse.json(
      {
        ok: true,
        releases: releases.map((release) => ({
          ...release,
          canClean: cleanable.has(release.dir),
        })),
        bytes: releaseBytesOnDisk(),
        keep: `保留最近 ${KEEP_RECENT} 份，且被取代超过 ${RETENTION_DAYS} 天的 release 不删除`,
      },
      NO_STORE,
    );
  }, NO_STORE);
}
