/**
 * `POST /api/admin/migrate` — running the schema migrations from the admin.
 *
 * The route exists because the only other caller of `runMigrations()` is
 * the `/init` wizard, and the wizard locks itself out once setup
 * completes (`markSetupComplete()` writes `setup.route_enabled = 'false'`).
 * So an operator who copies new code onto a running server has no way to
 * apply the migrations that came with it — the schema stays behind the
 * code and the affected features fail with `ER_NO_SUCH_TABLE`.
 *
 * The security contract matters more than the convenience:
 *
 *  - the route is **administrator-only** — unlike `/api/init/migrate`,
 *    which is guarded only by the wizard's own lock. That route is safe
 *    because the wizard closes itself; this one is open on a live site,
 *    so it needs `requireAdmin()`.
 *  - a migration that fails must not be reported as a success. The
 *    response says what was applied and what failed.
 *  - the probe cache is cleared afterwards, so the screen shows the
 *    state *after* the migration, not before it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
}));

vi.mock('@/lib/schema-check', () => ({
  compareSchema: vi.fn(),
  clearSchemaCache: vi.fn(),
}));

const runMigrationsMock = vi.fn();
vi.mock('@/scripts/migrate', () => ({
  runMigrations: (...args: unknown[]) => runMigrationsMock(...args),
}));

import { GET, POST } from '@/app/api/admin/migrate/route';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { compareSchema, clearSchemaCache } from '@/lib/schema-check';

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedWriteAudit = vi.mocked(writeAudit);
const mockedCompareSchema = vi.mocked(compareSchema);
const mockedClearSchemaCache = vi.mocked(clearSchemaCache);

const UP_TO_DATE = {
  missingTables: [],
  missingColumns: [],
  actualTables: 40,
  expectedTables: 40,
  actualColumns: 300,
  expectedColumns: 300,
  upToDate: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
  mockedWriteAudit.mockResolvedValue(undefined);
  mockedCompareSchema.mockResolvedValue(UP_TO_DATE);
  mockedClearSchemaCache.mockImplementation(() => {});
  runMigrationsMock.mockResolvedValue({ files: 23, statements: 120 });
});

describe('GET /api/admin/migrate', () => {
  it('reports the schema comparison to an administrator', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.comparison.upToDate).toBe(true);
  });

  it('refuses a caller who is not an administrator', async () => {
    mockedRequireAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(compareSchema).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/migrate', () => {
  it('refuses a caller who is not an administrator', async () => {
    // The wizard's guard is gone by the time an operator needs this
    // route, so the administrator check is the only thing standing
    // between the internet and the DDL.
    mockedRequireAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }),
    });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(runMigrationsMock).not.toHaveBeenCalled();
  });

  it('runs the migrations', async () => {
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(runMigrationsMock).toHaveBeenCalledTimes(1);
    expect(body.data.migrations).toEqual({ files: 23, statements: 120 });
  });

  it('clears the probe cache so the screen shows the state after the migration', async () => {
    await POST();
    expect(mockedClearSchemaCache).toHaveBeenCalled();
  });

  it('reports the schema comparison after the migration', async () => {
    const res = await POST();
    const body = await res.json();
    expect(body.data.comparison).toEqual(UP_TO_DATE);
  });

  it('writes an audit log with the title of the action', async () => {
    await POST();
    expect(mockedWriteAudit).toHaveBeenCalledTimes(1);
    const call = mockedWriteAudit.mock.calls[0][0];
    expect(call.event).toBe('admin_schema_migrate');
    const metadata = call.metadata as { files?: number; statements?: number; title?: string };
    expect(metadata).toMatchObject({ files: 23, statements: 120 });
    expect(typeof metadata.title).toBe('string');
  });

  it('does not report a failed migration as a success', async () => {
    // The failure has to reach the operator: a migration that aborts
    // halfway leaves the schema in a state neither the old nor the new
    // code fully expects.
    runMigrationsMock.mockRejectedValue(new Error('ER_DUP_FIELDNAME at 2026-07-04-hsk-level.sql'));
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(String(body.error?.message ?? body.error)).toContain('ER_DUP_FIELDNAME');
  });

  it('writes an audit log even when the migration failed', async () => {
    runMigrationsMock.mockRejectedValue(new Error('boom'));
    await POST();
    expect(mockedWriteAudit).toHaveBeenCalledTimes(1);
    const call = mockedWriteAudit.mock.calls[0][0];
    expect(call.event).toBe('admin_schema_migrate');
  });
});
