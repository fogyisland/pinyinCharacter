import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The admin font-pipeline API when the DATABASE is behind the CODE.
 *
 * Regression test for the production 500 on 2026-11-03:
 *
 *   GET /api/admin/webfonts/build → 500 "server error"
 *
 * The job table `webfont_build_jobs` is created by a migration
 * (`scripts/migrations/2026-10-31-webfont-build-jobs.sql`). The
 * production database predated it, so every read of the table failed
 * with MySQL's `ER_NO_SUCH_TABLE`.
 *
 * The generic 500 says "server error" and stops there. The administrator
 * cannot tell a bug from a missing migration, so the only sensible next
 * step is a bug report — but the cause is fixed by running ONE command.
 *
 * So this failure gets its own code and a message that names the remedy.
 * The status is 503: the server is fine, the database is not ready for
 * this feature yet, and a retry after the migration succeeds.
 *
 * ⚠️ The translation must be NARROW. A connection failure is not a
 * missing table, and a missing `users` table is not a missing webfont
 * table. Reporting either as "run the migration" sends the operator to
 * fix the wrong thing — and a page that says "run the migration" when
 * the database is unreachable is a lie.
 */

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logUserAction: vi.fn(async () => {}),
}));

const listJobsMock = vi.fn();
const getJobMock = vi.fn();
vi.mock('@/lib/webfont/jobs', () => ({
  createJob: vi.fn(),
  getJob: (id: string) => getJobMock(id),
  listJobs: (limit: number) => listJobsMock(limit),
  appendLog: vi.fn(async () => {}),
  updateJob: vi.fn(async () => {}),
  findActiveJob: vi.fn(async () => null),
  clearOldJobLogs: vi.fn(async () => 0),
  ensureStaleJobsMarked: vi.fn(async () => {}),
}));

vi.mock('@/lib/webfont/pipeline', () => ({
  runPipeline: vi.fn(),
}));

vi.mock('@/lib/webfont/apply', () => ({
  applyStagedBuild: vi.fn(),
}));

import { requireAdmin } from '@/lib/auth';
import { GET as getBuilds } from '@/app/api/admin/webfonts/build/route';
import { GET as getOneJob } from '@/app/api/admin/webfonts/build/[id]/route';
import {
  SCHEMA_MIGRATION_PENDING,
  SCHEMA_MIGRATION_PENDING_MESSAGE,
} from '@/lib/webfont/api-schema-error';

const ADMIN = { id: 1, username: 'admin', isAdmin: true };

/** The driver error MySQL raises for a missing table. */
function missingTableError(table = 'webfont_build_jobs'): Error & {
  code?: string;
  errno?: number;
  sqlMessage?: string;
} {
  const error = new Error(`Table 'piyin.${table}' doesn't exist`) as Error & {
    code?: string;
    errno?: number;
    sqlMessage?: string;
  };
  error.code = 'ER_NO_SUCH_TABLE';
  error.errno = 1146;
  error.sqlMessage = `Table 'piyin.${table}' doesn't exist`;
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, user: ADMIN } as never);
  listJobsMock.mockResolvedValue([]);
  getJobMock.mockResolvedValue(null);
});

describe('the job-list route when the job table is missing', () => {
  it('answers with the migration code, the remedy, and a 503', async () => {
    listJobsMock.mockRejectedValue(missingTableError());

    const response = await getBuilds(new NextRequest('http://localhost/api/admin/webfonts/build'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(SCHEMA_MIGRATION_PENDING);
    expect(body.error.message).toBe(SCHEMA_MIGRATION_PENDING_MESSAGE);
    // The remedy has to be in the message — otherwise the caller is back
    // to guessing.
    expect(body.error.message).toContain('scripts/migrate.ts');
  });

  it('does not report a connection failure as a missing migration', async () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:3306') as Error & { code?: string };
    error.code = 'ECONNREFUSED';
    listJobsMock.mockRejectedValue(error);

    const response = await getBuilds(new NextRequest('http://localhost/api/admin/webfonts/build'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('server');
    expect(body.error.code).not.toBe(SCHEMA_MIGRATION_PENDING);
  });

  it('does not report another missing table as a missing migration', async () => {
    listJobsMock.mockRejectedValue(missingTableError('users'));

    const response = await getBuilds(new NextRequest('http://localhost/api/admin/webfonts/build'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('server');
  });

  it('keeps no-store on the error answer', async () => {
    // The job list is live state; a cached 503 would outlive the
    // migration and keep telling the administrator the database is
    // behind long after it is not.
    listJobsMock.mockRejectedValue(missingTableError());

    const response = await getBuilds(new NextRequest('http://localhost/api/admin/webfonts/build'));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the one-job route when the job table is missing', () => {
  it('answers with the migration code and a 503', async () => {
    getJobMock.mockRejectedValue(missingTableError());

    const response = await getOneJob(
      new NextRequest('http://localhost/api/admin/webfonts/build/job-1'),
      { params: Promise.resolve({ id: 'job-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe(SCHEMA_MIGRATION_PENDING);
  });
});
