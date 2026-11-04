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
      return jsonResponse({
        ok: true,
        data: {
          seeds: [
            { datasetId: 'hsk-grading', status: 'seeded', actual: 2632, inserted: 2632 },
          ],
        },
      });
    case '/api/init/mark-complete':
      return jsonResponse({ ok: true, data: { completed: true } });
    default:
      throw new Error(`unexpected fetch: ${url}`);
  }
}

beforeEach(() => {
  cleanup();
  calls = [];
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
  const { InitExecuteForm } = await import('@/app/init/execute/InitExecuteForm');
  const { getByRole } = render(<InitExecuteForm />);
  await waitFor(() => {
    expect(window.sessionStorage.getItem('piyin.init.admin.creds')).toBeTruthy();
  });
  fireEvent.click(getByRole('button', { name: /开始初始化/ }));
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
});
