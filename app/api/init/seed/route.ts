import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * Step 3 of the /init wizard: **the seed**.
 *
 * ## Why this route exists
 *
 * The wizard's step 3 used to be a list of per-dataset phases — create the
 * tables, import the poems, import the characters, … — and every one of
 * them was an *import*, not a *seed*. Nothing in that list filled the
 * HSK grading, so a server that had just been initialized had 8105
 * characters with `hsk_level` NULL on every row, and the games area
 * answered `503 hsk_level_not_imported` for every tier. The error message
 * named `scripts/import-hsk.ts` as the fix, so the operator ran it — and
 * the wizard had still left the server in a state it could not reach on
 * its own.
 *
 * The seed engine (`lib/seed-runner.ts`) already knew how to fill the
 * grading; the wizard simply never called it.
 *
 * ## Why this runs after the migrations
 *
 * `chars.hsk_level` is a column added by
 * `scripts/migrations/2026-07-04-hsk-level.sql`, and the characters
 * themselves are inserted by the `init-chars` phase. The seed writes the
 * column, so it needs both: the table (phase 1) and the column (the
 * migration phase). The wizard's phase order is
 *
 *     tables → … → chars → … → migrations → **seed** → mark-complete
 *
 * which is the only order in which every step has what it needs.
 *
 * Public: only callable when setup is incomplete OR setup.route_enabled=true.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

export async function POST() {
  const result = await withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.', NO_STORE);
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).', NO_STORE);
    }
    const { runAllSeeds } = await import('@/lib/seed-runner');
    const seeds = await runAllSeeds({ dryRun: false });
    return NextResponse.json({ ok: true, data: { seeds } }, NO_STORE);
  });
  if (result instanceof NextResponse) {
    result.headers.set('Cache-Control', 'no-store');
  }
  return result;
}
