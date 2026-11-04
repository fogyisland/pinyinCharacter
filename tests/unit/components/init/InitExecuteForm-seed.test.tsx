// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const replaceMock = vi.fn();

// The router object must keep a stable identity across renders. The form's
// `useEffect` depends on `router`, so a fresh object literal on every call
// would re-run the effect on every render, and the effect calls `setCreds`
// — an endless render loop that hangs the test.
const routerStub = { push: pushMock, replace: replaceMock, refresh: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => routerStub,
}));

/** Every fetch call the form made, in order. */
let calls: string[] = [];

/** The seeds the seed endpoint answers with. */
let seedResponse: {
  seeds: Array<{
    datasetId: string;
    status: 'ok' | 'pending' | 'skipped' | 'failed';
    actual: number;
    inserted: number;
    skippedReason?: string;
    message?: string;
    error?: string;
  }>;
} = {
  seeds: [
    { datasetId: 'hsk-grading', status: 'ok', actual: 2632, inserted: 2632 },
  ],
};

function stubSeedResponse(response: typeof seedResponse): void {
  seedResponse = response;
}

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as unknown as Response;
}

/** The response each endpoint answers with. */
function responseFor(url: string): Response {
  switch (url) {
    case '/api/init/init-tables':
      return jsonResponse({ ok: true, data: { statementsRun: 30, tablesNow: 26 } });
    case '/api/init/init-app-config':
      return jsonResponse({ ok: true, data: { totalRows: 15 } });
    case '/api/init/init-poems':
    case '/api/init/init-classics':
    case '/api/init/init-sutras':
    case '/api/init/init-chars':
    case '/api/init/init-rare-chars':
    case '/api/init/init-char-etymology':
      return jsonResponse({ ok: true, data: { inserted: 10, skipped: false } });
    case '/api/init/create-admin':
      return jsonResponse({ ok: true, data: { userId: 1, username: 'pilot_admin' } });
    case '/api/init/init-activate':
      return jsonResponse({ ok: true, data: { seeded: true, shortName: 'DESKTOP' } });
    case '/api/init/migrate':
      return jsonResponse({ ok: true, data: { files: 23, statements: 90 } });
    case '/api/init/seed':
      return jsonResponse({ ok: true, data: seedResponse });
    case '/api/init/mark-complete':
      return jsonResponse({ ok: true, data: { completed: true } });
    default:
      throw new Error(`unexpected fetch: ${url}`);
  }
}

beforeEach(() => {
  cleanup();
  calls = [];
  seedResponse = {
    seeds: [
      { datasetId: 'hsk-grading', status: 'ok', actual: 2632, inserted: 2632 },
    ],
  };
  pushMock.mockClear();
  replaceMock.mockClear();
  window.sessionStorage.setItem(
    'piyin.init.admin.creds',
    JSON.stringify({ username: 'pilot_admin', token: 'a'.repeat(32) }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return responseFor(url);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function runWizard(): Promise<void> {
  const { getByRole } = await renderWizard();
  fireEvent.click(getByRole('button', { name: /开始初始化/ }));
}

/** Render the form with the credentials in place. */
async function renderWizard(): Promise<ReturnType<typeof render>> {
  const { InitExecuteForm } = await import('@/app/init/execute/InitExecuteForm');
  const result = render(<InitExecuteForm />);
  await waitFor(() => {
    expect(window.sessionStorage.getItem('piyin.init.admin.creds')).toBeTruthy();
  });
  return result;
}

describe('InitExecuteForm — the seed phase', () => {
  it('calls the seed endpoint', async () => {
    await runWizard();
    await waitFor(() => {
      expect(calls).toContain('/api/init/seed');
    });
  });

  it('runs the seed AFTER the migrations', async () => {
    // The migrations add `chars.hsk_level` — the column the seed fills.
    // A seed that ran first would have nothing to write.
    await runWizard();
    await waitFor(() => {
      expect(calls).toContain('/api/init/seed');
    });
    expect(calls.indexOf('/api/init/migrate')).toBeLessThan(calls.indexOf('/api/init/seed'));
  });

  it('runs the seed AFTER the characters are imported', async () => {
    // The seed grades the characters that are already in the table.
    await runWizard();
    await waitFor(() => {
      expect(calls).toContain('/api/init/seed');
    });
    expect(calls.indexOf('/api/init/init-chars')).toBeLessThan(
      calls.indexOf('/api/init/seed'),
    );
  });

  it('runs the seed BEFORE the setup is marked complete', async () => {
    // Marking the setup complete is the last thing; the seed must not come
    // after it, or the server would be "ready" with missing data.
    await runWizard();
    await waitFor(() => {
      expect(calls).toContain('/api/init/mark-complete');
    });
    expect(calls.indexOf('/api/init/seed')).toBeLessThan(
      calls.indexOf('/api/init/mark-complete'),
    );
  });

  it('finishes the wizard when the seed succeeds', async () => {
    await runWizard();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init');
    });
  });

  it('reports how many rows the seed wrote', async () => {
    // The seed engine's real status value is 'ok', not 'seeded' — the
    // status list is 'ok' | 'pending' | 'skipped' | 'failed'. A summary
    // that looked for 'seeded' would report "补齐 0 个数据集" on a run
    // that had just filled the whole database.
    const { getByRole, getByText } = await renderWizard();
    fireEvent.click(getByRole('button', { name: /开始初始化/ }));

    await waitFor(() => {
      expect(getByText(/补齐 1 个数据集/)).toBeTruthy();
    });
    expect(getByText(/共 2,632 行/)).toBeTruthy();
  });

  it('says so when every dataset was already complete', async () => {
    // The seed is idempotent: on a database that is already seeded it
    // writes nothing. Reporting "补齐 0 个数据集,共 0 行" there would
    // read like the seed had done nothing at all, which is not the same
    // thing as "the data was already there".
    stubSeedResponse({
      seeds: [
        {
          datasetId: 'hsk-grading',
          status: 'ok',
          actual: 2632,
          inserted: 0,
          skippedReason: 'already complete (2632/2632)',
        },
      ],
    });
    const { getByRole, getByText } = await renderWizard();
    fireEvent.click(getByRole('button', { name: /开始初始化/ }));

    await waitFor(() => {
      expect(getByText(/全部 1 个数据集已完整/)).toBeTruthy();
    });
  });

  it('reports a dataset that failed by name', async () => {
    stubSeedResponse({
      seeds: [
        {
          datasetId: 'hsk-grading',
          status: 'failed',
          actual: 0,
          inserted: 0,
          error: 'ER_NO_SUCH_TABLE',
        },
      ],
    });
    const { getByRole, getByText } = await renderWizard();
    fireEvent.click(getByRole('button', { name: /开始初始化/ }));

    await waitFor(() => {
      expect(getByText(/hsk-grading: ER_NO_SUCH_TABLE/)).toBeTruthy();
    });
  });
});
