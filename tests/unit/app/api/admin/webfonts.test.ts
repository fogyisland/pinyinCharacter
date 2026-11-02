import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * The admin font-pipeline API (design §5).
 *
 * Four routes:
 *
 *   POST   /api/admin/webfonts/build              start a build
 *   GET    /api/admin/webfonts/build              the last 10 jobs
 *   GET    /api/admin/webfonts/build/[id]         one job
 *   POST   /api/admin/webfonts/build/[id]/cancel  cancel a running job
 *   POST   /api/admin/webfonts/build/[id]/apply   publish a finished build
 *
 * What is under test is the CONTRACT, because the admin page (Task 8)
 * reads it:
 *
 *  - the body is FLAT, with `ok` at the TOP LEVEL — the page reads
 *    `data.jobs` / `data.job` / `data.jobId`, not `data.data.jobs`;
 *  - the "already active" 409 carries the running job's id INSIDE `error`;
 *  - the three POSTs take NO parameters — an empty body must work, and an
 *    unknown field must be a 400 (never silently ignored);
 *  - a cancel is NOT a failure: it flips the status and writes no
 *    `admin_webfont_build_failed` audit row;
 *  - an apply is IDEMPOTENT: the second click on the same job is a 409;
 *  - the apply response passes `reimport` / `rebaseline` / `pageCost`
 *    through UNCHANGED — the route never recomputes them;
 *  - the apply audit row carries `published: true` and
 *    `importedToRepo: false` — the two facts spec §3.6 demands;
 *  - the pipeline runs in the BACKGROUND: the route answers 202 at once
 *    and the chain has a `.catch()` that fails the job.
 *
 * ⚠️ `@/lib/webfont/jobs`, `@/lib/webfont/pipeline` and `@/lib/webfont/apply`
 * are mocked — they touch the database, the disk and the child processes.
 * `@/lib/auth` and `@/lib/audit` are mocked too. Everything else (the
 * response shapes, the zod validation, the mutex, the audit metadata) is
 * the route's own code and is exercised for real.
 */

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logUserAction: vi.fn(async () => {}),
}));

vi.mock('@/lib/webfont/jobs', () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  appendLog: vi.fn(async () => {}),
  updateJob: vi.fn(async () => {}),
  findActiveJob: vi.fn(),
  clearOldJobLogs: vi.fn(async () => 0),
  ensureStaleJobsMarked: vi.fn(async () => {}),
}));

vi.mock('@/lib/webfont/pipeline', () => ({
  runPipeline: vi.fn(),
}));

vi.mock('@/lib/webfont/apply', () => ({
  applyStagedBuild: vi.fn(),
}));

vi.mock('@/lib/webfont/capability', () => ({
  probeCapability: vi.fn(),
}));

import { GET as GET_BUILD, POST as POST_BUILD } from '@/app/api/admin/webfonts/build/route';
import { GET as GET_JOB } from '@/app/api/admin/webfonts/build/[id]/route';
import { POST as POST_CANCEL } from '@/app/api/admin/webfonts/build/[id]/cancel/route';
import { POST as POST_APPLY } from '@/app/api/admin/webfonts/build/[id]/apply/route';
import { GET as GET_CAPABILITY } from '@/app/api/admin/webfonts/capability/route';

import { requireAdmin } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import {
  createJob,
  getJob,
  listJobs,
  appendLog,
  updateJob,
  findActiveJob,
  clearOldJobLogs,
  ensureStaleJobsMarked,
  type WebfontJob,
} from '@/lib/webfont/jobs';
import { runPipeline } from '@/lib/webfont/pipeline';
import { applyStagedBuild } from '@/lib/webfont/apply';
import { probeCapability } from '@/lib/webfont/capability';

const requireAdminMock = vi.mocked(requireAdmin);
const auditMock = vi.mocked(logUserAction);
const createJobMock = vi.mocked(createJob);
const getJobMock = vi.mocked(getJob);
const listJobsMock = vi.mocked(listJobs);
const appendLogMock = vi.mocked(appendLog);
const updateJobMock = vi.mocked(updateJob);
const findActiveJobMock = vi.mocked(findActiveJob);
const clearOldJobLogsMock = vi.mocked(clearOldJobLogs);
const staleJobsMock = vi.mocked(ensureStaleJobsMarked);
const runPipelineMock = vi.mocked(runPipeline);
const applyMock = vi.mocked(applyStagedBuild);
const capabilityMock = vi.mocked(probeCapability);

const ADMIN = { id: 7, username: 'admin', isAdmin: true };

/** Builds a job row with sane defaults. */
function makeJob(overrides: Partial<WebfontJob> = {}): WebfontJob {
  return {
    id: 'a1b2c3d4e5f60718',
    status: 'pending',
    step: '',
    stepProgress: '',
    message: '',
    error: null,
    log: '',
    manifestVersion: '',
    releaseDir: '',
    startedBy: ADMIN.id,
    createdAt: '2026-11-02T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

/** A POST with no body at all — what a "no parameters" button sends. */
function emptyReq(url = 'http://localhost/api/admin/webfonts/build'): NextRequest {
  return new NextRequest(url, { method: 'POST' });
}

/** A POST with a JSON body. */
function jsonReq(body: unknown, url = 'http://localhost/api/admin/webfonts/build'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** A POST with a body that is not JSON at all. */
function garbageReq(url = 'http://localhost/api/admin/webfonts/build'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: 'not json at all',
    headers: { 'content-type': 'application/json' },
  });
}

/** The context object Next.js hands to a dynamic route handler. */
function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** Lets the background promise chain settle before the assertions run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A job store that behaves like the database: `getJob` returns the row as
 * it is NOW, and `updateJob` patches it.
 *
 * The cancel route reads the job back after it patches it — the answer it
 * gives must be the persisted one, and a mock that always returned the
 * pre-cancel row would hide that.
 */
function useStatefulJob(initial: WebfontJob): { current: () => WebfontJob } {
  let row = { ...initial };
  getJobMock.mockImplementation(async () => ({ ...row }));
  updateJobMock.mockImplementation(async (_id, patch) => {
    row = { ...row, ...patch };
  });
  return { current: () => row };
}

/** The successful apply result the mocked `applyStagedBuild` returns. */
function makeApplyResult() {
  return {
    ok: true,
    manifestVersion: 'aaaaaa',
    releaseToken: 'bbbbbbbbbbbb',
    releaseDir: 'rbbbbbbbbbbbb',
    rewrittenFaces: 3,
    swept: [],
    supersededDir: null,
    error: null,
    summary: {
      liveFiles: 7981,
      liveBytes: 28236168,
      newFiles: 7981,
      newBytes: 28236168,
      releaseBytes: 28236168,
    },
    pageCost: {
      bytes: { '/': 839680 },
      files: { '/': 255 },
      budgetBytes: { '/': 900000 },
      budgetFiles: 255,
    },
    reimport: {
      required: true,
      command: 'node scripts/fonts/import-webfont-release.mjs --release rbbbbbbbbbbbb',
      note: '不回灌 ⇒ 下次部署会静默回滚',
    },
    rebaseline: [
      {
        file: 'public/font/fonts-manifest.json',
        line: 1,
        what: '子集文件数',
        current: 7981,
        expected: 7981,
        always: true,
      },
    ],
  };
}

/**
 * The in-process build lock lives on `globalThis` (design §3.2) ⇒ it
 * survives between the tests of this file. It is cleared before every
 * test so that one test's build does not lock out the next one.
 */
const BUILD_LOCK = Symbol.for('pinyin.webfont.buildLock');

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<symbol, unknown>)[BUILD_LOCK];
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  auditMock.mockResolvedValue(undefined);
  createJobMock.mockResolvedValue(makeJob());
  getJobMock.mockResolvedValue(null);
  listJobsMock.mockResolvedValue([]);
  appendLogMock.mockResolvedValue(undefined);
  updateJobMock.mockResolvedValue(undefined);
  findActiveJobMock.mockResolvedValue(null);
  clearOldJobLogsMock.mockResolvedValue(0);
  staleJobsMock.mockResolvedValue(undefined);
  runPipelineMock.mockResolvedValue({
    ok: true,
    step: 'verify',
    error: null,
    manifestVersion: 'aaaaaa',
    cancelled: false,
    pageCost: null,
  });
  applyMock.mockResolvedValue(makeApplyResult());
  capabilityMock.mockResolvedValue({
    ok: true,
    node: { ok: true, version: 'v22' },
    python: { ok: true, version: '3.12' },
    fonttools: { ok: true, version: '4.0' },
    network: { ok: true },
    disk: { ok: true },
    toolchain: { subsetFont: true, typescript: true, tsx: true },
    sources: [],
    missing: [],
  } as never);
});

describe('POST /api/admin/webfonts/build', () => {
  it('refuses an unauthenticated request with a 401', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 },
      ),
    });

    const res = await POST_BUILD(emptyReq());

    expect(res.status).toBe(401);
    // No job is created for a request that was never allowed in.
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('refuses a non-administrator with a 403', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 },
      ),
    });

    const res = await POST_BUILD(emptyReq());

    expect(res.status).toBe(403);
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('answers 409 with the running job id INSIDE the error object', async () => {
    findActiveJobMock.mockResolvedValue(makeJob({ id: 'ffffffffffffffff' }));

    const res = await POST_BUILD(emptyReq());
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string; jobId?: string };
    };

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('job_active');
    // ⚠️ The id lives INSIDE `error` — `conflict()` has no room for a third
    // top-level field, so the 409 body is built by hand.
    expect(body.error.jobId).toBe('ffffffffffffffff');
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('answers 202 with a flat body and starts the pipeline in the background', async () => {
    const res = await POST_BUILD(emptyReq());
    const body = (await res.json()) as { ok: boolean; jobId: string };

    expect(res.status).toBe(202);
    // ⚠️ FLAT — the page reads `data.jobId`, not `data.data.jobId`.
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId).toHaveLength(16);
    expect(body).not.toHaveProperty('data');

    // The pipeline was started — but the route did NOT wait for it.
    expect(runPipelineMock).toHaveBeenCalledTimes(1);
    expect(runPipelineMock.mock.calls[0][0].jobId).toBe(body.jobId);
  });

  it('runs the pipeline without awaiting it', async () => {
    // A pipeline that never resolves: if the route awaited it, the request
    // would never answer.
    runPipelineMock.mockImplementation(() => new Promise(() => {}));

    const res = await POST_BUILD(emptyReq());

    expect(res.status).toBe(202);
  });

  it('lets only ONE build start at a time (the in-process mutex)', async () => {
    // ★ REVIEW FOCUS 3: two administrators click "start build" at the same
    // time ⇒ two products write the same staging directory.
    // The first request takes the in-process mutex; the second one is
    // refused with 409 even though the database still shows no active job.
    let release: () => void = () => {};
    runPipelineMock.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true } as never); }),
    );

    const first = await POST_BUILD(emptyReq());
    const second = await POST_BUILD(emptyReq());

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('job_active');
    expect(runPipelineMock).toHaveBeenCalledTimes(1);

    release();
    await settle();
  });

  it('releases the in-process mutex once the job reaches a terminal state', async () => {
    // ★ A failed build must not leave the flag set: the admin page's button
    // would be dead forever, with no explanation.
    runPipelineMock.mockRejectedValue(new Error('boom'));

    const first = await POST_BUILD(emptyReq());
    expect(first.status).toBe(202);
    await settle();

    // The mutex is free again ⇒ a second build may start.
    runPipelineMock.mockResolvedValue({
      ok: true,
      step: 'verify',
      error: null,
      manifestVersion: 'aaaaaa',
      cancelled: false,
      pageCost: null,
    });
    const second = await POST_BUILD(emptyReq());
    expect(second.status).toBe(202);
  });

  it('fails the job and audits it when the background chain throws', async () => {
    // ★ R-67: the chain MUST have a `.catch()`. An unhandled rejection is a
    // silent hang: the page spins forever and nobody learns why.
    runPipelineMock.mockRejectedValue(new Error('下载源字体失败'));

    const res = await POST_BUILD(emptyReq());
    expect(res.status).toBe(202);
    await settle();

    const failure = updateJobMock.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'failed',
    );
    expect(failure).toBeDefined();
    expect((failure?.[1] as { error?: string }).error).toContain('下载源字体失败');

    const auditCall = auditMock.mock.calls.find(
      (call) => call[2] === 'admin_webfont_build_failed',
    );
    expect(auditCall).toBeDefined();
  });

  it('marks a pipeline-cancelled job as cancelled, not failed', async () => {
    // ⚠️ The pipeline reports a cancellation with `cancelled: true` and
    // its own error text ('cancelled by admin'). The JOB's `error` column
    // stays empty — a cancel is not a failure.
    runPipelineMock.mockResolvedValue({
      ok: false,
      step: 'subset',
      error: 'cancelled by admin',
      manifestVersion: null,
      cancelled: true,
      pageCost: null,
    });

    const res = await POST_BUILD(emptyReq());
    expect(res.status).toBe(202);
    await settle();

    const patch = updateJobMock.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'cancelled',
    )?.[1] as { error?: string | null; message?: string };
    expect(patch).toBeDefined();
    expect(patch?.error).toBeUndefined();
    expect(patch?.message).toContain('取消');

    // ⚠️ And no failure audit row — a cancel is not a failure.
    expect(
      auditMock.mock.calls.find((call) => call[2] === 'admin_webfont_build_failed'),
    ).toBeUndefined();
  });

  it('prunes the old job logs before it creates the new job', async () => {
    // ★ R-79: the `log` column is a MEDIUMTEXT transcript, append-only for
    // the life of a job. Only the most recent 20 jobs keep theirs.
    await POST_BUILD(emptyReq());

    expect(clearOldJobLogsMock).toHaveBeenCalledTimes(1);
    expect(clearOldJobLogsMock).toHaveBeenCalledWith(20);
    // Prune FIRST, then create — otherwise the job that was just created
    // could be the one that gets pruned.
    const pruneOrder = clearOldJobLogsMock.mock.invocationCallOrder[0];
    const createOrder = createJobMock.mock.invocationCallOrder[0];
    expect(pruneOrder).toBeLessThan(createOrder);
  });

  it('still starts the build when the log prune fails', async () => {
    // The prune is housekeeping: it must not be able to fail the request.
    clearOldJobLogsMock.mockRejectedValue(new Error('db hiccup'));

    const res = await POST_BUILD(emptyReq());

    expect(res.status).toBe(202);
    expect(runPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown field in the body with a 400', async () => {
    // ★ zod has to be strict: a typo would otherwise mean "the caller
    // thinks it asked for something specific and the server did something
    // else".
    const res = await POST_BUILD(jsonReq({ somethingElse: true }));
    const body = (await res.json()) as { ok: boolean; error: { code: string } };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('invalid_input');
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('accepts an empty body', async () => {
    const res = await POST_BUILD(emptyReq());

    expect(res.status).toBe(202);
  });

  it('accepts a body that is not JSON at all', async () => {
    const res = await POST_BUILD(garbageReq());

    expect(res.status).not.toBe(400);
  });

  it('audits the start of the build', async () => {
    const res = await POST_BUILD(emptyReq());
    const body = (await res.json()) as { jobId: string };

    expect(auditMock).toHaveBeenCalledTimes(1);
    const call = auditMock.mock.calls[0];
    expect(call[1]).toBe(ADMIN.id);
    expect(call[2]).toBe('admin_webfont_build_started');
    const metadata = call[3] as Record<string, unknown>;
    expect(metadata.jobId).toBe(body.jobId);
    expect(typeof metadata.title).toBe('string');
  });
});

describe('GET /api/admin/webfonts/build', () => {
  it('refuses an unauthenticated request with a 401', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 },
      ),
    });

    const res = await GET_BUILD(new NextRequest('http://localhost/api/admin/webfonts/build'));

    expect(res.status).toBe(401);
  });

  it('refuses a non-administrator with a 403', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 },
      ),
    });

    const res = await GET_BUILD(new NextRequest('http://localhost/api/admin/webfonts/build'));

    expect(res.status).toBe(403);
  });

  it('answers with a flat body that carries the last 10 jobs', async () => {
    listJobsMock.mockResolvedValue([makeJob({ id: 'job1' }), makeJob({ id: 'job2' })]);

    const res = await GET_BUILD(new NextRequest('http://localhost/api/admin/webfonts/build'));
    const body = (await res.json()) as { ok: boolean; jobs: WebfontJob[] };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs).toHaveLength(2);
    expect(body).not.toHaveProperty('data');
    expect(listJobsMock).toHaveBeenCalledWith(10);
  });

  it('marks the stale jobs before it lists them', async () => {
    // A process restart leaves jobs stuck in `running`; the sweep has to
    // run first, or the page shows a job that will never move again.
    await GET_BUILD(new NextRequest('http://localhost/api/admin/webfonts/build'));

    expect(staleJobsMock).toHaveBeenCalledTimes(1);
    expect(staleJobsMock.mock.invocationCallOrder[0]).toBeLessThan(
      listJobsMock.mock.invocationCallOrder[0],
    );
  });

  it('writes no audit entry — a read is not a change', async () => {
    await GET_BUILD(new NextRequest('http://localhost/api/admin/webfonts/build'));

    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/webfonts/build/[id]', () => {
  it('refuses an unauthenticated request with a 401', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 },
      ),
    });

    const res = await GET_JOB(
      new NextRequest('http://localhost/api/admin/webfonts/build/abc'),
      ctx('abc'),
    );

    expect(res.status).toBe(401);
  });

  it('answers 404 for an unknown job', async () => {
    getJobMock.mockResolvedValue(null);

    const res = await GET_JOB(
      new NextRequest('http://localhost/api/admin/webfonts/build/nope'),
      ctx('nope'),
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
    // The message is user-facing copy ⇒ Chinese.
    expect(body.error.message).toContain('作业');
  });

  it('answers with a flat body that carries the whole job, log included', async () => {
    getJobMock.mockResolvedValue(makeJob({ id: 'abc', log: '[download] ok\n' }));

    const res = await GET_JOB(
      new NextRequest('http://localhost/api/admin/webfonts/build/abc'),
      ctx('abc'),
    );
    const body = (await res.json()) as { ok: boolean; job: WebfontJob };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.job.id).toBe('abc');
    // The page renders the log out of the job object.
    expect(body.job.log).toContain('[download] ok');
    expect(body).not.toHaveProperty('data');
  });

  it('writes no audit entry — a read is not a change', async () => {
    getJobMock.mockResolvedValue(makeJob());

    await GET_JOB(new NextRequest('http://localhost/api/admin/webfonts/build/abc'), ctx('abc'));

    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/webfonts/build/[id]/cancel', () => {
  it('refuses an unauthenticated request with a 401', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 },
      ),
    });

    const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(401);
  });

  it('refuses a non-administrator with a 403', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 },
      ),
    });

    const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(403);
  });

  it('answers 404 for an unknown job', async () => {
    getJobMock.mockResolvedValue(null);

    const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('nope'));

    expect(res.status).toBe(404);
  });

  it('answers 409 for a job that already finished', async () => {
    for (const status of ['done', 'failed', 'cancelled'] as const) {
      vi.clearAllMocks();
      requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
      getJobMock.mockResolvedValue(makeJob({ status }));

      const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));
      const body = (await res.json()) as { ok: boolean; error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(updateJobMock).not.toHaveBeenCalled();
    }
  });

  it('cancels a running job and answers 200 with the job', async () => {
    const store = useStatefulJob(makeJob({ status: 'running', step: 'subset' }));

    const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as { ok: boolean; job: WebfontJob };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // The answer carries the PERSISTED job — the one that is cancelled.
    expect(body.job.status).toBe('cancelled');
    expect(body).not.toHaveProperty('data');
    expect(store.current().status).toBe('cancelled');
  });

  it('cancels a pending job too', async () => {
    getJobMock.mockResolvedValue(makeJob({ status: 'pending' }));

    const res = await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(200);
  });

  it('stamps the finish time of the cancelled job', async () => {
    // The job IS finished when it is cancelled ⇒ `finished_at` is set.
    // The value passed is only the "set it" signal — `updateJob` turns
    // any non-null value into MySQL's `NOW()`.
    useStatefulJob(makeJob({ status: 'running' }));

    await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    const patch = updateJobMock.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'cancelled',
    )?.[1] as { finishedAt?: string | null };
    expect(patch?.finishedAt).toBeTruthy();
  });

  it('treats a cancel as NOT a failure — no error text, no failure audit', async () => {
    // ★ A cancel is not a failure. The `error` field stays empty, the
    // cancellation is stated in the job's `message`, and no
    // `admin_webfont_build_failed` row is written.
    getJobMock.mockResolvedValue(makeJob({ status: 'running' }));

    await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    const patch = updateJobMock.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'cancelled',
    )?.[1] as { error?: string | null; message?: string };
    expect(patch?.error).toBeUndefined();
    // The cancellation says so — in the message, not in the error.
    expect(patch?.message).toContain('取消');

    expect(
      auditMock.mock.calls.find((call) => call[2] === 'admin_webfont_build_failed'),
    ).toBeUndefined();
  });

  it('writes no misleading audit row for a cancel', async () => {
    // ⚠️ The audit catalogue of design §3.6 is CLOSED: five events, none
    // of which describes a cancellation. A cancel may therefore not write
    // `admin_webfont_build_failed` (R-68) and may not write
    // `admin_webfont_build_started` either — that row would claim a build
    // started when it was stopped. The job row itself carries the
    // cancellation (`status = 'cancelled'`, `message = '已取消'`).
    getJobMock.mockResolvedValue(makeJob({ status: 'running' }));

    await POST_CANCEL(emptyReq('http://localhost/x'), ctx('abc'));

    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/webfonts/build/[id]/apply', () => {
  it('refuses an unauthenticated request with a 401', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 },
      ),
    });

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(401);
  });

  it('refuses a non-administrator with a 403', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 },
      ),
    });

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(403);
  });

  it('answers 404 for an unknown job', async () => {
    getJobMock.mockResolvedValue(null);

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('nope'));

    expect(res.status).toBe(404);
  });

  it('answers 409 for a job that is not done', async () => {
    for (const status of ['pending', 'running', 'failed', 'cancelled'] as const) {
      vi.clearAllMocks();
      requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
      getJobMock.mockResolvedValue(makeJob({ status }));

      const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
      const body = (await res.json()) as { ok: boolean; error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(applyMock).not.toHaveBeenCalled();
    }
  });

  it('answers 409 when the same job is applied twice', async () => {
    // ★ REVIEW FOCUS 6: the apply is idempotent — the second click must
    // not publish a second time.
    //
    // ⚠️ The job store is STATEFUL here: the first apply writes the
    // release directory onto the row, and the second apply reads that row
    // back. A mock that always returned the pre-apply row would let the
    // second apply through.
    useStatefulJob(makeJob({ status: 'done', releaseDir: '' }));

    const first = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    expect(first.status).toBe(200);

    const second = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await second.json()) as { ok: boolean; error: { code: string } };

    expect(second.status).toBe(409);
    expect(body.ok).toBe(false);
    // ⚠️ The publish ran ONCE — the second click did not publish again.
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it('passes reimport, rebaseline and pageCost through untouched', async () => {
    // ★ R-58: the route NEVER recomputes these — they come out of the
    // apply result as they are.
    const result = makeApplyResult();
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));
    applyMock.mockResolvedValue(result);

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as {
      ok: boolean;
      reimport: { required: boolean; command: string; note: string };
      rebaseline: unknown[];
      pageCost: { budgetFiles: number; bytes: Record<string, number> };
    };

    expect(res.status).toBe(200);
    expect(body.reimport).toEqual(result.reimport);
    expect(body.reimport.required).toBe(true);
    expect(body.reimport.command).toContain('--release rbbbbbbbbbbbb');
    expect(body.rebaseline).toEqual(result.rebaseline);
    expect(body.pageCost).toEqual(result.pageCost);
    // `budgetFiles` is ONE number, not a record.
    expect(typeof body.pageCost.budgetFiles).toBe('number');
  });

  it('derives the release token from the release directory', async () => {
    // ★ R-65: `releaseDir` = `r<T>` ⇒ T is the token with the `r` stripped.
    // The token is NOT stored a second time.
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as { releaseToken: string; releaseDir: string };

    expect(body.releaseDir).toBe('rbbbbbbbbbbbb');
    expect(body.releaseToken).toBe('bbbbbbbbbbbb');
  });

  it('answers with a flat body that carries the job and the release facts', async () => {
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('data');
    expect(body).toHaveProperty('job');
    expect(body).toHaveProperty('manifestVersion');
    expect(body).toHaveProperty('releaseToken');
    expect(body).toHaveProperty('releaseDir');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('reimport');
    expect(body).toHaveProperty('rebaseline');
    expect(body).toHaveProperty('pageCost');
  });

  it('records the release on the job', async () => {
    const store = useStatefulJob(makeJob({ status: 'done' }));

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as { job: WebfontJob };

    const patch = updateJobMock.mock.calls.find(
      (call) => (call[1] as { releaseDir?: string }).releaseDir === 'rbbbbbbbbbbbb',
    )?.[1] as { manifestVersion?: string; step?: string };
    expect(patch).toBeDefined();
    expect(patch?.manifestVersion).toBe('aaaaaa');
    expect(patch?.step).toBe('apply');
    // ⚠️ The answer carries the PERSISTED job — the one that names the
    // release directory.
    expect(store.current().releaseDir).toBe('rbbbbbbbbbbbb');
    expect(body.job.releaseDir).toBe('rbbbbbbbbbbbb');
  });

  it('audits the apply with the two facts spec §3.6 demands', async () => {
    // ★ R-134: `published: true` and `importedToRepo: false`. The backend
    // never knows whether the artifact was re-imported ⇒ this row is the
    // ONLY way the audit log can answer it.
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));

    await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));

    const call = auditMock.mock.calls.find((entry) => entry[2] === 'admin_webfont_build_applied');
    expect(call).toBeDefined();
    const metadata = call?.[3] as Record<string, unknown>;
    expect(metadata.published).toBe(true);
    expect(metadata.importedToRepo).toBe(false);
    // Plus the new version number.
    expect(metadata.manifestVersion).toBe('aaaaaa');
    expect(typeof metadata.title).toBe('string');
  });

  it('fails the job, audits it and answers 500 when the apply fails', async () => {
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));
    applyMock.mockResolvedValue({
      ...makeApplyResult(),
      ok: false,
      error: '样式表 fonts-sans.css 的改写条数对不上',
      manifestVersion: null,
      releaseToken: null,
      releaseDir: null,
      summary: null,
      pageCost: null,
    });

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    // The message says WHAT failed — and it is not the child's raw stderr.
    expect(body.error.message).toContain('改写条数对不上');

    const patch = updateJobMock.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'failed',
    );
    expect(patch).toBeDefined();
    expect(
      auditMock.mock.calls.find((entry) => entry[2] === 'admin_webfont_build_apply_failed'),
    ).toBeDefined();
  });

  it('still says what failed when the failure audit row cannot be written', async () => {
    // ⚠️ The audit row is a side effect, not the answer. A failing audit
    // write must not swallow the reason — that reason is the one thing
    // the administrator needs.
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));
    applyMock.mockResolvedValue({
      ...makeApplyResult(),
      ok: false,
      error: '样式表 fonts-sans.css 的改写条数对不上',
      manifestVersion: null,
      releaseToken: null,
      releaseDir: null,
      summary: null,
      pageCost: null,
    });
    auditMock.mockRejectedValue(new Error('audit table is gone'));

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(500);
    expect(body.error.code).toBe('apply_failed');
    expect(body.error.message).toContain('改写条数对不上');
  });

  it('rejects an unknown field in the body with a 400', async () => {
    // ★ The apply must not accept any custom path parameter — nothing may
    // direct the product at an arbitrary directory.
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));

    const res = await POST_APPLY(
      jsonReq({ stagedFontDir: '/etc' }, 'http://localhost/x'),
      ctx('abc'),
    );

    expect(res.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('accepts an empty body', async () => {
    getJobMock.mockResolvedValue(makeJob({ status: 'done' }));

    const res = await POST_APPLY(emptyReq('http://localhost/x'), ctx('abc'));

    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/webfonts/capability', () => {
  it('answers with the toolchain the panel needs', async () => {
    const res = await GET_CAPABILITY(
      new NextRequest('http://localhost/api/admin/webfonts/capability'),
    );
    const body = (await res.json()) as {
      ok: boolean;
      toolchain: { subsetFont: boolean; typescript: boolean; tsx: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.toolchain).toEqual({
      subsetFont: true,
      typescript: true,
      tsx: true,
    });
  });
});
