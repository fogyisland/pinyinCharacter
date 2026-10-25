import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpConfig } from '@/mcp/config';
import { startServer } from '@/mcp/server';

/**
 * The harness of the MCP tests.
 *
 * The server is started on an ephemeral port of the loopback interface and
 * driven with the SDK's own client over HTTP — the test therefore exercises
 * the real transport, the real session handling and the real authorization,
 * not the internals behind them.
 */

/** The token every test presents. */
export const TEST_TOKEN = 'test-token';

/** The configuration of the test server. */
export function testConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    endpoint: '/mcp',
    authToken: TEST_TOKEN,
    corsOrigin: '*',
    serverName: 'pinyin-character-test',
    serverVersion: '1.0.0',
    ...overrides,
  };
}

/** The port the server actually bound to. */
async function boundPort(server: Server): Promise<number> {
  if (!server.listening) {
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server did not bind a TCP port');
  }
  return address.port;
}

/** A running test server and the URL it answers on. */
export interface TestServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Start the server and wait for the port. */
export async function startTestServer(overrides: Partial<McpConfig> = {}): Promise<TestServer> {
  const config = testConfig(overrides);
  const server = startServer(config, { quiet: true });
  const port = await boundPort(server);
  return {
    url: `http://127.0.0.1:${port}${config.endpoint}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** A connected client, and the server it talks to. */
export interface TestClient {
  client: Client;
  server: TestServer;
  close: () => Promise<void>;
}

/** Start the server and connect a client to it. */
export async function connectTestClient(
  overrides: Partial<McpConfig> = {},
): Promise<TestClient> {
  const server = await startTestServer(overrides);
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
  });
  const client = new Client({ name: 'mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The parsed `data` of a tool result. */
export function toolData(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((entry) => entry.type === 'text')?.text;
  if (!text) throw new Error('the tool result carries no text block');
  const envelope = JSON.parse(text) as { ok: boolean; data?: Record<string, unknown> };
  if (!envelope.ok) throw new Error(`the tool failed: ${text}`);
  return envelope.data ?? {};
}
