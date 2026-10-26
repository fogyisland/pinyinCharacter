import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { badRequest, forbidden, notFound, serviceUnavailable, unauthorized } from '@/lib/api-handler';
import { resolveToken, type ResolvedToken } from '@/lib/mcp-token';
import { createMcpServer } from '@/mcp/server-factory';
import {
  closeAndForget,
  deleteSession,
  getSession,
  MAX_SESSIONS,
  SESSION_IDLE_TTL_MS,
  setSession,
  sweepSessions,
  touchSession,
  type McpSession,
} from '@/mcp/session-store';

/**
 * The MCP endpoint, mounted on the site itself.
 *
 * The MCP server used to be a separate Node process. It is now a route
 * handler of this app: the tools read the same files the pages read, and
 * the clients reach it on the same origin (and the same domain) as the
 * site — which is what a browser-based MCP client wants.
 *
 * The route answers the four verbs of the Streamable HTTP transport:
 *
 *   POST   open a session (an `initialize` request) or send a request in one
 *   GET    the notification stream of an open session
 *   DELETE end a session
 *   OPTIONS the CORS preflight
 *
 * Three gates stand in front of all of them: the bearer token must be
 * known, the session must belong to the caller, and the body must not be
 * larger than 4 MiB.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The header the session id travels in. */
const SESSION_HEADER = 'mcp-session-id';

/** The largest request body the endpoint accepts. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The bearer that opens a session without an account.
 *
 * It only works outside production, and the check is a literal comparison
 * against `NODE_ENV` — not an environment switch that could be flipped on
 * by accident.
 */
const DEV_ANONYMOUS_TOKEN = 'dev-anonymous';

/** The user the development bearer belongs to. */
const DEV_ANONYMOUS_USER_ID = 0;

/** The message every rejected token gets. */
const UNAUTHORIZED_MESSAGE = 'the request must carry a valid MCP token';

/** The caller of a request, once the token has been resolved. */
interface Caller {
  userId: number;
  username: string;
  isAdmin: boolean;
}

/** The outcome of the token gate. */
type AuthOutcome = { ok: true; user: Caller } | { ok: false; response: NextResponse };

/** The outcome of the body gate. */
type BodyOutcome = { ok: true; body: unknown } | { ok: false; response: NextResponse };

/** The outcome of the session lookup. */
type SessionOutcome = { ok: true; session: McpSession } | { ok: false; response: NextResponse };

/** The origin the endpoint allows, overridable by the environment. */
function corsOrigin(): string {
  const configured = process.env.MCP_CORS_ORIGIN?.trim();
  return configured ? configured : '*';
}

/**
 * Every answer of this endpoint is `no-store`.
 *
 * The body either carries a session or describes one, and a cached copy of
 * a 401 would keep a signed-out client from ever seeing the fresh answer.
 * The transport sets `no-cache, no-transform` on the answers it writes
 * itself — `no-transform` matters for the SSE stream, so it is kept and
 * `no-store` is added next to it.
 */
function withNoStore(headers: Headers): void {
  const current = headers.get('Cache-Control');
  headers.set('Cache-Control', current ? `${current}, no-store` : 'no-store');
}

/**
 * Put the CORS headers on a response.
 *
 * The response is rebuilt instead of mutated: some Response implementations
 * ignore a header set on an existing response. The original headers are
 * copied over first — the SDK puts the session id in a response header
 * (`mcp-session-id`), and a rebuild with a fresh, empty header set would
 * drop it, and the client would then fail every later request with "the
 * Mcp-Session-Id header is required". The content type comes along for
 * the same reason: the transport answers `application/json` or
 * `text/event-stream`.
 */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  withNoStore(headers);
  headers.set('Access-Control-Allow-Origin', corsOrigin());
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, mcp-session-id, mcp-protocol-version',
  );
  headers.set('Access-Control-Expose-Headers', 'mcp-session-id');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The raw token of the Authorization header.
 *
 * The scheme is case-insensitive (RFC 6750); the token itself is not — it
 * is hashed verbatim.
 */
function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * The caller behind a request, or the answer to send back.
 *
 * The bearer is stripped of its scheme before it reaches `resolveToken`:
 * the database holds the digest of the bare token, so a header that still
 * carried "Bearer " would hash to something else and never resolve.
 */
async function authenticate(request: Request): Promise<AuthOutcome> {
  const raw = readBearer(request.headers.get('authorization'));
  if (raw === null) {
    return { ok: false, response: unauthorized('unauthorized', UNAUTHORIZED_MESSAGE) };
  }

  if (raw === DEV_ANONYMOUS_TOKEN && process.env.NODE_ENV !== 'production') {
    return {
      ok: true,
      user: { userId: DEV_ANONYMOUS_USER_ID, username: DEV_ANONYMOUS_TOKEN, isAdmin: false },
    };
  }

  let resolved: ResolvedToken | null;
  try {
    resolved = await resolveToken(raw);
  } catch (err) {
    console.error('[mcp] could not resolve the bearer token', err);
    return {
      ok: false,
      response: serviceUnavailable('service_unavailable', 'the token store is not reachable'),
    };
  }

  if (!resolved) {
    return { ok: false, response: unauthorized('unauthorized', UNAUTHORIZED_MESSAGE) };
  }
  return { ok: true, user: resolved };
}

/** The answer to a body that is over the limit. */
function payloadTooLarge(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'payload_too_large', message: 'the request body exceeds 4 MiB' } },
    { status: 413 },
  );
}

/**
 * Read the body, refusing to hold more than the limit in memory.
 *
 * The chunks are counted as they arrive and the read is abandoned the
 * moment the total passes the limit, so a client that lies about (or
 * omits) its content length cannot make the process hold a payload it is
 * about to reject. The declared length is checked separately, before the
 * body is touched at all.
 *
 * Returns null when the body is over the limit.
 */
async function readBodyText(request: Request, limit: number): Promise<string | null> {
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch((err: unknown) => {
          console.error('[mcp] could not cancel the request body', err);
        });
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * The parsed body of a POST, or the answer to send back.
 *
 * The transport's own limit does not apply once the body is handed over
 * parsed, so the size is checked here. The declared length is checked
 * first — a body that announces itself as too large is refused before it
 * is read — and the bytes are counted while they arrive for the requests
 * that lie about (or omit) their length.
 */
async function readJsonBody(request: Request): Promise<BodyOutcome> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: payloadTooLarge() };
  }

  let text: string | null;
  try {
    text = await readBodyText(request, MAX_BODY_BYTES);
  } catch (err) {
    console.error('[mcp] could not read the request body', err);
    return { ok: false, response: badRequest('bad_input', 'the request body could not be read') };
  }
  if (text === null) {
    return { ok: false, response: payloadTooLarge() };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch (err) {
    console.error('[mcp] the request body is not valid JSON', err);
    return { ok: false, response: badRequest('bad_input', 'the request body is not valid JSON') };
  }
}

/**
 * Whether a body opens a session.
 *
 * The transport accepts a batch that carries an initialize request, so
 * the route asks the same question the same way.
 */
function isInitializeBody(body: unknown): boolean {
  if (Array.isArray(body)) return body.some((entry) => isInitializeRequest(entry));
  return isInitializeRequest(body);
}

/**
 * The session a request names, or the answer to send back.
 *
 * A session that belongs to somebody else is a 403, not a 404: the caller
 * proved who they are, so telling them that the session exists but is not
 * theirs is the honest answer.
 */
function findSession(sessionId: string, user: Caller): SessionOutcome {
  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      response: notFound('not_found', `the session ${sessionId} is unknown — it was never opened, or it has ended`),
    };
  }
  if (session.userId !== user.userId) {
    return { ok: false, response: forbidden('forbidden', 'the session belongs to another user') };
  }
  return { ok: true, session };
}

/**
 * Open a session and let the transport answer the initialize request.
 *
 * The `onsessioninitialized` callback has to be in place before the
 * transport sees the request: it mints the session id while it handles the
 * initialize, and the callback is what puts the session into the store.
 */
async function openSession(request: Request, body: unknown, user: Caller): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      setSession(sessionId, { server, transport, userId: user.userId });
    },
    onsessionclosed: (sessionId: string) => {
      deleteSession(sessionId);
    },
  });
  try {
    await server.connect(transport);
  } catch (err) {
    console.error('[mcp] could not connect the server to the transport', err);
    await transport.close().catch((closeErr: unknown) => {
      console.error('[mcp] could not close the transport after a failed connect', closeErr);
    });
    return serviceUnavailable('service_unavailable', 'the MCP server could not open a session');
  }
  return transport.handleRequest(request, { parsedBody: body });
}

/** Drop the sessions that are idle or that push the store past its cap. */
function sweep(): void {
  sweepSessions({ maxIdleMs: SESSION_IDLE_TTL_MS, maxSessions: MAX_SESSIONS });
}

/** POST — open a session, or send a request in one. */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return withCors(auth.response);
  sweep();

  // The session is looked up before the body is read: a request that names
  // a session that is gone is a 404, and a 404 makes the client start over
  // with a fresh initialize — a 400 would not. A dead session's request
  // does not get its body read at all.
  const sessionId = request.headers.get(SESSION_HEADER);
  if (sessionId) {
    const found = findSession(sessionId, auth.user);
    if (!found.ok) return withCors(found.response);
    touchSession(sessionId);
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return withCors(parsed.response);
    const response = await found.session.transport.handleRequest(request, { parsedBody: parsed.body });
    return withCors(response);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return withCors(parsed.response);
  if (!isInitializeBody(parsed.body)) {
    return withCors(
      badRequest(
        'bad_input',
        'the request carries no mcp-session-id header — open a session with an initialize request first',
      ),
    );
  }

  return withCors(await openSession(request, parsed.body, auth.user));
}

/** GET — the notification stream of an open session. */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return withCors(auth.response);
  sweep();

  const sessionId = request.headers.get(SESSION_HEADER);
  if (!sessionId) {
    return withCors(badRequest('bad_input', 'the request carries no mcp-session-id header'));
  }

  const found = findSession(sessionId, auth.user);
  if (!found.ok) return withCors(found.response);
  touchSession(sessionId);
  return withCors(await found.session.transport.handleRequest(request));
}

/** DELETE — end a session. */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return withCors(auth.response);
  sweep();

  const sessionId = request.headers.get(SESSION_HEADER);
  if (!sessionId) {
    return withCors(badRequest('bad_input', 'the request carries no mcp-session-id header'));
  }

  const found = findSession(sessionId, auth.user);
  if (!found.ok) return withCors(found.response);
  touchSession(sessionId);
  closeAndForget(sessionId, found.session);
  return withCors(new Response(null, { status: 200 }));
}

/** OPTIONS — the CORS preflight. It carries no credentials by design. */
export async function OPTIONS(): Promise<Response> {
  return withCors(new Response(null, { status: 204 }));
}
