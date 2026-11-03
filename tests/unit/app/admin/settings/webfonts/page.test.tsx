// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * The admin "website fonts" screen.
 *
 * Regression test for the production 500 that happened on 2026-11-03:
 *
 *   GET /admin/settings/webfonts → 500
 *   "An error occurred in the Server Components render."
 *
 * The page reads the last ten build jobs from `webfont_build_jobs`, a
 * table that a migration creates. The production database predated that
 * migration, so the read failed with MySQL's `ER_NO_SUCH_TABLE` — and
 * because the page is a server component, the throw escaped as an RSC
 * render error whose message a production build strips. The administrator
 * got a sentence with no table name, no cause, and no way to act on it.
 *
 * The page must degrade: say what is missing and which command fixes it.
 * And it must degrade ONLY for that failure — a different error still has
 * to surface, because "the schema is behind" and "the query broke" are
 * different problems and the page must not confuse them.
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const requireAdminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}));

const listJobsMock = vi.fn();
vi.mock('@/lib/webfont/jobs', () => ({
  listJobs: (limit: number) => listJobsMock(limit),
}));

import AdminWebfontsPage from '@/app/admin/settings/webfonts/page';
import { WebfontSchemaMissingError } from '@/lib/webfont/schema-errors';

const ADMIN = { id: 1, username: 'admin', isAdmin: true };

/** The driver error MySQL raises for a missing table. */
function missingTableError(): Error & { code?: string; errno?: number } {
  const error = new Error("Table 'piyin.webfont_build_jobs' doesn't exist") as Error & {
    code?: string;
    errno?: number;
    sqlMessage?: string;
  };
  error.code = 'ER_NO_SUCH_TABLE';
  error.errno = 1146;
  error.sqlMessage = "Table 'piyin.webfont_build_jobs' doesn't exist";
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  listJobsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('AdminWebfontsPage', () => {
  it('renders the pipeline when the job table is there', async () => {
    listJobsMock.mockResolvedValue([
      { id: 'job-1', status: 'done', step: 'verify', stepProgress: '', message: '', error: null, log: '', manifestVersion: 'v1', releaseDir: 'r1', startedBy: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', finishedAt: null },
    ]);

    const element = await AdminWebfontsPage();
    render(element);

    expect(screen.getByText('网站字体')).toBeInTheDocument();
    expect(screen.queryByText(/数据库尚未升级/)).not.toBeInTheDocument();
  });

  it('degrades to an explanation when the job table is missing (regression)', async () => {
    // The driver error, straight from mysql2 — the page has to recognise
    // it on its own, because that is what the server actually throws.
    listJobsMock.mockRejectedValue(missingTableError());

    const element = await AdminWebfontsPage();
    render(element);

    expect(screen.getByText(/数据库尚未升级/)).toBeInTheDocument();
    // The remedy has to be ON the page — that is the whole point.
    expect(screen.getByText(/scripts\/migrate\.ts/)).toBeInTheDocument();
    expect(screen.getAllByText(/webfont_build_jobs/).length).toBeGreaterThan(0);
  });

  it('degrades the same way for the named error', async () => {
    listJobsMock.mockRejectedValue(new WebfontSchemaMissingError());
    const element = await AdminWebfontsPage();
    render(element);
    expect(screen.getByText(/数据库尚未升级/)).toBeInTheDocument();
  });

  it('does NOT swallow a different failure', async () => {
    // A connection failure is not a missing table. The page must not tell
    // the operator to run a migration when the database is unreachable.
    listJobsMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3306'));

    await expect(AdminWebfontsPage()).rejects.toThrow('ECONNREFUSED');
  });

  it('does NOT swallow a failure about a different table', async () => {
    const error = new Error("Table 'piyin.users' doesn't exist") as Error & { code?: string };
    error.code = 'ER_NO_SUCH_TABLE';

    listJobsMock.mockRejectedValue(error);

    await expect(AdminWebfontsPage()).rejects.toThrow("Table 'piyin.users' doesn't exist");
  });

  it('redirects an unauthenticated visitor', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: null,
    });
    await expect(AdminWebfontsPage()).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});
