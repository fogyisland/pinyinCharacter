import { describe, it, expect } from 'vitest';
import { generateMcpToken, hashMcpToken, MCP_TOKEN_PREFIX } from '@/lib/mcp-token';

/**
 * The pure half of the MCP token store: generation and hashing.
 *
 * The raw token is a bearer credential — it is handed to the user exactly
 * once (in the POST response) and only its sha256 digest is stored. These
 * two functions are the whole of that contract, so they are tested without
 * a database.
 */

describe('the MCP token primitives', () => {
  it('generates a 47-character prefixed token', () => {
    const raw = generateMcpToken();
    expect(raw.startsWith('mcp_')).toBe(true);
    expect(raw).toHaveLength(47);
    expect(raw).not.toBe(generateMcpToken());
  });

  it('hashes the token with sha256 hex', () => {
    expect(hashMcpToken('mcp_abc')).toBe(hashMcpToken('mcp_abc'));
    expect(hashMcpToken('mcp_abc')).toHaveLength(64);
    expect(hashMcpToken('mcp_abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMcpToken('mcp_abc')).not.toBe(hashMcpToken('mcp_abd'));
  });

  it('names the prefix it stamps on every token', () => {
    expect(MCP_TOKEN_PREFIX).toBe('mcp_');
    expect(generateMcpToken().startsWith(MCP_TOKEN_PREFIX)).toBe(true);
  });
});
