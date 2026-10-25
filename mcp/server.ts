import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAuthorized } from './auth';
import type { McpConfig } from './config';
import { handleWithEnvelope, McpSessionManager } from './session';

/**
 * The MCP server's HTTP layer.
 *
 * The server is a standalone Node HTTP server — not a Next.js route. The
 * SDK's Streamable HTTP transport consumes Node's `IncomingMessage` and
 * `ServerResponse` directly, so a separate process is the shortest path
 * between the SDK and the wire, and it keeps the site itself untouched: no
 * new route, no middleware change, no build.
 *
 * The routes:
 *
 *   POST   <endpoint>  open a session, or send a request in one
 *   GET    <endpoint>  the notification stream of an open session
 *   DELETE <endpoint>  end a session
 *   GET    /health      the health check
 */

/** The CORS headers every answer carries. */
function corsHeaders(config: McpConfig): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, mcp-session-id, mcp-protocol-version',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Access-Control-Max-Age': '86400',
  };
}

/** Answer with JSON and the CORS headers. */
export function sendJson(
  config: McpConfig,
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...corsHeaders(config),
    ...extraHeaders,
  });
  res.end(text);
}

/** The health check — it says whether the server is up and what it serves. */
export function healthPayload(config: McpConfig, sessions: number): unknown {
  return {
    ok: true,
    server: { name: config.serverName, version: config.serverVersion },
    endpoint: config.endpoint,
    auth: config.authToken === null ? 'anonymous' : 'bearer',
    sessions,
  };
}

/**
 * The request handler.
 *
 * It is exported so the test can drive it without binding a port.
 */
export function createRequestHandler(config: McpConfig): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  const sessions = new McpSessionManager(config);

  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(config));
      res.end();
      return;
    }

    if (path === '/health') {
      sendJson(config, res, 200, healthPayload(config, sessions.sessionCount));
      return;
    }

    if (path !== config.endpoint) {
      sendJson(config, res, 404, {
        ok: false,
        error: { code: 'not_found', message: `${path} is not an endpoint of this server` },
      });
      return;
    }

    if (!isAuthorized(req.headers.authorization, config.authToken)) {
      sendJson(config, res, 401, {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'the request must carry the Bearer token of this server',
        },
      });
      return;
    }

    void handleWithEnvelope(sessions, req, res);
  };
}

/** The HTTP server, bound to the configured host and port. */
export function startServer(
  config: McpConfig,
  options: { quiet?: boolean } = {},
): ReturnType<typeof createServer> {
  const server = createServer(createRequestHandler(config));
  server.listen(config.port, config.host, () => {
    if (options.quiet) return;
    console.info(
      `[mcp] ${config.serverName} ${config.serverVersion} is listening on ` +
        `http://${config.host}:${config.port}${config.endpoint} ` +
        `(auth: ${config.authToken === null ? 'anonymous' : 'bearer'})`,
    );
  });
  return server;
}
