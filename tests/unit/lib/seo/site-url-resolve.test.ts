import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `resolveSiteUrl()` — the resolver the admin UI uses.
 *
 * The screen whose job is to *set* the site URL used to call `getSiteUrl()`,
 * which throws in production when `NEXT_PUBLIC_SITE_URL` is missing. Nothing
 * in the repository writes that variable (the admin PATCH only writes
 * `app_config.site.url`), so a fresh production install could never
 * configure the URL — the page 500'd exactly when it was needed.
 *
 * The resolver must answer "what is the site URL right now" without ever
 * throwing, and must say `unset` rather than pretend `http://localhost:3000`
 * is a configured value.
 */

const getConfigMock = vi.fn();

vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
}));

import { resolveSiteUrl } from '@/lib/seo/config';

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL';
let originalEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockResolvedValue(null);
  originalEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
});

describe('resolveSiteUrl', () => {
  it('prefers app_config over the environment variable', async () => {
    getConfigMock.mockResolvedValue('https://from-db.example.com');
    process.env[ENV_KEY] = 'https://from-env.example.com';
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'https://from-db.example.com',
      source: 'app_config',
    });
  });

  it('falls back to the environment variable when app_config has no row', async () => {
    getConfigMock.mockResolvedValue(null);
    process.env[ENV_KEY] = 'https://from-env.example.com';
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'https://from-env.example.com',
      source: 'env',
    });
  });

  it('reports "unset" — not localhost:3000 — when nothing is configured', async () => {
    getConfigMock.mockResolvedValue(null);
    await expect(resolveSiteUrl()).resolves.toEqual({ url: '', source: 'unset' });
  });

  it('treats an empty app_config value as "not configured"', async () => {
    getConfigMock.mockResolvedValue('');
    await expect(resolveSiteUrl()).resolves.toEqual({ url: '', source: 'unset' });
  });

  it('does not throw when the database is unreachable', async () => {
    getConfigMock.mockRejectedValue(new Error('DATABASE_URL is not set'));
    await expect(resolveSiteUrl()).resolves.toEqual({ url: '', source: 'unset' });
  });

  it('still reads the environment variable when the database is unreachable', async () => {
    getConfigMock.mockRejectedValue(new Error('boom'));
    process.env[ENV_KEY] = 'https://from-env.example.com';
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'https://from-env.example.com',
      source: 'env',
    });
  });

  it('strips trailing slashes', async () => {
    getConfigMock.mockResolvedValue('https://from-db.example.com/');
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'https://from-db.example.com',
      source: 'app_config',
    });
  });

  it('reads exactly the site.url key', async () => {
    getConfigMock.mockResolvedValue(null);
    await resolveSiteUrl();
    expect(getConfigMock).toHaveBeenCalledWith('site.url');
  });
});
