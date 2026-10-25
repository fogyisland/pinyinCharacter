import { describe, expect, it } from 'vitest';
import { loadConfig, McpConfigError } from '@/mcp/config';

/**
 * The configuration rules of the MCP server.
 *
 * The environment is passed in as an argument, so the rules are exercised
 * without touching the real environment of the process.
 */

/** An environment with only the entries the test cares about. */
function env(entries: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return entries as NodeJS.ProcessEnv;
}

describe('the MCP configuration', () => {
  it('reads the defaults when the environment says nothing', () => {
    const config = loadConfig(env({ MCP_AUTH_TOKEN: 'secret' }));
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4455);
    expect(config.endpoint).toBe('/mcp');
    expect(config.corsOrigin).toBe('*');
    expect(config.serverName).toBe('pinyin-character');
    expect(config.serverVersion).toBe('1.0.0');
    expect(config.authToken).toBe('secret');
  });

  it('reads every value out of the environment', () => {
    const config = loadConfig(
      env({
        MCP_AUTH_TOKEN: 'secret',
        MCP_HOST: '0.0.0.0',
        MCP_PORT: '4600',
        MCP_ENDPOINT: 'mcp',
        MCP_CORS_ORIGIN: 'https://example.com',
        MCP_SERVER_NAME: 'pinyin',
        MCP_SERVER_VERSION: '2.1.0',
      }),
    );
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(4600);
    expect(config.endpoint).toBe('/mcp');
    expect(config.corsOrigin).toBe('https://example.com');
    expect(config.serverName).toBe('pinyin');
    expect(config.serverVersion).toBe('2.1.0');
  });

  it('refuses to start without a token', () => {
    expect(() => loadConfig(env({}))).toThrow(McpConfigError);
    expect(() => loadConfig(env({}))).toThrow(/MCP_AUTH_TOKEN is not set/);
  });

  it('refuses to start without a token even on the loopback interface', () => {
    expect(() => loadConfig(env({ MCP_HOST: '127.0.0.1' }))).toThrow(McpConfigError);
  });

  it('runs without a token when anonymity is asked for', () => {
    const config = loadConfig(env({ MCP_ALLOW_ANONYMOUS: 'true' }));
    expect(config.authToken).toBeNull();
  });

  it('refuses to run anonymously on a routable address', () => {
    expect(() =>
      loadConfig(env({ MCP_ALLOW_ANONYMOUS: 'true', MCP_HOST: '0.0.0.0' })),
    ).toThrow(/only allowed on the loopback interface/);
  });

  it('runs anonymously on every loopback name', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      const config = loadConfig(env({ MCP_ALLOW_ANONYMOUS: 'true', MCP_HOST: host }));
      expect(config.host).toBe(host);
      expect(config.authToken).toBeNull();
    }
  });

  it('ignores an anonymity flag that is not true', () => {
    expect(() => loadConfig(env({ MCP_ALLOW_ANONYMOUS: 'yes' }))).toThrow(McpConfigError);
    expect(() => loadConfig(env({ MCP_ALLOW_ANONYMOUS: '1' }))).toThrow(McpConfigError);
  });

  it('refuses a port that is not a port', () => {
    for (const port of ['0', '65536', 'abc', '4455.5', '-1']) {
      expect(() => loadConfig(env({ MCP_AUTH_TOKEN: 'secret', MCP_PORT: port }))).toThrow(
        McpConfigError,
      );
    }
  });

  it('names the bad port in the error', () => {
    expect(() => loadConfig(env({ MCP_AUTH_TOKEN: 'secret', MCP_PORT: 'abc' }))).toThrow(
      /MCP_PORT must be an integer between 1 and 65535/,
    );
  });

  it('falls back to the default port for a blank value', () => {
    const config = loadConfig(env({ MCP_AUTH_TOKEN: 'secret', MCP_PORT: '  ' }));
    expect(config.port).toBe(4455);
  });

  it('trims the token and refuses a blank one', () => {
    const config = loadConfig(env({ MCP_AUTH_TOKEN: '  secret  ' }));
    expect(config.authToken).toBe('secret');
    expect(() => loadConfig(env({ MCP_AUTH_TOKEN: '   ' }))).toThrow(McpConfigError);
  });
});
