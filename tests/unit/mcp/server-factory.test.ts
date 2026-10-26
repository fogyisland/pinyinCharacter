import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  clearSessions,
  deleteSession,
  getSession,
  getSessionStore,
  setSession,
} from '@/mcp/session-store';
import { createMcpServer } from '@/mcp/server-factory';

/**
 * The MCP server factory and the session store.
 *
 * The factory is what the site's own `/mcp` route will build, so the test
 * drives a real client over the SDK's in-memory transport: what the client
 * sees is what a real MCP client sees.
 */

/** A session that carries no real transport — the store never opens one. */
function fakeSession(userId: number) {
  return {
    server: {} as McpServer,
    transport: {} as unknown as WebStandardStreamableHTTPServerTransport,
    userId,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearSessions();
});

describe('createMcpServer', () => {
  it('names the server from the environment', async () => {
    vi.stubEnv('MCP_SERVER_NAME', 'ziyun-test');
    vi.stubEnv('MCP_SERVER_VERSION', '9.9.9');
    const server = createMcpServer();
    expect(server).toBeInstanceOf(McpServer);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'factory-test', version: '1.0.0' });
    try {
      await client.connect(clientTransport);
      expect(client.getServerVersion()).toEqual({ name: 'ziyun-test', version: '9.9.9' });
    } finally {
      await client.close();
    }
  });

  it('falls back to the site identity when the environment says nothing', async () => {
    vi.stubEnv('MCP_SERVER_NAME', '');
    vi.stubEnv('MCP_SERVER_VERSION', '');
    const server = createMcpServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'factory-test', version: '1.0.0' });
    try {
      await client.connect(clientTransport);
      expect(client.getServerVersion()).toEqual({
        name: 'pinyin-character',
        version: '1.0.0',
      });
    } finally {
      await client.close();
    }
  });

  it('registers the tool registry', async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'factory-test', version: '1.0.0' });
    try {
      await client.connect(clientTransport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain('get_char');
      expect(names).toContain('generate_worksheet_layout');
    } finally {
      await client.close();
    }
  });
});

describe('the session store', () => {
  it('keeps the session store across module reloads', async () => {
    const first = getSessionStore();
    vi.resetModules();
    const reloaded = await import('@/mcp/session-store');
    expect(reloaded.getSessionStore()).toBe(first);
  });

  it('stores and removes a session', () => {
    const session = fakeSession(1);
    setSession('sess-1', session);
    // The store stamps the record itself — the caller hands over the
    // session, the store keeps its own copy of it.
    const stored = getSession('sess-1');
    expect(stored?.userId).toBe(1);
    expect(stored?.server).toBe(session.server);
    expect(stored?.transport).toBe(session.transport);
    deleteSession('sess-1');
    expect(getSession('sess-1')).toBeUndefined();
  });

  it('answers undefined for a session it does not hold', () => {
    expect(getSession('nope')).toBeUndefined();
  });

  it('empties the whole store on clear', () => {
    setSession('sess-1', fakeSession(1));
    setSession('sess-2', fakeSession(2));
    clearSessions();
    expect(getSessionStore().size).toBe(0);
  });
});
