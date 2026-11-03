import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, conflict, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getJob, updateJob } from '@/lib/webfont/jobs';
import { translateWebfontSchemaError } from '@/lib/webfont/api-schema-error';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * The cancel changes the job's state, and the job list is read by a
 * browser that may have cached the old answer.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * The cancel request takes NO parameters.
 *
 * ⚠️ The schema is strict: an unknown field is a 400, not a shrug.
 */
const CancelSchema = z.object({}).strict();

/** The statuses a job can no longer be cancelled from (design §5). */
const FINISHED_STATUSES = new Set(['done', 'failed', 'cancelled']);

/**
 * POST /api/admin/webfonts/build/[id]/cancel — cancel a running build.
 *
 * ⚠️ **A cancel is NOT a failure** (design §9.2). It does not write the
 * `admin_webfont_build_failed` audit row, and the job's `error` column
 * stays EMPTY — the cancellation is stated in the job's `message`, where
 * the admin page renders it.
 *
 * ⚠️ **The child process is NEVER killed.** A running step is allowed to
 * finish on its own: killing it could leave half a woff2 behind. The
 * cancellation takes effect before the NEXT step — the pipeline asks
 * `shouldStop` once per step, and `shouldStop` reads the job's status.
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
    const parsed = CancelSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', '取消构建不接受任何参数', NO_STORE);
    }

    const { id } = await params;
    const job = await getJob(id);
    if (!job) {
      return notFound('not_found', '找不到这个构建作业', NO_STORE);
    }

    if (FINISHED_STATUSES.has(job.status)) {
      return conflict('job_finished', '这个作业已经结束，不能再取消', NO_STORE);
    }

    // ⚠️ Only the status changes. The `error` column is left empty — a
    // cancellation is not a failure, and an empty `error` is what the
    // admin page reads as "nothing went wrong".
    //
    // `finishedAt` is a timestamp column: `updateJob` turns any non-null
    // value into MySQL's `NOW()` — the value passed here is only the
    // "set it" signal, never a JavaScript clock.
    await updateJob(id, {
      status: 'cancelled',
      message: '已取消',
      finishedAt: new Date().toISOString(),
    });

    // The answer carries the PERSISTED job — the row that now says
    // `cancelled`. The fallback is the row we read, with the two fields we
    // just wrote folded in.
    const updated = await getJob(id);

    return NextResponse.json(
      {
        ok: true,
        job: updated ?? { ...job, status: 'cancelled', message: '已取消' },
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
