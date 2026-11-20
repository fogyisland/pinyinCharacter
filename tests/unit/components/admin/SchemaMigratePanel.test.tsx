/**
 * `components/admin/SchemaMigratePanel.tsx` — the schema migration panel.
 *
 * The panel shows what the database is missing from the code's point of
 * view and lets an administrator apply the migrations that would fix it.
 *
 * The contract under test:
 *
 *  - the panel says what is missing **by name** — a table, a column, and
 *    the file that should have created it. "3 missing" tells the operator
 *    nothing; "`idioms` is missing" tells them what to do.
 *  - a table that is missing entirely does not also list its columns:
 *    the table is the one fact the operator needs.
 *  - the run button is disabled while a run is in flight, so a second
 *    click cannot fire two migrations at once.
 *  - a failed migration shows the database's own message. The route
 *    keeps it, and the panel must not swallow it.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SchemaMigratePanel, type SchemaComparisonRow } from '@/components/admin/SchemaMigratePanel';

const UP_TO_DATE: SchemaComparisonRow = {
  missingTables: [],
  missingColumns: [],
  actualTables: 40,
  expectedTables: 40,
  actualColumns: 300,
  expectedColumns: 300,
  upToDate: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SchemaMigratePanel', () => {
  it('says the schema is up to date', () => {
    render(<SchemaMigratePanel comparison={UP_TO_DATE} />);
    expect(screen.getByText(/结构已是最新/)).toBeTruthy();
  });

  it('names the missing table and the file that should have created it', () => {
    render(
      <SchemaMigratePanel
        comparison={{
          ...UP_TO_DATE,
          upToDate: false,
          missingTables: [{ table: 'idioms', source: 'scripts/migrations/2026-11-19-idioms.sql' }],
        }}
      />,
    );
    expect(screen.getByText('idioms')).toBeTruthy();
    expect(screen.getByText(/2026-11-19-idioms\.sql/)).toBeTruthy();
  });

  it('names the missing column', () => {
    render(
      <SchemaMigratePanel
        comparison={{
          ...UP_TO_DATE,
          upToDate: false,
          missingColumns: [
            { table: 'chars', column: 'hsk_level', source: 'scripts/migrations/2026-07-04-hsk-level.sql' },
          ],
        }}
      />,
    );
    expect(screen.getByText('chars.hsk_level')).toBeTruthy();
  });

  it('runs the migration when the button is pressed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: { migrations: { files: 23, statements: 120 }, comparison: UP_TO_DATE } }),
    );
    render(<SchemaMigratePanel comparison={UP_TO_DATE} />);

    await userEvent.click(screen.getByRole('button', { name: /运行迁移/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/migrate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows the database own message when the migration fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: { code: 'migration_failed', message: '结构迁移失败: ER_DUP_FIELDNAME at 2026-07-04-hsk-level.sql' },
        },
        500,
      ),
    );
    render(<SchemaMigratePanel comparison={UP_TO_DATE} />);

    await userEvent.click(screen.getByRole('button', { name: /运行迁移/ }));

    await waitFor(() => {
      expect(screen.getByText(/ER_DUP_FIELDNAME/)).toBeTruthy();
    });
  });

  it('does not fire a second migration while one is running', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    render(<SchemaMigratePanel comparison={UP_TO_DATE} />);

    const button = screen.getByRole('button', { name: /运行迁移/ });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /迁移中/ })).toBeTruthy();
    });
    // The second click must not reach the network.
    const disabled = screen.getByRole('button', { name: /迁移中/ }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ ok: true, data: { migrations: { files: 23, statements: 120 }, comparison: UP_TO_DATE } }));
  });
});
