// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
}));

/** Every fetch call the component made. */
let calls: Array<{ url: string; method: string; body?: unknown }> = [];

/** The parsed JSON body of the fetch to `url`, or undefined. */
function bodyFor(url: string): unknown {
  const call = calls.find((c) => c.url === url);
  if (!call) return undefined;
  const raw = call.body;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as unknown as Response;
}

beforeEach(() => {
  cleanup();
  calls = [];
  pushMock.mockClear();
  replaceMock.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const record = { url, method: init?.method ?? 'GET', body: init?.body };
      calls.push(record);
      if (url === '/api/init/stash-admin') {
        return jsonResponse({ ok: true, data: { token: 'a'.repeat(32), expiresInSec: 600 } });
      }
      if (url === '/api/init/admin') {
        return jsonResponse({ ok: true, data: { validated: true } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The form's labels are not associated with their inputs (no `htmlFor` /
 * `id`), so `getByLabelText` cannot find them. Locate the input the way a
 * screen reader would: by the text of the label that precedes it.
 */
function fieldFor(container: HTMLElement, labelText: RegExp): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((element) =>
    labelText.test(element.textContent ?? ''),
  );
  if (!label) throw new Error(`no label matching ${labelText}`);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`the label matching ${labelText} has no input`);
  return input as HTMLInputElement;
}

async function submitForm(username = 'pilot_admin', password = 'supersecret'): Promise<void> {
  const { InitAdminForm } = await import('@/app/init/admin/InitAdminForm');
  const { container, getByRole } = render(<InitAdminForm />);
  fireEvent.change(fieldFor(container, /用户名/), { target: { value: username } });
  fireEvent.change(fieldFor(container, /密码/), { target: { value: password } });
  fireEvent.click(getByRole('button', { name: /下一步/ }));
}

describe('InitAdminForm — the wizard step-2 marker', () => {
  // The defect this guards: `/api/init/admin` writes the marker
  // `setup.wizard.admin_done`, but nothing called that route, so the
  // marker was never written and `isInitWizardAdminDone()` was
  // permanently false. The route had its own green unit test — the gap
  // was on the CALLER side, which is what this file covers.

  it('calls /api/init/admin so the step-2 marker gets written', async () => {
    await submitForm();
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/init/admin')).toBe(true);
    });
  });

  it('calls it with the same credentials it stashed', async () => {
    await submitForm('pilot_admin', 'supersecret');
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/init/admin')).toBe(true);
    });
    expect(bodyFor('/api/init/admin')).toEqual({
      username: 'pilot_admin',
      password: 'supersecret',
    });
  });

  it('calls it AFTER the stash, so the token is already in hand', async () => {
    await submitForm();
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/init/admin')).toBe(true);
    });
    const order = calls.map((c) => c.url);
    expect(order.indexOf('/api/init/stash-admin')).toBeLessThan(
      order.indexOf('/api/init/admin'),
    );
  });

  it('still moves on to step 3 when the marker call fails', async () => {
    // The credentials are already stashed and the token is in hand, so a
    // failed marker write must not block the wizard — it only costs the
    // "skip step 2 on re-entry" convenience.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url === '/api/init/stash-admin') {
          return jsonResponse({ ok: true, data: { token: 'b'.repeat(32), expiresInSec: 600 } });
        }
        if (url === '/api/init/admin') {
          return jsonResponse({ ok: false, error: { message: 'boom' } }, false);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await submitForm();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/init/execute');
    });
  });

  it('does NOT advance to step 3 when the stash itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url === '/api/init/stash-admin') {
          return jsonResponse({ ok: false, error: { message: 'bad username' } }, false);
        }
        return jsonResponse({ ok: true });
      }),
    );

    await submitForm();
    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });
    expect(calls.some((c) => c.url === '/api/init/admin')).toBe(false);
  });

  it('stores the token in sessionStorage and never the password', async () => {
    const { InitAdminForm } = await import('@/app/init/admin/InitAdminForm');
    const { container, getByRole } = render(<InitAdminForm />);
    fireEvent.change(fieldFor(container, /用户名/), { target: { value: 'pilot_admin' } });
    fireEvent.change(fieldFor(container, /密码/), { target: { value: 'supersecret' } });
    fireEvent.click(getByRole('button', { name: /下一步/ }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem('piyin.init.admin.creds')).toBeTruthy();
    });
    const stored = JSON.parse(
      window.sessionStorage.getItem('piyin.init.admin.creds') as string,
    ) as Record<string, unknown>;
    expect(stored.token).toBe('a'.repeat(32));
    expect(stored.password).toBeUndefined();
  });
});
