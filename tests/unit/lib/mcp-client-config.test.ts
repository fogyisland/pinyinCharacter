import { describe, it, expect } from 'vitest';
import {
  buildMcpClientConfig,
  formatMcpClientConfig,
  MCP_SERVER_NAME,
  MCP_TOKEN_PLACEHOLDER,
} from '@/lib/mcp-client-config';

/**
 * The client configuration.
 *
 * Three places show it — the /profile token card, the answer of
 * /api/mcp/token and the admin's MCP page — so it has to be the same
 * JSON in all of them. Two things are pinned here: the shape a client
 * expects, and the promise that the block carries the placeholder rather
 * than a live token unless it was explicitly asked for.
 */

const ENDPOINT = 'https://ziyun.example.com/mcp';
const RAW_TOKEN = 'mcp_RAWTOKEN0123456789abcdefghijklmnop';

describe('buildMcpClientConfig', () => {
  it('registers the server under the name a client expects', () => {
    const config = buildMcpClientConfig(ENDPOINT, null);
    expect(Object.keys(config.mcpServers)).toEqual([MCP_SERVER_NAME]);
    expect(config.mcpServers[MCP_SERVER_NAME]!.type).toBe('http');
    expect(config.mcpServers[MCP_SERVER_NAME]!.url).toBe(ENDPOINT);
  });

  it('puts the placeholder in the authorization header when there is no token', () => {
    const config = buildMcpClientConfig(ENDPOINT, null);
    expect(config.mcpServers[MCP_SERVER_NAME]!.headers.Authorization).toBe(
      `Bearer ${MCP_TOKEN_PLACEHOLDER}`,
    );
  });

  it('puts the raw token in the authorization header when there is one', () => {
    const config = buildMcpClientConfig(ENDPOINT, RAW_TOKEN);
    expect(config.mcpServers[MCP_SERVER_NAME]!.headers.Authorization).toBe(`Bearer ${RAW_TOKEN}`);
  });
});

describe('formatMcpClientConfig', () => {
  it('reads as JSON a person can paste into a client', () => {
    const text = formatMcpClientConfig(ENDPOINT, null);
    const parsed = JSON.parse(text) as ReturnType<typeof buildMcpClientConfig>;
    expect(parsed.mcpServers[MCP_SERVER_NAME]!.url).toBe(ENDPOINT);
    // The indentation is there to be read, not to be parsed.
    expect(text).toContain('\n  "mcpServers"');
  });

  it('carries no token unless it was given one', () => {
    expect(formatMcpClientConfig(ENDPOINT, null)).not.toContain(RAW_TOKEN);
  });
});
