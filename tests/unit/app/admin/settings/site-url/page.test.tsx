// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * The admin "site URL" screen.
 *
 * Regression test for the production 500:
 *
 *   GET /admin/settings/site-url → 500
 *   "An error occurred in the Server Components render."
 *
 * The page fell back to `getSiteUrl()`, which throws in production when
 * `NEXT_PUBLIC_SITE_URL` is unset — and no code in the repository ever
 * writes that variable (the admin PATCH only writes `app_config.site.url`).
 * So the screen meant to *set* the site URL crashed precisely because the
 * site URL had never been set. The admin could not fix it.
 *
 * The page must render with nothing configured, and must say so instead of
 * silently pretending the value is `http://localhost:3000`.
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

const getConfigMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
  setConfig: vi.fn(),
}));

import AdminSiteUrlPage from '@/app/admin/settings/site-url/page';

const ADMIN = { id: 1, username: 'admin', isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  getConfigMock.mockResolvedValue(null);
  // Production mode: `getSiteUrl()` throws in production without
  // NEXT_PUBLIC_SITE_URL, so the regression is only visible here.
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderPage(): Promise<void> {
  const element = await AdminSiteUrlPage();
  render(element);
}

describe('AdminSiteUrlPage', () => {
  it('renders in production when no site URL is configured (regression)', async () => {
    await expect(renderPage()).resolves.toBeUndefined();
    expect(screen.getByText(/尚未设置站点 URL/)).toBeInTheDocument();
  });

  it('shows the stored app_config value when there is one', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com');
    await renderPage();
    expect(screen.getByDisplayValue('https://ziyun.pudafo.com')).toBeInTheDocument();
    expect(screen.queryByText(/尚未设置站点 URL/)).not.toBeInTheDocument();
  });

  it('shows the environment value when app_config has no row', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://from-env.example.com');
    await renderPage();
    expect(screen.getByDisplayValue('https://from-env.example.com')).toBeInTheDocument();
  });

  it('renders when the database is unreachable', async () => {
    getConfigMock.mockRejectedValue(new Error('DATABASE_URL is not set'));
    await expect(renderPage()).resolves.toBeUndefined();
    expect(screen.getByText(/尚未设置站点 URL/)).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to the login prompt', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: null,
    });
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/?auth=login');
    expect(redirectMock).toHaveBeenCalledWith('/?auth=login');
  });

  it('redirects a non-admin to the forbidden prompt', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: null,
    });
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/?error=forbidden');
    expect(redirectMock).toHaveBeenCalledWith('/?error=forbidden');
  });
});
