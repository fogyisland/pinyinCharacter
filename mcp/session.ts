import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { readJsonBody } from './body';
import type { McpConfig } from './config';
import { McpError } from './errors';
import { registerAllTools } from './tools';

/**
 * The MCP session manager.
 *
 * The transport is the stateful variant of the Streamable HTTP transport:
 * the client opens a session with an `initialize` request, gets a session id
 * back, and sends every later request with that id in the `mcp-session-id`
 * header. Each session owns its own `McpServer` and its own transport, so a
 * broken session cannot disturb the others.
 */

/** One client's session. */
interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/** The header the session id travels in. */
const SESSION_HEADER = 'mcp-session-id';

export class McpSessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly config: McpConfig) {}

  /** How many sessions are open. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Handle one request on the MCP endpoint.
   *
   * The three verbs of the Streamable HTTP transport:
   *
   *   POST   — a request, or the `initialize` that opens a session;
   *   GET    — the server's notification stream of an open session;
   *   DELETE — the end of a session.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      await this.handlePost(req, res);
      return;
    }
    if (method === 'GET' || method === 'DELETE') {
      await this.handleSessionRequest(req, res, method);
      return;
    }
    this.sendJson(res, 405, {
      ok: false,
      error: { code: 'bad_input', message: `${method} is not allowed on the MCP endpoint` },
    });
  }

  /** Close every open session — the server is shutting down. */
  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      try {
        await session.transport.close();
        await session.server.close();
      } catch (error) {
        console.error('[mcp] a session did not close cleanly', error);
      }
    }
  }

  /** A POST: either the `initialize` that opens a session, or a request in one. */
  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);

    if (isInitializeRequest(body)) {
      await this.openSession(req, res, body);
      return;
    }

    const sessionId = this.sessionIdOf(req);
    if (sessionId === null) {
      this.sendJson(res, 400, {
        ok: false,
        error: {
          code: 'bad_input',
          message: `the request carries no ${SESSION_HEADER} header — open a session with an initialize request first`,
        },
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendJson(res, 404, {
        ok: false,
        error: {
          code: 'not_found',
          message: `the session ${sessionId} is unknown — it was never opened, or it has ended`,
        },
      });
      return;
    }
    await session.transport.handleRequest(req, res, body);
  }

  /** A GET (the notification stream) or a DELETE (the end of a session). */
  private async handleSessionRequest(
    req: IncomingMessage,
    res: ServerResponse,
    method: 'GET' | 'DELETE',
  ): Promise<void> {
    const sessionId = this.sessionIdOf(req);
    if (sessionId === null) {
      this.sendJson(res, 400, {
        ok: false,
        error: {
          code: 'bad_input',
          message: `the request carries no ${SESSION_HEADER} header`,
        },
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendJson(res, 404, {
        ok: false,
        error: {
          code: 'not_found',
          message: `the session ${sessionId} is unknown — it was never opened, or it has ended`,
        },
      });
      return;
    }
    await session.transport.handleRequest(req, res);
    if (method === 'DELETE') {
      this.sessions.delete(sessionId);
      try {
        await session.server.close();
      } catch (error) {
        console.error('[mcp] a session did not close cleanly', error);
      }
    }
  }

  /** Open a new session and let the transport answer the initialize request. */
  private async openSession(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const server = new McpServer(
      { name: this.config.serverName, version: this.config.serverVersion },
      { capabilities: { tools: {} } },
    );
    registerAllTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessions.set(sessionId, { server, transport });
        console.info(`[mcp] session ${sessionId} opened`);
      },
      onsessionclosed: (sessionId: string) => {
        this.sessions.delete(sessionId);
        console.info(`[mcp] session ${sessionId} closed`);
      },
    });

    // The transport owns the response from here on.
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  /** The session id a request carries, or null when it carries none. */
  private sessionIdOf(req: IncomingMessage): string | null {
    const sessionId = req.headers[SESSION_HEADER];
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    return sessionId;
  }

  /** Answer a request the transport does not handle. */
  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return;
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  }
}

/**
 * Handle a request, turning an error into the site's error envelope.
 *
 * The transport answers the request itself when it can; this is the path
 * for the errors that happen before that.
 */
export async function handleWithEnvelope(
  manager: McpSessionManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await manager.handle(req, res);
  } catch (error) {
    const envelope =
      error instanceof McpError
        ? { ok: false, error: { code: error.code, message: error.message } }
        : { ok: false, error: { code: 'internal_error', message: 'the request failed' } };
    if (!(error instanceof McpError)) {
      console.error('[mcp] a request failed', error);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    const text = JSON.stringify(envelope);
    res.writeHead(error instanceof McpError ? 400 : 500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  }
}
