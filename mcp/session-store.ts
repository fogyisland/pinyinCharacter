import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * The MCP session store.
 *
 * A session owns an McpServer and a transport, plus the user it belongs to.
 * The map lives on `globalThis` behind a `Symbol.for` key: Next.js dev
 * re-evaluates route modules on every edit, and a module-level Map would
 * drop every open session on each hot reload. `Symbol.for` (not `Symbol`)
 * so that a hot reload — which re-evaluates the module and would otherwise
 * create a *new* symbol — still finds the same store.
 *
 * The store is also the only place that knows when a session was last used:
 * `/mcp` is a public endpoint, so an unbounded map of sessions is a memory
 * leak with a remote trigger. `sweepSessions` is the counterweight.
 */

/** One client's session. */
export interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  /** The user the session was opened for. */
  userId: number;
  /**
   * When the session was last used, in epoch milliseconds.
   *
   * The store owns the value — see `NewMcpSession`.
   */
  lastUsedAt: number;
}

/**
 * What a caller hands over to `setSession`.
 *
 * `lastUsedAt` is deliberately not part of it: the caller (the route's
 * `onsessioninitialized` callback) has no reason to know when the session
 * was opened, and a caller that computed the timestamp itself would
 * eventually forget to — and a session stamped with 0 is evicted as idle
 * the moment it is created.
 */
export type NewMcpSession = Omit<McpSession, 'lastUsedAt'>;

/**
 * How long a session may sit idle before it is swept.
 *
 * Two hours, not thirty minutes: the notification stream is refreshed only
 * when a request comes in, so a shorter TTL would evict a session whose
 * client is still connected.
 */
export const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

/** How many sessions may be open at the same time. */
export const MAX_SESSIONS = 1000;

/** The key the store lives under on globalThis. */
const SESSION_STORE_KEY = Symbol.for('pinyin-character.mcp.sessions');

/** The store's own type. */
type SessionStore = Map<string, McpSession>;

/** globalThis, typed so the store can hang off it. */
interface GlobalWithSessions {
  [SESSION_STORE_KEY]?: SessionStore;
}

/**
 * The store, created on first use.
 *
 * A server restart empties it — every open session id becomes unknown and
 * the client re-initialises. That is the correct behaviour.
 */
export function getSessionStore(): SessionStore {
  const holder = globalThis as GlobalWithSessions;
  const existing = holder[SESSION_STORE_KEY];
  if (existing) return existing;
  const created: SessionStore = new Map();
  holder[SESSION_STORE_KEY] = created;
  return created;
}

/** The session with that id, or undefined when it is not held. */
export function getSession(id: string): McpSession | undefined {
  return getSessionStore().get(id);
}

/**
 * Remember a session under its id.
 *
 * The store stamps `lastUsedAt` itself, so a caller cannot forget to.
 */
export function setSession(id: string, session: NewMcpSession): void {
  getSessionStore().set(id, { ...session, lastUsedAt: Date.now() });
}

/**
 * Mark a session as used right now.
 *
 * A session that is not held is simply not touched: the caller does not
 * need to know whether the session existed.
 */
export function touchSession(id: string): void {
  const session = getSessionStore().get(id);
  if (!session) return;
  session.lastUsedAt = Date.now();
}

/** Forget one session — the client closed it, or the token was revoked. */
export function deleteSession(id: string): void {
  getSessionStore().delete(id);
}

/** Forget every session — the server is shutting down. */
export function clearSessions(): void {
  getSessionStore().clear();
}

/**
 * Forget one session and shut its transport and server down.
 *
 * Removing the record is not enough: the SDK keeps its own references to
 * the transport, so an orphaned one stays alive and its SSE stream stays
 * open. The shutdown itself is asynchronous, so it is fired off and the
 * rejection is logged rather than awaited — the caller of `sweepSessions`
 * must not have to wait for a socket to close.
 */
export function closeAndForget(id: string, session: McpSession): void {
  deleteSession(id);
  void Promise.resolve(session.transport.close()).catch((err: unknown) => {
    console.error('[mcp] could not close a swept transport', err);
  });
  void Promise.resolve(session.server.close()).catch((err: unknown) => {
    console.error('[mcp] could not close a swept server', err);
  });
}

/** What `sweepSessions` needs to know to make its decisions. */
export interface SweepOptions {
  /** A session idle for longer than this is swept. */
  maxIdleMs: number;
  /** The hard cap on open sessions; the oldest are evicted beyond it. */
  maxSessions: number;
  /** The time to judge against — a test seam, production leaves it out. */
  now?: number;
}

/**
 * Drop the sessions that are idle or that push the store past its cap.
 *
 * Returns how many sessions were dropped. The signature is synchronous on
 * purpose: the record leaves the map before the function returns, while
 * the transport and the server are shut down in the background (see
 * `closeAndForget`).
 */
export function sweepSessions(options: SweepOptions): number {
  const now = options.now ?? Date.now();
  const store = getSessionStore();
  let removed = 0;

  for (const [id, session] of [...store.entries()]) {
    if (now - session.lastUsedAt <= options.maxIdleMs) continue;
    closeAndForget(id, session);
    removed += 1;
  }

  const overflow = store.size - options.maxSessions;
  if (overflow > 0) {
    const byAge = [...store.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    for (let index = 0; index < overflow && index < byAge.length; index += 1) {
      const [id, session] = byAge[index];
      closeAndForget(id, session);
      removed += 1;
    }
  }

  return removed;
}
