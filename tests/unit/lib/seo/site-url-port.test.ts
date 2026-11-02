import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The site URL must never carry a redundant port.
 *
 * `https://ziyun.pudafo.com:443` and `https://ziyun.pudafo.com` are the same
 * origin, but they are two different strings, and the site URL is pasted
 * into canonical links, the sitemap, the JSON-LD, the verification e-mails
 * and — the reason this matters — the MCP endpoint that clients connect to.
 *
 * Two concrete failures come out of not normalizing:
 *
 *  1. **SEO.** A canonical URL that differs from the site's real origin by a
 *     port is a *different* URL as far as a search engine is concerned, and
 *     the sitemap would advertise `https://host:443/...` — a duplicate of
 *     every other page on the site.
 *  2. **The MCP endpoint.** `https://host:443/mcp` is not what an operator
 *     expects to hand out. The default HTTPS port has to disappear.
 *
 * The rule is the standard one: the port is removed only when it is the
 * default port for the scheme — 443 for https, 80 for http. A non-default
 * port (the dev server on 4444, a staging box on 8443) is meaningful and
 * must survive.
 */

const getConfigMock = vi.fn();

vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
}));

import {
  getRuntimeSiteUrl,
  getSiteUrl,
  resolveSiteUrl,
  normalizeSiteUrl,
} from '@/lib/seo/config';

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

describe('normalizeSiteUrl', () => {
  it('drops the default https port', () => {
    expect(normalizeSiteUrl('https://ziyun.pudafo.com:443')).toBe('https://ziyun.pudafo.com');
  });

  it('drops the default http port', () => {
    expect(normalizeSiteUrl('http://ziyun.pudafo.com:80')).toBe('http://ziyun.pudafo.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeSiteUrl('http://localhost:4444')).toBe('http://localhost:4444');
    expect(normalizeSiteUrl('https://ziyun.pudafo.com:8443')).toBe('https://ziyun.pudafo.com:8443');
  });

  it('keeps a port that merely looks like the default', () => {
    // 443 on http is NOT the default port for http.
    expect(normalizeSiteUrl('http://ziyun.pudafo.com:443')).toBe('http://ziyun.pudafo.com:443');
    // 80 on https is NOT the default port for https.
    expect(normalizeSiteUrl('https://ziyun.pudafo.com:80')).toBe('https://ziyun.pudafo.com:80');
  });

  it('strips trailing slashes as well', () => {
    expect(normalizeSiteUrl('https://ziyun.pudafo.com:443/')).toBe('https://ziyun.pudafo.com');
    expect(normalizeSiteUrl('https://ziyun.pudafo.com///')).toBe('https://ziyun.pudafo.com');
  });

  it('strips the trailing slash of a url that has no port to strip', () => {
    // The trailing-slash rule is independent of the port rule: a url with
    // no port at all still has to come out without its trailing slash.
    expect(normalizeSiteUrl('https://ziyun.pudafo.com/')).toBe('https://ziyun.pudafo.com');
    expect(normalizeSiteUrl('http://localhost:4444/')).toBe('http://localhost:4444');
    expect(normalizeSiteUrl('not a url/')).toBe('not a url');
  });

  it('leaves a url without a port alone', () => {
    expect(normalizeSiteUrl('https://ziyun.pudafo.com')).toBe('https://ziyun.pudafo.com');
  });

  it('leaves a value that is not a url alone', () => {
    // The admin can type anything; a value we cannot parse must survive
    // untouched rather than be mangled into something else.
    expect(normalizeSiteUrl('not a url')).toBe('not a url');
    expect(normalizeSiteUrl('')).toBe('');
  });

  it('keeps the path', () => {
    expect(normalizeSiteUrl('https://ziyun.pudafo.com:443/app')).toBe(
      'https://ziyun.pudafo.com/app',
    );
  });

  it('does not touch a port inside the host of an ipv6 literal', () => {
    // [::1]:443 — the port is still the default one, so it goes; but the
    // colons inside the brackets must not be mistaken for a port.
    expect(normalizeSiteUrl('https://[::1]:443')).toBe('https://[::1]');
    expect(normalizeSiteUrl('https://[::1]:8443')).toBe('https://[::1]:8443');
  });
});

describe('the site URL readers normalize the port', () => {
  it('getSiteUrl drops the default https port', () => {
    process.env[ENV_KEY] = 'https://ziyun.pudafo.com:443';
    expect(getSiteUrl()).toBe('https://ziyun.pudafo.com');
  });

  it('getRuntimeSiteUrl drops the default https port from app_config', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com:443');
    await expect(getRuntimeSiteUrl()).resolves.toBe('https://ziyun.pudafo.com');
  });

  it('getRuntimeSiteUrl drops the default https port from the environment', async () => {
    process.env[ENV_KEY] = 'https://ziyun.pudafo.com:443';
    await expect(getRuntimeSiteUrl()).resolves.toBe('https://ziyun.pudafo.com');
  });

  it('resolveSiteUrl drops the default https port', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com:443');
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'https://ziyun.pudafo.com',
      source: 'app_config',
    });
  });

  it('resolveSiteUrl drops the default http port from the environment', async () => {
    process.env[ENV_KEY] = 'http://ziyun.pudafo.com:80';
    await expect(resolveSiteUrl()).resolves.toEqual({
      url: 'http://ziyun.pudafo.com',
      source: 'env',
    });
  });
});
