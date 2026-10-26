import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { vi } from 'vitest';

/**
 * The harness of the MCP route tests.
 *
 * The MCP server used to be a standalone Node process; it is now a route
 * handler of the site. The harness therefore has to be able to drive a
 * Next.js route handler, which means it comes in two flavours:
 *
 *   (a) `createRouteClient()` calls the exported handler directly, with a
 *       Web `Request` — no port is bound, and the assertions are about the
 *       route's own answers (401, 403, 404, 400, 413, CORS).
 *   (b) `connectTestClient()` puts the same handler behind a loopback
 *       HTTP server and talks to it with the SDK's own client — the
 *       assertions are about the wire.
 *
 * The token store is mocked: the route resolves the bearer against the
 * database, and a test must not need one.
 */

// vi.hoisted runs before the mock factories, so the token table exists by
// the time the mocked module is created.
const { tokens } = vi.hoisted(() => ({
  tokens: {
    test: 'test-token',
    other: 'other-token',
  },
}));

vi.mock('@/lib/mcp-token', () => ({
  resolveToken: async (raw: string) => {
    if (raw === tokens.test) return { userId: 1, username: 'tester', isAdmin: false };
    if (raw === tokens.other) return { userId: 2, username: 'other', isAdmin: false };
    return null;
  },
}));

import { DELETE, GET, OPTIONS, POST } from '@/app/mcp/route';

/** The token every test presents. */
export const TEST_TOKEN = tokens.test;

/** A token of another user — for the cross-user assertions. */
export const OTHER_TOKEN = tokens.other;

/** The url the route is mounted on. */
const ROUTE_URL = 'http://localhost:4444/mcp';

/** The route, driven without a port. */
export interface RouteClient {
  post(body: unknown, headers?: Record<string, string>): Promise<Response>;
  get(headers?: Record<string, string>): Promise<Response>;
  del(headers?: Record<string, string>): Promise<Response>;
  options(): Promise<Response>;
}

/** The init of a request the route can be driven with. */
interface StreamRequestInit extends RequestInit {
  /** undici insists on `duplex: 'half'` when the body is a stream. */
  duplex?: 'half';
}

/** Build the Web request the route handlers take. */
function buildRequest(method: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(ROUTE_URL, init);
}

/**
 * The route, driven without a port.
 *
 * The responses are the route's own — a Web `Response` whose body is a
 * stream, read with `await response.text()`.
 */
export function createRouteClient(): RouteClient {
  return {
    post: (body, headers) => POST(buildRequest('POST', body, headers)),
    get: (headers) => GET(buildRequest('GET', undefined, headers)),
    del: (headers) => DELETE(buildRequest('DELETE', undefined, headers)),
    options: () => OPTIONS(),
  };
}

/** A running loopback server and the url the MCP client talks to. */
export interface LoopbackServer {
  url: string;
  close: () => Promise<void>;
}

/** The port the loopback server bound to. */
function boundPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the loopback server did not bind a TCP port');
  }
  return (address as AddressInfo).port;
}

/** Turn a Node request into the Web request the route takes. */
function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/mcp', `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  const method = req.method ?? 'GET';
  const init: StreamRequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    // At runtime `node:stream/web` and the global ReadableStream are the
    // same class; the two type declarations just have not caught up with
    // each other (the DOM one knows about the async iterator, the node one
    // does not).
    init.body = Readable.toWeb(req) as unknown as BodyInit;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

/** Send a request to the route that matches its method. */
async function dispatch(request: Request): Promise<Response> {
  switch (request.method) {
    case 'POST':
      return POST(request);
    case 'GET':
      return GET(request);
    case 'DELETE':
      return DELETE(request);
    case 'OPTIONS':
      return OPTIONS();
    default:
      return new Response(null, { status: 405 });
  }
}

/** Write a Web response back onto the Node socket. */
async function writeBack(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, [...response.headers]);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as unknown as NodeReadableStream).pipe(res);
}

/** Answer one loopback request. */
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await writeBack(await dispatch(toWebRequest(req)), res);
  } catch (err) {
    console.error('[mcp-test] the loopback request failed', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'test failure' } }));
  }
}

/** Start the loopback server the SDK client talks to. */
export async function startLoopbackServer(): Promise<LoopbackServer> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${boundPort(server)}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        // A session's notification stream is still open, and `close` waits
        // for the connections — they have to be cut first.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A connected client, and the loopback server it talks to. */
export interface TestClient {
  client: Client;
  close: () => Promise<void>;
}

/** Start the loopback server and connect a client to it. */
export async function connectTestClient(options?: { token?: string }): Promise<TestClient> {
  const server = await startLoopbackServer();
  const token = options?.token ?? TEST_TOKEN;
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return {
    client,
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
