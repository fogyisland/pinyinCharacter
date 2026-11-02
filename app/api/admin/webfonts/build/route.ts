import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import {
  appendLog,
  clearOldJobLogs,
  createJob,
  findActiveJob,
  getJob,
  listJobs,
  ensureStaleJobsMarked,
  updateJob,
  type WebfontJobStep,
} from '@/lib/webfont/jobs';
import { runPipeline } from '@/lib/webfont/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Every response of this route carries `no-store` — the errors included.
 *
 * The job list is live state: it changes while the administrator is looking
 * at it. A cached 409 ("a build is already running") would send them away
 * from a button that would now work.
 */
const NO_STORE: ResponseInit = {
  headers: { 'Cache-Control': 'no-store' },
};

/**
 * The start-build request takes NO parameters.
 *
 * ⚠️ The schema is strict: an unknown field is a 400, not a shrug. A typo
 * in a field name would otherwise mean "the caller thinks it asked for
 * something specific and the server did something else".
 */
const BuildSchema = z.object({}).strict();

/**
 * How many job transcripts are kept in full (design §9.1).
 *
 * The `log` column is a MEDIUMTEXT that holds the whole build transcript
 * and is append-only for the life of a job ⇒ without a retention window it
 * grows without bound. Older jobs keep their metadata; only their
 * transcript is dropped.
 */
const JOB_LOG_RETENTION = 20;

/**
 * The in-process "one build at a time" flag.
 *
 * ⚠️ It lives on `globalThis`, NOT in a module-level variable: in `next dev`
 * a module-level variable is re-initialised on every Fast Refresh, so the
 * flag would be lost on every hot reload and two builds could run at once.
 *
 * A `Symbol` is used as the key so it cannot collide with anything else on
 * the global object.
 */
const BUILD_LOCK = Symbol.for('pinyin.webfont.buildLock');

interface BuildGlobal {
  [BUILD_LOCK]?: string;
}

const globalScope = globalThis as typeof globalThis & BuildGlobal;

/** The job that currently owns the in-process lock, if any. */
function lockedJobId(): string | null {
  return globalScope[BUILD_LOCK] ?? null;
}

/** Takes the in-process lock for `jobId`. */
function acquireBuildLock(jobId: string): void {
  globalScope[BUILD_LOCK] = jobId;
}

/**
 * Releases the in-process lock, but only if this job still owns it.
 *
 * ⚠️ The owner check matters: a late release from an old job must not
 * clear a lock that a newer job already holds.
 */
function releaseBuildLock(jobId: string): void {
  if (globalScope[BUILD_LOCK] === jobId) {
    delete globalScope[BUILD_LOCK];
  }
}

/**
 * POST /api/admin/webfonts/build — start a build (design §3.2).
 *
 * The route answers **202** at once and the pipeline runs in the
 * BACKGROUND — the admin page polls the job list. The pipeline is never
 * awaited: a build takes minutes, and an HTTP request may not.
 *
 * ⚠️ **Two gates, both required.** The in-process lock (fast, per Node
 * process) and the database's `findActiveJob()` (the truth across
 * processes). Either one alone leaves a hole: the in-process lock alone
 * does not know about a build that started in another worker; the database
 * alone would make every click wait for a round trip that says "no" only
 * after the administrator has already pressed the button.
 *
 * ⚠️ **The lock is released when the job reaches a terminal state** —
 * `done`, `failed` OR `cancelled`. A single failure that leaves the lock
 * set would make the backend unable to start another build FOREVER, with
 * the admin page's button dead and no explanation.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const body = await readBody(req);
    const parsed = BuildSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', '开始构建不接受任何参数', NO_STORE);
    }

    // ── the in-process gate ──────────────────────────────────────────────
    const locked = lockedJobId();
    if (locked) {
      return jobActive(locked);
    }

    // ── the database gate ────────────────────────────────────────────────
    const active = await findActiveJob();
    if (active) {
      return jobActive(active.id);
    }

    // Prune the old transcripts BEFORE the new job is created — otherwise
    // the job that was just created could be the one that gets pruned.
    //
    // ⚠️ The prune is housekeeping: it must not be able to fail the
    // request. A failure is logged and the build starts anyway.
    try {
      await clearOldJobLogs(JOB_LOG_RETENTION);
    } catch (error) {
      console.error(
        '[webfont] clearing the old job logs failed:',
        (error as Error).message,
      );
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    acquireBuildLock(id);

    try {
      await createJob({ id, startedBy: auth.user.id });
    } catch (error) {
      // The job was never created ⇒ the lock must not stay behind.
      releaseBuildLock(id);
      throw error;
    }

    await logUserAction(req, auth.user.id, 'admin_webfont_build_started', {
      title: `开始字体构建（作业 ${id}）`,
      jobId: id,
    });

    // ── the background chain ─────────────────────────────────────────────
    //
    // ⚠️ This chain is NOT awaited: the route answers 202 at once.
    // ⚠️ It has a `.catch()`: an unhandled rejection is a silent hang — the
    // page would spin forever and nobody would learn why the build stopped.
    // ⚠️ The `finally` releases the lock on EVERY terminal state.
    const startedBy = auth.user.id;

    /** Marks the job failed and writes the failure audit row. */
    const failJob = async (reason: string): Promise<void> => {
      await updateJob(id, {
        status: 'failed',
        message: '构建失败',
        error: reason,
      });
      try {
        await logUserAction(req, startedBy, 'admin_webfont_build_failed', {
          title: `字体构建失败（作业 ${id}）`,
          jobId: id,
          error: reason,
        });
      } catch (error) {
        console.error(
          '[webfont] writing the build failure audit row failed:',
          (error as Error).message,
        );
      }
    };

    void runPipeline({
      jobId: id,
      callbacks: {
        log: (line: string) => appendLog(id, line),
        step: (step: WebfontJobStep, text: string) =>
          updateJob(id, { step, message: text }),
      },
      shouldStop: async () => {
        const current = await getJob(id);
        return current?.status === 'cancelled';
      },
    })
      .then(async (result) => {
        if (result.cancelled) {
          // ⚠️ A cancel is NOT a failure: the error field stays empty and
          // no `admin_webfont_build_failed` row is written.
          await updateJob(id, {
            status: 'cancelled',
            step: result.step,
            message: '已取消',
          });
          return;
        }
        if (!result.ok) {
          await failJob(result.error ?? '构建失败');
          return;
        }
        await updateJob(id, {
          status: 'done',
          step: result.step,
          message: '构建完成',
          manifestVersion: result.manifestVersion ?? '',
        });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await failJob(message);
      })
      .finally(() => {
        releaseBuildLock(id);
      });

    return NextResponse.json({ ok: true, jobId: id }, { status: 202, ...NO_STORE });
  }, NO_STORE);
}

/**
 * GET /api/admin/webfonts/build — the last 10 jobs (design §5).
 *
 * ⚠️ The stale sweep runs FIRST: a process restart leaves jobs stuck in
 * `running`, and a list that shows them would show a job that will never
 * move again.
 *
 * This route writes no audit entry — a read is not a change.
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    await ensureStaleJobsMarked();
    const jobs = await listJobs(10);

    return NextResponse.json({ ok: true, jobs }, NO_STORE);
  }, NO_STORE);
}

/**
 * The "a build is already running" answer.
 *
 * ⚠️ The body is built BY HAND: `conflict()` produces exactly
 * `{ ok, error: { code, message } }` — there is no room for a third field
 * inside `error`. The running job's id rides along inside `error`, because
 * the admin page has to link to it.
 */
function jobActive(jobId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'job_active',
        message: '已经有构建在进行中',
        jobId,
      },
    },
    { status: 409, ...NO_STORE },
  );
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
