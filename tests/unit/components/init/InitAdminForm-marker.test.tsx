// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
}));

let calls: Array<{ url: string; method: string; body?: unknown }> = [];

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as unknown as Response;
}

/**
 * Stub fetch so that `/api/init/admin` answers with `adminResponse`.
 * Everything else behaves normally.
 */
function stubFetch(adminResponse: () => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      if (url === '/api/init/stash-admin') {
        return jsonResponse({ ok: true, data: { token: 'c'.repeat(32), expiresInSec: 600 } });
      }
      if (url === '/api/init/admin') {
        return adminResponse();
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  cleanup();
  calls = [];
  pushMock.mockClear();
  replaceMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fieldFor(container: HTMLElement, labelText: RegExp): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((element) =>
    labelText.test(element.textContent ?? ''),
  );
  if (!label) throw new Error(`no label matching ${labelText}`);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`the label matching ${labelText} has no input`);
  return input as HTMLInputElement;
}

async function submitForm(): Promise<void> {
  const { InitAdminForm } = await import('@/app/init/admin/InitAdminForm');
  const { container, getByRole } = render(<InitAdminForm />);
  fireEvent.change(fieldFor(container, /用户名/), { target: { value: 'pilot_admin' } });
  fireEvent.change(fieldFor(container, /密码/), { target: { value: 'supersecret' } });
  fireEvent.click(getByRole('button', { name: /下一步/ }));
}

describe('InitAdminForm — the marker was not written', () => {
  it('says nothing when the server reports the marker was not written', async () => {
    // This is the normal state on a fresh install: `app_config` does not
    // exist until step 3 creates it, so step 2 cannot write the marker.
    // It is a state, not an error — the console must stay clean.
    stubFetch(() =>
      jsonResponse({ ok: true, data: { validated: true, markerWritten: false } }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await submitForm();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init/execute');
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('says nothing when the marker was written', async () => {
    stubFetch(() => jsonResponse({ ok: true, data: { validated: true, markerWritten: true } }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await submitForm();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init/execute');
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still reports a genuine failure', async () => {
    stubFetch(() => jsonResponse({ ok: false, error: { message: 'boom' } }, false));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await submitForm();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init/execute');
    });

    expect(errorSpy).toHaveBeenCalled();
  });

  it('moves on to step 3 even when the marker was not written', async () => {
    stubFetch(() =>
      jsonResponse({ ok: true, data: { validated: true, markerWritten: false } }),
    );

    await submitForm();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init/execute');
    });
  });
});
