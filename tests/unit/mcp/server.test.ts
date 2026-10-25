import { describe, expect, it } from 'vitest';
import { connectTestClient, startTestServer, TEST_TOKEN } from './harness';

/**
 * The MCP server's transport, session and authorization.
 *
 * The tests drive the real HTTP endpoint with the SDK's own client, so
 * what they prove is what a real MCP client gets.
 */

describe('the MCP server', () => {
  it('serves the tool registry', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        'build_quest_level',
        'generate_worksheet_layout',
        'get_char',
        'get_classic_chapter',
        'get_classic_outline',
        'get_poem',
        'get_radical',
        'get_stroke_count',
        'get_sutra_chunk',
        'get_tone_forms',
        'list_classics',
        'list_poems',
        'list_sutras',
        'pinyin_to_hanzi',
        'pinyin_to_sentence',
        'reveal_facets',
        'synthesize_speech',
        'text_to_pinyin',
      ]);
    } finally {
      await close();
    }
  });

  it('gives every tool a description and an input schema', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        expect(tool.description, `${tool.name} has no description`).toBeTruthy();
        expect(tool.inputSchema.type, `${tool.name} has no object schema`).toBe('object');
      }
    } finally {
      await close();
    }
  });

  it('refuses a request without the token', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'probe', version: '1.0.0' },
          },
        }),
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('refuses a request with the wrong token', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer wrong' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'probe', version: '1.0.0' },
          },
        }),
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('accepts the token in the Authorization header', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'probe', version: '1.0.0' },
          },
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it('answers the health check', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok: boolean;
        endpoint: string;
        auth: string;
        server: { name: string };
      };
      expect(body.ok).toBe(true);
      expect(body.endpoint).toBe('/mcp');
      expect(body.auth).toBe('bearer');
      expect(body.server.name).toBe('pinyin-character-test');
    } finally {
      await server.close();
    }
  });

  it('answers 404 on an unknown path', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/nope`);
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('answers the CORS preflight', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, { method: 'OPTIONS' });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    } finally {
      await server.close();
    }
  });

  it('rejects a request that carries no session', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('rejects a request with an unknown session', async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${TEST_TOKEN}`,
          'mcp-session-id': '00000000-0000-4000-8000-000000000000',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('serves an anonymous server without a token', async () => {
    const server = await startTestServer({ authToken: null });
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'probe', version: '1.0.0' },
          },
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
