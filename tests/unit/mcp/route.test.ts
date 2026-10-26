import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTestClient, createRouteClient, OTHER_TOKEN, TEST_TOKEN } from './route-harness';
import {
  closeAndForget,
  getSessionStore,
  MAX_SESSIONS,
  SESSION_IDLE_TTL_MS,
  sweepSessions,
} from '@/mcp/session-store';

/**
 * The MCP endpoint of the site.
 *
 * The route answers with the site's own error envelope, so the assertions
 * are about the status and the shape of the body — and about the session
 * table, which is the only piece of state the route keeps.
 */

/** The request that opens a session. */
const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'route-test', version: '1.0.0' },
  },
};

/** A request that belongs to a session. */
const TOOLS_LIST_BODY = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const client = createRouteClient();

/**
 * Let go of a response body.
 *
 * A request that belongs to a session is answered with an event stream
 * that stays open; the assertions do not read it, and an unread stream
 * would keep the test's transport alive.
 */
async function discard(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch (err) {
    console.error('[mcp-test] could not release a response body', err);
  }
}

/** Open a session and return its id. */
async function openSession(headers?: Record<string, string>): Promise<string> {
  const response = await client.post(INITIALIZE_BODY, {
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...headers,
  });
  expect(response.status).toBe(200);
  const sessionId = response.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  await discard(response);
  return sessionId ?? '';
}

/** The session ids the store holds, oldest first. */
function sessionIds(): string[] {
  return [...getSessionStore().keys()];
}

beforeEach(() => {
  getSessionStore().clear();
});

afterEach(() => {
  for (const [id, session] of [...getSessionStore().entries()]) {
    closeAndForget(id, session);
  }
});

describe('the MCP endpoint: the token gate', () => {
  it('refuses a request without an Authorization header', async () => {
    const response = await client.post(INITIALIZE_BODY);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
  });

  it('refuses a request with an unknown bearer', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: 'Bearer bogus-token' });
    expect(response.status).toBe(401);
    expect(getSessionStore().size).toBe(0);
  });

  it('refuses a bearer that is not a bearer at all', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: 'Basic dXNlcjpwYXNz' });
    expect(response.status).toBe(401);
  });

  it('lets the development bearer through outside production', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: 'Bearer dev-anonymous' });
    expect(response.status).toBe(200);
    await discard(response);
  });

  it('refuses the development bearer in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await client.post(INITIALIZE_BODY, { Authorization: 'Bearer dev-anonymous' });
      expect(response.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('the MCP endpoint: the session gate', () => {
  it('refuses a request that opens no session and is not an initialize', async () => {
    const response = await client.post(TOOLS_LIST_BODY, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(400);
    expect(getSessionStore().size).toBe(0);
  });

  it('opens a session for an initialize request', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeTruthy();
    expect(getSessionStore().size).toBe(1);
    await discard(response);
  });

  it('answers 404 for a session that was never opened', async () => {
    const response = await client.post(TOOLS_LIST_BODY, {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'mcp-session-id': 'no-such-session',
    });
    expect(response.status).toBe(404);
  });

  it('answers a request that belongs to a known session', async () => {
    const sessionId = await openSession();
    const response = await client.post(TOOLS_LIST_BODY, {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'mcp-session-id': sessionId,
    });
    expect(response.status).not.toBe(400);
    await discard(response);
  });

  it('answers 403 when the session belongs to another user', async () => {
    const sessionId = await openSession();
    const response = await client.post(TOOLS_LIST_BODY, {
      Authorization: `Bearer ${OTHER_TOKEN}`,
      'mcp-session-id': sessionId,
    });
    expect(response.status).toBe(403);
    await discard(response);
  });

  it('answers 400 for a GET without a session', async () => {
    const response = await client.get({ Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(400);
  });

  it('ends a session on DELETE', async () => {
    const sessionId = await openSession();
    const response = await client.del({
      Authorization: `Bearer ${TEST_TOKEN}`,
      'mcp-session-id': sessionId,
    });
    expect(response.status).toBe(200);
    expect(getSessionStore().size).toBe(0);
  });
});

describe('the MCP endpoint: the body gate', () => {
  it('refuses a body that announces itself as too large', async () => {
    const response = await client.post(INITIALIZE_BODY, {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'content-length': String(8 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
  });

  it('refuses a body that is over 4 MiB', async () => {
    const response = await client.post(
      { ...INITIALIZE_BODY, params: { ...INITIALIZE_BODY.params, filler: 'x'.repeat(4 * 1024 * 1024 + 1024) } },
      { Authorization: `Bearer ${TEST_TOKEN}` },
    );
    expect([400, 413]).toContain(response.status);
    expect(response.status).not.toBe(500);
  });
});

describe('the MCP endpoint: CORS', () => {
  it('answers the preflight with 204 and the CORS headers', async () => {
    const response = await client.options();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
  });

  it('exposes the session id on a POST answer', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
    expect(response.headers.get('mcp-session-id')).toBeTruthy();
    await discard(response);
  });
});

describe('the MCP endpoint: the session lifetime', () => {
  it('keeps a session that has been idle for ten minutes', async () => {
    await openSession();
    await openSession();
    expect(getSessionStore().size).toBe(2);

    sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: MAX_SESSIONS,
      now: Date.now() + 10 * 60 * 1000,
    });
    expect(getSessionStore().size).toBe(2);
  });

  it('drops a session that has been idle for more than two hours', async () => {
    await openSession();
    await openSession();

    sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: MAX_SESSIONS,
      now: Date.now() + 3 * 60 * 60 * 1000,
    });
    expect(getSessionStore().size).toBe(0);
  });

  it('evicts the oldest session when the cap is reached', async () => {
    const first = await openSession();
    // The sessions are opened apart, so the least recently used one is
    // unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await openSession();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = await openSession();
    expect(getSessionStore().size).toBe(3);

    sweepSessions({ maxIdleMs: SESSION_IDLE_TTL_MS, maxSessions: 2, now: Date.now() });

    expect(getSessionStore().size).toBe(2);
    expect(sessionIds()).not.toContain(first);
    expect(sessionIds()).toContain(second);
    expect(sessionIds()).toContain(third);

    const response = await client.post(TOOLS_LIST_BODY, {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'mcp-session-id': first,
    });
    expect(response.status).toBe(404);
  });
});

describe('the MCP endpoint: over the wire', () => {
  it('lets the SDK client open a session and list the tools', async () => {
    const { client: sdkClient, close } = await connectTestClient();
    try {
      const listed = await sdkClient.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
