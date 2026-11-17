import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { setConfig, clearConfigCache } from '@/lib/config';

/**
 * The `ai.base_url` validator.
 *
 * `ai.base_url` is admin-configurable, and the AI client sends it an
 * `Authorization: Bearer <api key>` header. Before the validator was
 * added, any URL was accepted — so an admin (or anyone who got hold of the
 * admin session) could point the app at
 *
 *   http://169.254.169.254/     <- the cloud metadata endpoint
 *   http://127.0.0.1:3306/      <- the database itself
 *   http://10.0.0.5/internal/   <- the private network
 *
 * and turn the server into a request proxy for the internal network,
 * carrying the API key with it. The rules are: HTTPS only, and no host
 * that lives inside the machine.
 */
describe('setConfig — the ai.base_url validator', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    clearConfigCache();
  });

  async function accepts(url: string): Promise<boolean> {
    try {
      await setConfig('ai.base_url', url, null);
      return true;
    } catch {
      return false;
    }
  }

  it('accepts an ordinary https endpoint', async () => {
    expect(await accepts('https://api.example.com/v1')).toBe(true);
    expect(await accepts('https://api.openai.com/v1')).toBe(true);
    expect(await accepts('https://api.anthropic.com')).toBe(true);
  });

  it('accepts an empty value, which means "not configured"', async () => {
    expect(await accepts('')).toBe(true);
  });

  it('refuses plain http, which would put the API key on the wire in clear', async () => {
    expect(await accepts('http://api.example.com/v1')).toBe(false);
  });

  it('refuses the loopback addresses', async () => {
    expect(await accepts('https://localhost/v1')).toBe(false);
    expect(await accepts('https://127.0.0.1/v1')).toBe(false);
    expect(await accepts('https://127.0.0.1:3306/')).toBe(false);
    expect(await accepts('https://0.0.0.0/v1')).toBe(false);
    expect(await accepts('https://[::1]/v1')).toBe(false);
  });

  it('refuses the cloud metadata endpoint', async () => {
    expect(await accepts('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(await accepts('https://metadata.google.internal/v1')).toBe(false);
  });

  it('refuses the private ranges', async () => {
    expect(await accepts('https://10.0.0.5/v1')).toBe(false);
    expect(await accepts('https://192.168.1.1/v1')).toBe(false);
    expect(await accepts('https://172.16.0.1/v1')).toBe(false);
    expect(await accepts('https://172.31.255.254/v1')).toBe(false);
  });

  it('allows an address just outside the private ranges', async () => {
    // 172.15.x and 172.32.x are public. A prefix check that swallowed
    // them would be over-blocking.
    expect(await accepts('https://172.15.0.1/v1')).toBe(true);
    expect(await accepts('https://172.32.0.1/v1')).toBe(true);
    expect(await accepts('https://11.0.0.1/v1')).toBe(true);
  });

  it('refuses a value that is not a URL at all', async () => {
    expect(await accepts('not-a-url')).toBe(false);
    expect(await accepts('ftp://example.com/v1')).toBe(false);
    expect(await accepts('file:///etc/passwd')).toBe(false);
  });

  it('refuses an absurdly long value', async () => {
    expect(await accepts('https://example.com/' + 'a'.repeat(300))).toBe(false);
  });

  it('does not write to the database when the value is rejected', async () => {
    await setConfig('ai.base_url', 'http://169.254.169.254/', null).catch(() => undefined);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('writes the value to the database when it is accepted', async () => {
    await setConfig('ai.base_url', 'https://api.example.com/v1', null);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0][1];
    expect(params).toContain('https://api.example.com/v1');
  });
});
