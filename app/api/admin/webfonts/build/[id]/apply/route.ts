import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, conflict, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { getJob, updateJob } from '@/lib/webfont/jobs';
import { translateWebfontSchemaError } from '@/lib/webfont/api-schema-error';
import { applyStagedBuild } from '@/lib/webfont/apply';
import { buildDirFor } from '@/lib/webfont/paths';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * An apply changes the live font tree; a cached answer would say the
 * release was published when it was not, or the other way round.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * The apply request takes NO parameters.
 *
 * ⚠️ The schema is strict, and it accepts NOTHING: an unknown field is a
 * 400. In particular the apply takes no path parameter — nothing may
 * direct the product at an arbitrary directory. The staging directory is
 * derived from the job id by `buildDirFor`.
 */
const ApplySchema = z.object({}).strict();

/**
 * POST /api/admin/webfonts/build/[id]/apply — publish a finished build
 * (design §3.5).
 *
 * ⚠️ **The apply is IDEMPOTENT.** The same job may be applied ONCE: the
 * second click answers 409 instead of publishing a second time. The
 * marker is the job's `releaseDir` — it is empty until the first apply
 * fills it.
 *
 * ⚠️ **The route NEVER recomputes the release facts.** `summary`,
 * `pageCost`, `reimport` and `rebaseline` come out of the apply result
 * as they are — they are measurements, and a second computation would be
 * a second (possibly different) number.
 *
 * ⚠️ **The backend never runs git** (design §9, rule 5). The `reimport`
 * block says what a human has to do; the route does not do it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const body = await readBody(req);
    const parsed = ApplySchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', '应用构建不接受任何参数', NO_STORE);
    }

    const { id } = await params;
    const job = await getJob(id);
    if (!job) {
      return notFound('not_found', '找不到这个构建作业', NO_STORE);
    }

    if (job.status !== 'done') {
      return conflict('job_not_done', '只有已完成的构建才能应用', NO_STORE);
    }

    if (job.releaseDir !== '') {
      return conflict('already_applied', '这个构建已经应用过了', NO_STORE);
    }

    const result = await applyStagedBuild({
      jobId: id,
      stagedFontDir: buildDirFor(id),
    });

    if (!result.ok || !result.releaseDir) {
      const reason = result.error ?? '应用失败';
      await updateJob(id, {
        status: 'failed',
        step: 'apply',
        message: '应用失败',
        error: reason,
      });
      // ⚠️ The audit row is written INSIDE a try: a failing audit write
      // must not swallow the reason. The 500 below has to say WHAT
      // failed — that is the one thing the administrator needs.
      try {
        await logUserAction(req, auth.user.id, 'admin_webfont_build_apply_failed', {
          title: `字体构建应用失败（作业 ${id}）`,
          jobId: id,
          error: reason,
        });
      } catch (auditError) {
        console.error(
          '[webfont] writing the apply failure audit row failed:',
          (auditError as Error).message,
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'apply_failed',
            // ⚠️ The message says WHAT failed — and it is the extracted
            // key lines, never the child's raw stderr (design §3.6).
            message: reason,
          },
        },
        { status: 500, ...NO_STORE },
      );
    }

    const releaseDir = result.releaseDir;
    const manifestVersion = result.manifestVersion ?? '';
    // ⚠️ The token is DERIVED, not stored: `releaseDir` = `r<T>` ⇒ T is
    // the token with the `r` stripped. Storing it twice would let the
    // two drift apart.
    const releaseToken = releaseDir.startsWith('r') ? releaseDir.slice(1) : releaseDir;

    await updateJob(id, {
      manifestVersion,
      releaseDir,
      step: 'apply',
      message: '已应用',
    });

    await logUserAction(req, auth.user.id, 'admin_webfont_build_applied', {
      title: `字体构建已应用（作业 ${id}）`,
      jobId: id,
      manifestVersion,
      releaseDir,
      // ⚠️ The two facts design §3.6 demands. `importedToRepo` is ALWAYS
      // false: the backend does not know whether the product was
      // re-imported into the repository, and this row is the ONLY way
      // the audit log can answer it.
      published: true,
      importedToRepo: false,
    });

    const updated = await getJob(id);

    return NextResponse.json(
      {
        ok: true,
        job: updated ?? job,
        manifestVersion,
        releaseToken,
        releaseDir,
        summary: result.summary,
        pageCost: result.pageCost,
        reimport: result.reimport,
        rebaseline: result.rebaseline,
      },
      NO_STORE,
    );
  }, NO_STORE, translateWebfontSchemaError);
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
