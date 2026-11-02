import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The MCP endpoint follows the site URL the administrator configured.
 *
 * In production the site URL does NOT come from the environment — it comes
 * from `app_config.site.url`, which the administrator sets on
 * /admin/settings/site-url. That is the whole point of the user's request:
 * once the domain is set, the MCP endpoint has to move with it.
 *
 * The previous test file (`mcp-endpoint.test.ts`) only covers the
 * environment branch, because it mocks the database away. This file
 * covers the branch that actually runs in production.
 */

const getConfigMock = vi.fn();

vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
}));

// import after the mock
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('resolveMcpEndpoint with a configured site url', () => {
  it('follows the domain the administrator configured', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://stale-env.example.com');

    expect(await resolveMcpEndpoint({ url: '/mcp' })).toBe('https://ziyun.pudafo.com/mcp');
  });

  it('drops the default https port of the configured domain', async () => {
    // The published endpoint is the plain origin: `https://host:443/mcp`
    // and `https://host/mcp` are the same server, but the first is not
    // the URL an operator writes down for a client.
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com:443');

    expect(await resolveMcpEndpoint({ url: '/mcp' })).toBe('https://ziyun.pudafo.com/mcp');
  });

  it('drops the default http port of the configured domain', async () => {
    getConfigMock.mockResolvedValue('http://ziyun.pudafo.com:80');

    expect(await resolveMcpEndpoint({ url: '/mcp' })).toBe('http://ziyun.pudafo.com/mcp');
  });

  it('keeps a non-default port of the configured domain', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com:8443');

    expect(await resolveMcpEndpoint({ url: '/mcp' })).toBe('https://ziyun.pudafo.com:8443/mcp');
  });

  it('strips the trailing slash of the configured domain', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com:443/');

    expect(await resolveMcpEndpoint({ url: '/mcp' })).toBe('https://ziyun.pudafo.com/mcp');
  });

  it('reads exactly the site.url key', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com');
    await resolveMcpEndpoint({ url: '/mcp' });
    expect(getConfigMock).toHaveBeenCalledWith('site.url');
  });
});
