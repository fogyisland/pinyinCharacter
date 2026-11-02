import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, conflict } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import {
  readReleases,
  writeReleases,
  planCleanup,
  removeReleaseDirs,
} from '@/lib/webfont/releases';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * A cleanup changes the disk, and the ledger it writes is read back by the
 * GET route. A cached 409 ("nothing to clean") would send the
 * administrator away from a button that would now work.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * The cleanup takes NO parameters.
 *
 * ⚠️ The schema is strict: an unknown field is a 400, not a shrug. A
 * typo in a field name would otherwise mean "the caller thinks it asked
 * for something specific and the server did something else".
 */
const CleanupSchema = z.object({}).strict();

/**
 * POST /api/admin/webfonts/releases/cleanup — the explicit cleanup action
 * (design §4.2).
 *
 * ⚠️ This is a SEPARATE, EXPLICIT action on purpose. Applying a build
 * NEVER deletes anything: deletion is irreversible, and an apply is not
 * the moment to ask for consent.
 *
 * The rule (design §3.5.4): a release directory may be deleted only when
 * it is NOT among the three most recent (ranked by the directory's mtime
 * on disk) AND it was superseded more than 30 days ago. The clock is the
 * **superseded** time, never the creation time.
 *
 * ⚠️ **The body may be EMPTY.** A "no parameters" button sends nothing,
 * and `req.json()` on an empty body throws ⇒ the body is read
 * defensively and an empty body is treated as `{}`.
 *
 * ⚠️ **The backend never runs git** (design §9, rule 5). The copy of the
 * same directories in the repository has to be removed by the
 * administrator with `git rm -r` — the response says so explicitly, so
 * both sides can be brought back into agreement in one commit.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const body = await readBody(req);
    const parsed = CleanupSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', '清理请求不接受任何参数', NO_STORE);
    }

    const now = new Date();
    const plan = planCleanup(now);
    if (plan.length === 0) {
      return conflict('nothing_to_clean', '没有可清理的 release', NO_STORE);
    }

    const removed = removeReleaseDirs(plan.map((release) => release.dir));
    const removedDirs = removed.filter((entry) => entry.removed).map((entry) => entry.dir);
    const removedBytes = removed.reduce((sum, entry) => sum + entry.bytes, 0);

    // Only the cleaned entries get a `deletedAt`; every other record stays
    // byte-identical — the ledger is a HISTORY, not a listing of what
    // currently exists on disk.
    //
    // ⚠️ Only the directories that were REALLY deleted get a `deletedAt`.
    // A planned release whose directory was already gone (removed by
    // hand, or by a cleanup that died before it could write the ledger)
    // is reported in `removed[]` with `removed: false` — it was NOT
    // deleted by this cleanup, and stamping it would make the response
    // ("removed: false") contradict the ledger ("deletedAt: <now>").
    // Such a row stays unstamped and may be planned again later; that is
    // what design §3.5.4 wants (a missing directory cannot be ranked, so
    // it is never among the kept three).
    const releases = readReleases();
    const deletedDirSet = new Set(removedDirs);
    // The PLAN — what this cleanup set out to remove, whether or not the
    // directory was still there. `kept` is derived from it, so that
    // `removed[]` and `kept[]` never overlap.
    const cleanedDirs = plan.map((release) => release.dir);
    const cleanedAt = now.toISOString();
    const updated = releases.map((release) =>
      deletedDirSet.has(release.dir) ? { ...release, deletedAt: cleanedAt } : release,
    );
    writeReleases(updated);

    // The hint is a TODO for the administrator: "the repository's copies
    // have to be `git rm -r`'d too". With zero directories there is no
    // todo ⇒ the field must NOT EXIST (not be `null`, not be an empty
    // string) — otherwise the audit row carries the broken sentence
    // "仓库里那 0 份也要 git rm -r（）" forever, because this metadata is
    // persisted.
    const repoHint =
      removedDirs.length > 0
        ? `仓库里那 ${removedDirs.length} 份也要 git rm -r（${removedDirs.join(' ')}）`
        : undefined;

    await writeAudit({
      userId: auth.user.id,
      event: 'admin_webfont_releases_cleaned',
      metadata: {
        title: `清理了 ${removedDirs.length} 个 release`,
        removed: removedDirs,
        count: removedDirs.length,
        bytes: removedBytes,
        ...(repoHint ? { repoHint } : {}),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        removed: removed.map((entry) => ({
          dir: entry.dir,
          bytes: entry.bytes,
          removed: entry.removed,
        })),
        // Everything the cleanup did NOT touch: the current release, the
        // two kept predecessors, and anything still inside the 30-day
        // window.
        //
        // ⚠️ `kept` is computed from the PLAN, not from the directories
        // that were really deleted: a planned release whose directory was
        // already gone was still "touched" by this cleanup, it just had
        // nothing left to delete. Computing it from the deleted set
        // instead would put that directory into `removed[]` AND `kept[]`
        // at the same time — and a release has to end up in exactly one
        // of the two.
        kept: releases
          .filter((release) => !cleanedDirs.includes(release.dir))
          .map((release) => release.dir),
        ...(repoHint ? { repoHint } : {}),
      },
      NO_STORE,
    );
  }, NO_STORE);
}

/**
 * Reads the request body, tolerating an empty one.
 *
 * A POST with no parameters sends no body at all, and `req.json()` on an
 * empty body throws ⇒ the body is only parsed when there is something to
 * parse. An EMPTY or UNPARSEABLE body is treated as `{}` — the strict
 * schema then accepts it, because "no parameters" is exactly what this
 * endpoint means.
 *
 * ⚠️ A body that IS parseable is handed to the schema as it is, so an
 * unknown key is rejected with a 400 rather than silently ignored.
 */
async function readBody(req: NextRequest): Promise<unknown> {
  const raw = await req.text();
  if (!raw || raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
