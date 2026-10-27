import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectTestClient,
  createRouteClient,
  OTHER_TOKEN,
  setConnectFailure,
  TEST_TOKEN,
  THROWING_TOKEN,
} from './route-harness';
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

/**
 * A body of `megabytes` that arrives in one-megabyte chunks.
 *
 * A stream carries no content length, which is the shape the body gate has
 * to survive: the bytes have to be counted while they arrive.
 */
function oversizedStream(megabytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < megabytes; index += 1) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/** What a body source did while it was being read. */
interface SourceState {
  /** How many chunks the source handed out. */
  produced: number;
  /** Whether the reader cancelled the source. */
  cancelled: boolean;
}

/**
 * A body that is fed on demand and that reports what happened to it.
 *
 * The source hands out one megabyte per pull and can hand out up to
 * `maxChunks` of them, so a reader that stops early leaves the rest of the
 * body untouched. That is what tells the two body gates apart: a gate that
 * buffers the whole body reads all of it, a gate that counts while it
 * reads gives up and cancels the source.
 */
function countedStream(maxChunks: number): { stream: ReadableStream<Uint8Array>; state: SourceState } {
  const state: SourceState = { produced: 0, cancelled: false };
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.produced >= maxChunks) {
        controller.close();
        return;
      }
      state.produced += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

beforeEach(() => {
  getSessionStore().clear();
});

afterEach(() => {
  setConnectFailure(false);
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

  it('answers 503 when the token store cannot be reached', async () => {
    const response = await client.post(INITIALIZE_BODY, {
      Authorization: `Bearer ${THROWING_TOKEN}`,
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('service_unavailable');
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

  it('answers 404 for an unknown session even when the body is malformed', async () => {
    // The session is looked up before the body is read, so a dead session
    // is a 404 — the answer that makes the client start over — and not a
    // 400, which would make it give up.
    const response = await client.postRaw('{not json at all', {
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
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
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

  it('refuses a streamed body that is over 4 MiB and announces no length', async () => {
    // A stream carries no content length, so the bytes have to be counted
    // while they arrive — the declared length cannot be the only guard.
    const response = await client.postRaw(oversizedStream(5), {
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('payload_too_large');
  });

  it('refuses a body that is bigger than its content length claims', async () => {
    const response = await client.postRaw(oversizedStream(5), {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'content-length': '1024',
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('payload_too_large');
  });

  it('abandons the read instead of buffering the whole body', async () => {
    // The gate has to bound the memory, not just the status code. A gate
    // that reads the whole body first answers 413 as well — but it held
    // every byte in memory to do so, and it read the body to its end.
    // The gate that counts while it reads gives up at the limit and
    // cancels the source, so the body is never materialised in full.
    const { stream, state } = countedStream(12);
    const response = await client.postRaw(stream, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('payload_too_large');
    expect(state.cancelled).toBe(true);
    expect(state.produced).toBeLessThan(12);
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

describe('the MCP endpoint: the cache headers', () => {
  it('answers a refusal with no-store', async () => {
    const response = await client.post(INITIALIZE_BODY);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('keeps the transport cache headers and adds no-store on a session answer', async () => {
    const response = await client.post(INITIALIZE_BODY, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(200);
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('no-store');
    // `no-transform` is the transport's own: it tells the proxy not to
    // touch the event stream.
    expect(cacheControl).toContain('no-transform');
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

describe('the MCP endpoint: a server that cannot be opened', () => {
  it('answers 503 when the server refuses the transport', async () => {
    setConnectFailure(true);
    const response = await client.post(INITIALIZE_BODY, { Authorization: `Bearer ${TEST_TOKEN}` });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('service_unavailable');
    // The session was never opened, so nothing is left behind.
    expect(getSessionStore().size).toBe(0);
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

  it('serves the tool registry', async () => {
    const { client: sdkClient, close } = await connectTestClient();
    try {
      const listed = await sdkClient.listTools();
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
        'list_worksheet_schemes',
        'pinyin_to_hanzi',
        'pinyin_to_sentence',
        'render_worksheet_png',
        'reveal_facets',
        'synthesize_speech',
        'text_to_pinyin',
      ]);
    } finally {
      await close();
    }
  });

  it('gives every tool a description and an input schema', async () => {
    const { client: sdkClient, close } = await connectTestClient();
    try {
      const listed = await sdkClient.listTools();
      for (const tool of listed.tools) {
        expect(tool.description, `${tool.name} has no description`).toBeTruthy();
        expect(tool.inputSchema.type, `${tool.name} has no object schema`).toBe('object');
      }
    } finally {
      await close();
    }
  });
});
