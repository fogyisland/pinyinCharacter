// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * The root-layout setup guard.
 *
 * The middleware cannot answer "is this install initialized?" — it runs on
 * the edge runtime where mysql2 does not exist, so it can only look at the
 * `setup_completed` cookie. That cookie goes stale (a redeploy against a
 * fresh database leaves the browser holding "setup is done" while the new
 * database has no tables), and the symptom is a site whose every
 * database-backed endpoint answers 500 and whose wizard is never reached.
 *
 * The guard re-asks the server, and must:
 *
 *  - redirect to /init when setup is positively *not* complete;
 *  - stay out of the way when the state is *unknown* (database down — do
 *    not lock everybody out because the database blinked);
 *  - never redirect the wizard itself (that would be a loop).
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

const headersMock = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}));

const getSetupStateMock = vi.fn();
vi.mock('@/lib/setup', () => ({
  getSetupState: () => getSetupStateMock(),
}));

import { SetupGuard } from '@/components/SetupGuard';

function withPathname(pathname: string): Headers {
  const h = new Headers();
  if (pathname) h.set('x-pathname', pathname);
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockReturnValue(withPathname('/login'));
  getSetupStateMock.mockResolvedValue('complete');
});

afterEach(() => {
  cleanup();
});

async function renderGuard(): Promise<void> {
  const element = await SetupGuard({ children: <div>site content</div> });
  render(element);
}

describe('SetupGuard', () => {
  it('redirects to /init when setup is not complete', async () => {
    getSetupStateMock.mockResolvedValue('incomplete');
    await expect(renderGuard()).rejects.toThrow('NEXT_REDIRECT:/init');
    expect(redirectMock).toHaveBeenCalledWith('/init');
  });

  it('renders normally when setup is complete', async () => {
    await renderGuard();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText('site content')).toBeInTheDocument();
  });

  it('renders normally when the state is unknown (database unreachable)', async () => {
    getSetupStateMock.mockResolvedValue('unknown');
    await renderGuard();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText('site content')).toBeInTheDocument();
  });

  it('never redirects the wizard itself (loop prevention)', async () => {
    headersMock.mockReturnValue(withPathname('/init'));
    getSetupStateMock.mockResolvedValue('incomplete');
    await renderGuard();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText('site content')).toBeInTheDocument();
  });

  it('never redirects a wizard sub-page', async () => {
    headersMock.mockReturnValue(withPathname('/init/db'));
    getSetupStateMock.mockResolvedValue('incomplete');
    await renderGuard();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('renders normally when the path is unknown (cannot rule out a loop)', async () => {
    headersMock.mockReturnValue(withPathname(''));
    getSetupStateMock.mockResolvedValue('incomplete');
    await renderGuard();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText('site content')).toBeInTheDocument();
  });
});
