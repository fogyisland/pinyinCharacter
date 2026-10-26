import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The MCP endpoint's public URL.
 *
 * `getRuntimeSiteUrl()` reads the admin-configured site URL first and falls
 * back to the localhost placeholder when nothing is configured. The dev
 * server runs on 4444, not 3000, so the placeholder must never be handed
 * out as the endpoint — the request's own origin is used instead.
 */

vi.mock('@/lib/db', () => ({
  // getRuntimeSiteUrl() reads app_config.site.url first. A pool that throws
  // is what the site does when the database is unreachable, and the helper
  // catches it and falls back to the environment.
  getPool: () => {
    throw new Error('the database is not reachable from the test');
  },
}));

// import after the mock
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveMcpEndpoint', () => {
  it('falls back to the request origin when no site url is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(await resolveMcpEndpoint({ url: 'http://localhost:4444/api/mcp/token' })).toBe(
      'http://localhost:4444/mcp',
    );
  });

  it('uses the configured site url when there is one', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://ziyun.pudafo.com');
    expect(await resolveMcpEndpoint({ url: 'http://localhost:4444/api/mcp/token' })).toBe(
      'https://ziyun.pudafo.com/mcp',
    );
  });

  it('uses the dev port when there is no request', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('PORT', '4444');
    expect(await resolveMcpEndpoint()).toBe('http://localhost:4444/mcp');
  });

  it('strips the trailing slash of the configured site url', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://ziyun.pudafo.com/');
    expect(await resolveMcpEndpoint({ url: 'http://localhost:4444/api/mcp/token' })).toBe(
      'https://ziyun.pudafo.com/mcp',
    );
  });
});
